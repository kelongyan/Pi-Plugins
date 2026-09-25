/**
 * pi-zxdl 扩展入口。
 *
 * 只做装配：注册命令、维护会话生命周期、在 session_start 执行能力探测。
 *
 * 遵守官方契约（docs/extensions.md）：
 * - factory 内不启动定时器或长驻资源
 * - 长驻资源从 session_start 起
 * - session_shutdown 的清理幂等
 * - 只有交互式 TUI 会话（ctx.mode === "tui" && ctx.hasUI）才触碰渲染资源
 *
 * 设置即时生效：`applyRuntime()` 是唯一的应用入口 ——
 * session_start 与「设置面板改动」都走它，避免出现两套漂移的逻辑。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerZxdlCommand, type ZxdlStatus } from "./src/commands.ts";
import {
  formatPiCapabilityFailures,
  inspectPiRuntimeCapabilities,
  isTuiSessionContext,
  type PiRuntimeCapabilities,
} from "./src/core/pi-compat.ts";
import { ResourceStack, TuiOwnership } from "./src/core/session.ts";
import { resolveTheme } from "./src/core/theme.ts";
import { InputFrameRuntime, StreamSpeedTracker } from "./src/features/input-frame/index.ts";
import { installMessageFrame, type MessageFrameHandle } from "./src/features/message-frame/index.ts";
import { cloneSettings, isFeatureActive, type ZxdlSettings } from "./src/settings/schema.ts";
import {
  readPersistedSettings,
  readRootSettingsSnapshot,
  writePersistedSettings,
} from "./src/settings/store.ts";
import { applyDefaultTheme, type ThemeUiLike } from "./src/settings/theme.ts";

export type ZxdlRuntimeDeps = {
  /** 测试注入点：替换能力探测。 */
  inspectCapabilities?: () => PiRuntimeCapabilities;
};

export function registerZxdlExtension(pi: ExtensionAPI, deps: ZxdlRuntimeDeps = {}): void {
  const inspectCapabilities =
    deps.inspectCapabilities ?? ((): PiRuntimeCapabilities => inspectPiRuntimeCapabilities());

  const ownership = new TuiOwnership();
  const speedTracker = new StreamSpeedTracker();
  const inputFrameRuntime = new InputFrameRuntime({
    getTokensPerSecond: () => speedTracker.tokensPerSecond,
  });
  let resources = new ResourceStack();
  let settings: ZxdlSettings = readPersistedSettings();
  let capabilities: PiRuntimeCapabilities | undefined;
  let currentCtx: unknown;
  let frameHandle: MessageFrameHandle | undefined;

  const getStatus = (): ZxdlStatus => ({
    settings: cloneSettings(settings),
    active: ownership.isOwner(),
    capabilities,
    failures: capabilities ? formatPiCapabilityFailures(capabilities) : [],
  });

  /**
   * 按当前 settings 应用运行时状态。
   * 消息外框的子开关由补丁内部动态读取，因此这里只负责「装 / 卸」。
   */
  const applyRuntime = (): void => {
    // ① 消息外框（含思考过程框）
    const wantsFrame =
      isFeatureActive(settings, "messageFrame") && Boolean(capabilities?.messageFrame.supported);

    if (wantsFrame && !frameHandle) {
      frameHandle = installMessageFrame(resolveTheme, () => ({
        assistantFrame: settings.messageFrame.assistantFrame,
        userFrame: settings.messageFrame.userFrame,
        thinkingFrame: settings.thinking.enabled,
      }));
      if (frameHandle) {
        resources.add(frameHandle);
        console.debug?.(
          `[pi-zxdl] message-frame 已接管 ${frameHandle.patchCount} 个组件：${frameHandle.targets.join(", ")}`,
        );
      } else {
        console.debug?.("[pi-zxdl] message-frame: 没有组件被成功包装，已跳过");
      }
    } else if (!wantsFrame && frameHandle) {
      frameHandle.dispose();
      frameHandle = undefined;
      console.debug?.("[pi-zxdl] message-frame 已卸载（设置关闭或能力不满足）");
    }

    // ② 输入框线框 + 底部状态栏（线框需要 Pi 的 fullscreen TUI 模式）
    const canTakeEditor = Boolean(capabilities?.inputFrame.supported);
    const wantsInputFrame = isFeatureActive(settings, "inputFrame") && canTakeEditor;
    const wantsStatusBar = settings.enabled && settings.statusBar.enabled && canTakeEditor;

    if (currentCtx) inputFrameRuntime.bindSession(currentCtx);
    inputFrameRuntime.configure({
      ...settings.inputFrame,
      enabled: wantsInputFrame,
      statusBarEnabled: wantsStatusBar,
      statusBarIcons: settings.statusBar.icons,
      statusBarSegments: settings.statusBar.segments,
    });
  };

  /** 保存配置：先落盘，再应用。写盘失败只记录，不阻断本次生效。 */
  const saveSettings = (next: ZxdlSettings): void => {
    settings = cloneSettings(next);
    const result = writePersistedSettings(settings);
    if (!result.ok) console.debug?.(`[pi-zxdl] 配置写入失败：${result.error}`);
    applyRuntime();
  };

  registerZxdlCommand(pi, {
    getStatus,
    getSettings: () => cloneSettings(settings),
    saveSettings,
  });

  pi.on("session_start", (_event: any, ctx: any) => {
    // 无 UI 的子代理与会话共用进程，绝不能篡改主 TUI 的渲染资源。
    if (!isTuiSessionContext(ctx)) return;

    ownership.acquire();
    resources = new ResourceStack();
    currentCtx = ctx;
    frameHandle = undefined;
    speedTracker.reset();
    settings = readPersistedSettings();
    capabilities = inspectCapabilities();

    for (const failure of formatPiCapabilityFailures(capabilities)) {
      console.debug?.(`[pi-zxdl] ${failure}`);
    }

    // 自带主题（Eva）：只在用户尚未自定义主题时接管，避免改完又被改回去。
    const themeSetting = readRootSettingsSnapshot()?.theme;
    const appliedTheme = applyDefaultTheme(
      (ctx as { ui?: ThemeUiLike } | undefined)?.ui,
      typeof themeSetting === "string" ? themeSetting : undefined,
    );
    if (appliedTheme) console.debug?.(`[pi-zxdl] 已应用自带主题：${appliedTheme}`);

    applyRuntime();
  });

  // 流式速度跟踪：只在持锁的 TUI 会话里累计。
  pi.on("message_update", (event: any) => {
    if (!ownership.isOwner()) return;
    speedTracker.onStream(event?.message?.usage);
  });

  pi.on("agent_end", () => {
    if (!ownership.isOwner()) return;
    // 一轮结束：冻结速度（空闲时显示上一次的值，而不是瞬间归零）。
    speedTracker.onIdle();
  });

  pi.on("session_shutdown", () => {
    // 只有当前 owner 有权释放；子代理的 shutdown 必须无副作用。
    if (!ownership.isOwner()) return;
    try {
      frameHandle = undefined;
      inputFrameRuntime.dispose();
      resources.dispose();
    } finally {
      currentCtx = undefined;
      ownership.release();
    }
  });
}

export default function zxdl(pi: ExtensionAPI): void {
  registerZxdlExtension(pi);
}
