/**
 * pi-zxdl 扩展入口。
 *
 * 只做装配：注册命令、维护会话生命周期、在 session_start 执行能力探测。
 * 具体 UI 功能在 P1–P3 接入，各自以 features/ 下的模块提供 install / dispose。
 *
 * 遵守官方契约（docs/extensions.md）：
 * - factory 内不启动定时器或长驻资源
 * - 长驻资源从 session_start 起
 * - session_shutdown 的清理幂等
 * - 只有交互式 TUI 会话（ctx.mode === "tui" && ctx.hasUI）才触碰渲染资源
 *
 * P0 阶段：基础设施就绪，不安装任何补丁。
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
import { installMessageFrame, resolveTheme } from "./src/features/message-frame/index.ts";
import { cloneSettings, isFeatureActive, type ZxdlSettings } from "./src/settings/schema.ts";
import { readPersistedSettings } from "./src/settings/store.ts";

export type ZxdlRuntimeDeps = {
  /** 测试注入点：替换能力探测。 */
  inspectCapabilities?: () => PiRuntimeCapabilities;
};

export function registerZxdlExtension(pi: ExtensionAPI, deps: ZxdlRuntimeDeps = {}): void {
  const inspectCapabilities =
    deps.inspectCapabilities ?? ((): PiRuntimeCapabilities => inspectPiRuntimeCapabilities());

  const ownership = new TuiOwnership();
  let resources = new ResourceStack();
  let settings: ZxdlSettings = readPersistedSettings();
  let capabilities: PiRuntimeCapabilities | undefined;

  const getStatus = (): ZxdlStatus => ({
    settings: cloneSettings(settings),
    active: ownership.isOwner(),
    capabilities,
    failures: capabilities ? formatPiCapabilityFailures(capabilities) : [],
  });

  registerZxdlCommand(pi, { getStatus });

  pi.on("session_start", (_event: any, ctx: any) => {
    // 无 UI 的子代理与会话共用进程，绝不能篡改主 TUI 的渲染资源。
    if (!isTuiSessionContext(ctx)) return;

    ownership.acquire();
    resources = new ResourceStack();
    settings = readPersistedSettings();
    capabilities = inspectCapabilities();

    for (const failure of formatPiCapabilityFailures(capabilities)) {
      console.debug?.(`[pi-zxdl] ${failure}`);
    }

    // ① 消息对话框外框（含思考过程框）
    if (isFeatureActive(settings, "messageFrame")) {
      if (capabilities.messageFrame.supported) {
        const frame = installMessageFrame(resolveTheme, {
          thinkingFrame: settings.thinking.enabled,
        });
        if (frame) {
          resources.add(frame);
          console.debug?.(`[pi-zxdl] message-frame 已接管 ${frame.patchCount} 个组件：${frame.targets.join(", ")}`);
        } else {
          console.debug?.("[pi-zxdl] message-frame: 没有组件被成功包装，已跳过");
        }
      } else {
        // fail-closed：能力不满足只关闭功能，不动用户偏好。
        console.debug?.("[pi-zxdl] message-frame: 宿主能力不满足，已跳过（保留用户偏好）");
      }
    }

    // P2–P3：思考过程动画、输入框线框在此接入。
  });

  pi.on("session_shutdown", () => {
    // 只有当前 owner 有权释放；子代理的 shutdown 必须无副作用。
    if (!ownership.isOwner()) return;
    try {
      resources.dispose();
    } finally {
      ownership.release();
    }
  });
}

export default function zxdl(pi: ExtensionAPI): void {
  registerZxdlExtension(pi);
}
