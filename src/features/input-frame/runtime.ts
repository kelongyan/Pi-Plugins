/**
 * 输入框线框的运行时：把自定义 editor 挂到 Pi 的 editor 槽位上。
 *
 * 严格遵守官方边界：
 * - 只用 `ctx.ui.setEditorComponent` 这个公开 API，不 patch 任何 Pi 内部结构
 * - 卸载时只在编辑器仍由本插件持有时才清除，绝不覆盖别人的 editor
 * - 每次切换会话递增 generation；过期的 factory 直接返回 undefined（表示不接管）
 */

import { resolveTheme } from "../../core/theme.ts";
import { createFramedEditor } from "./editor.ts";
import type { EditorFrameStatus } from "./frame.ts";
import {
  buildStatusBarSegments,
  composeStatusBar,
  type StatusBarIconStyle,
  type StatusBarSegmentSettings,
} from "./status-bar.ts";
import { buildFrameStatus, type InputFrameSettingsLike } from "./status.ts";

export type EditorFactory = (tui: any, theme: any, keybindings: any) => unknown;

/** configure() 需要的完整配置（线框 + 状态栏）。 */
export type InputFrameRuntimeSettings = InputFrameSettingsLike & {
  /** 线框开关。 */
  enabled: boolean;
  /** 状态栏开关。 */
  statusBarEnabled: boolean;
  statusBarIcons: StatusBarIconStyle;
  statusBarSegments: StatusBarSegmentSettings;
};

/** 装配层注入的回调，避免 runtime 反向依赖上层。 */
export type InputFrameRuntimeDeps = {
  /** 读取当前流式速度（tokens/s）。 */
  getTokensPerSecond?: () => number | undefined;
};

/** 状态缺失时的兜底（正常路径由 configure() 注入）。 */
const FALLBACK_SETTINGS: InputFrameSettingsLike = {
  showModel: true,
  showThinking: true,
  showContext: true,
};

const FALLBACK_BAR_SEGMENTS: StatusBarSegmentSettings = {
  model: true,
  path: true,
  git: true,
  context: true,
  cost: true,
  speed: true,
};

export class InputFrameRuntime {
  private generation = 0;
  private ctx: unknown;
  private settings: InputFrameSettingsLike = FALLBACK_SETTINGS;
  private enabled = false;
  private barEnabled = false;
  private barIcons: StatusBarIconStyle = "emoji";
  private barSegments: StatusBarSegmentSettings = FALLBACK_BAR_SEGMENTS;
  private factory: EditorFactory | undefined;
  private readonly deps: InputFrameRuntimeDeps;

  constructor(deps: InputFrameRuntimeDeps = {}) {
    this.deps = deps;
  }

  /** 绑定/切换会话。调用后旧的 factory 立即失效。 */
  bindSession(ctx: unknown): void {
    this.ctx = ctx;
    this.generation += 1;
  }

  /** 应用配置并同步到 Pi。 */
  configure(settings: InputFrameRuntimeSettings): void {
    this.settings = {
      showModel: settings.showModel,
      showThinking: settings.showThinking,
      showContext: settings.showContext,
    };
    this.enabled = settings.enabled;
    this.barEnabled = settings.statusBarEnabled;
    this.barIcons = settings.statusBarIcons;
    this.barSegments = settings.statusBarSegments;
    this.reconcile();
  }

  /** 是否由本插件接管输入框（线框或状态栏任一开启即算）。 */
  get isActive(): boolean {
    return Boolean((this.enabled || this.barEnabled) && this.factory !== undefined);
  }

  private readUi(): any {
    try {
      return (this.ctx as { ui?: unknown } | undefined)?.ui;
    } catch {
      // reload 后 stale ctx 的 getter 会抛错。
      return undefined;
    }
  }

  private reconcile(): void {
    const ui = this.readUi();
    if (!ui || typeof ui.setEditorComponent !== "function") return;

    // 线框与状态栏任一开启都需要接管 editor。
    if (!this.enabled && !this.barEnabled) {
      this.restoreEditor();
      return;
    }

    const generation = this.generation;
    const factory: EditorFactory = (tui, theme, keybindings) => {
      // 会话已切换：让 Pi 使用默认 editor。
      if (generation !== this.generation) return undefined;

      return createFramedEditor(tui, theme, keybindings, {
        getTheme: resolveTheme,
        isFrameEnabled: () => this.enabled,
        getStatus: (): EditorFrameStatus => {
          if (generation !== this.generation) return {};
          return buildFrameStatus({
            ctx: this.ctx,
            theme: resolveTheme(),
            settings: this.settings,
          });
        },
        getStatusBarLine: (width: number): string | undefined => {
          if (generation !== this.generation || !this.barEnabled) return undefined;
          const segments = buildStatusBarSegments({
            ctx: this.ctx,
            theme: resolveTheme(),
            icons: this.barIcons,
            settings: this.barSegments,
            tokensPerSecond: this.deps.getTokensPerSecond?.(),
          });
          return composeStatusBar(segments, width) || undefined;
        },
      });
    };

    this.factory = factory;
    try {
      ui.setEditorComponent(factory);
    } catch {
      // stale ctx：保持 factory 记录，等下次 bindSession 重试。
    }
  }

  /** 仅当 editor 仍由本插件持有时才清除。 */
  private restoreEditor(): void {
    const ui = this.readUi();
    if (!ui || typeof ui.setEditorComponent !== "function") {
      this.factory = undefined;
      return;
    }
    try {
      const current = typeof ui.getEditorComponent === "function" ? ui.getEditorComponent() : undefined;
      if (this.factory !== undefined && current === this.factory) {
        ui.setEditorComponent(undefined);
      }
    } catch {
      // stale ctx：交给 Pi 自己管理。
    }
    this.factory = undefined;
  }

  /** 幂等释放。会话结束时调用。 */
  dispose(): void {
    this.restoreEditor();
    this.enabled = false;
    this.ctx = undefined;
  }
}
