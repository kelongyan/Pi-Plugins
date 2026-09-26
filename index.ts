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
import {
  installScrollIndicatorHider,
  type ScrollIndicatorHandle,
} from "./src/core/scroll-indicator.ts";
import { ResourceStack, TuiOwnership } from "./src/core/session.ts";
import { resolveTheme } from "./src/core/theme.ts";
import { InputFrameRuntime, StreamSpeedTracker } from "./src/features/input-frame/index.ts";
import { installMessageFrame, type MessageFrameHandle } from "./src/features/message-frame/index.ts";
import { installStartupHeader, countMcpServers, type StartupHeaderHandle } from "./src/features/startup-header.ts";
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
  let scrollIndicatorHandle: ScrollIndicatorHandle | undefined;
  let headerHandle: StartupHeaderHandle | undefined;

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
        style: settings.style,
        assistantFrame: settings.messageFrame.assistantFrame,
        userFrame: settings.messageFrame.userFrame,
        thinkingFrame: settings.thinking.enabled,
        assistantAnchor: settings.assistantAnchor,
        bashFrame: settings.bashFrame,
        diffHighlight: settings.diffHighlight,
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

    // ③ 隐藏「↓ Jump to latest message」滚动提示（Pi 无官方开关，走 method-patch）。
    const wantsHideIndicator = settings.enabled && settings.hideScrollToEnd;
    if (wantsHideIndicator && !scrollIndicatorHandle) {
      scrollIndicatorHandle = installScrollIndicatorHider();
      console.debug?.(
        scrollIndicatorHandle
          ? "[pi-zxdl] 滚动提示已隐藏"
          : "[pi-zxdl] scroll-indicator: Pi 内部结构不匹配，跳过隐藏（fail-closed）",
      );
    } else if (!wantsHideIndicator && scrollIndicatorHandle) {
      scrollIndicatorHandle.dispose();
      scrollIndicatorHandle = undefined;
      console.debug?.("[pi-zxdl] 滚动提示已恢复（Pi 原生行为）");
    }

    // ④ 自定义启动画面（官方 ctx.ui.setHeader 同槽位替换；前置：Pi quietStartup 已开启）。
    const wantsHeader = settings.enabled && settings.startup.enabled && currentCtx !== undefined;
    if (wantsHeader && !headerHandle) {
      // MCP 计数只在安装时读一次配置文件（同步毫秒级），缓存进闭包——render 每帧零磁盘开销。
      const ctxCwd = (currentCtx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      let mcpCount = 0;
      try {
        mcpCount = countMcpServers(ctxCwd);
      } catch {
        // MCP 配置不可读时按 0 展示，不影响其余计数。
      }
      headerHandle = installStartupHeader(currentCtx, {
        theme: resolveTheme(),
        isIdle: () => {
          try {
            return (currentCtx as { isIdle?: () => boolean } | undefined)?.isIdle?.() ?? true;
          } catch {
            return true;
          }
        },
        getResourceCounts: () => {
          try {
            // skills 按 Pi 官方口径取自命令来源标记。
            const commands = pi.getCommands();
            return {
              tools: pi.getAllTools().length,
              commands: commands.filter((c) => c.source !== "skill").length,
              skills: commands.filter((c) => c.source === "skill").length,
              mcp: mcpCount,
            };
          } catch {
            return { tools: 0, commands: 0, skills: 0, mcp: mcpCount };
          }
        },
      });
      console.debug?.(
        headerHandle
          ? "[pi-zxdl] 启动画面已接管（自定义 logo header）"
          : "[pi-zxdl] startup-header: ctx.ui.setHeader 不可用，跳过（fail-closed）",
      );
    } else if (!wantsHeader && headerHandle) {
      headerHandle.dispose();
      headerHandle = undefined;
      console.debug?.("[pi-zxdl] 启动画面已恢复（Pi 原生横幅）");
    }
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
    headerHandle = undefined;
    scrollIndicatorHandle = undefined;
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
      headerHandle?.dispose();
      headerHandle = undefined;
      scrollIndicatorHandle?.dispose();
      scrollIndicatorHandle = undefined;
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
