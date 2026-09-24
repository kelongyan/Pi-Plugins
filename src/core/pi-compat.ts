/**
 * 对宿主 Pi 运行时能力的集中探测。
 *
 * Pi 的消息组件构造器虽然是包导出，但并不在官方扩展契约
 * （docs/extensions.md）承诺的范围内。本文件是这类依赖的唯一集中点：
 * Pi 升级后只需检查这里，检测失败一律 fail-closed（关闭功能但保留用户偏好）。
 */

import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

/** 需要包装 render 的消息组件清单。 */
export const PI_MESSAGE_COMPONENTS = {
  UserMessageComponent,
  AssistantMessageComponent,
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  CompactionSummaryMessageComponent,
  BranchSummaryMessageComponent,
  ToolExecutionComponent,
  BashExecutionComponent,
} as const;

export type PiComponentMap = Record<string, any>;

export type PiTuiMode = "regular" | "fullscreen";

export type PiRuntimeCapabilities = {
  /** ① 消息外框：需要全部消息组件的 prototype.render 可用。 */
  messageFrame: { supported: boolean; failures: Map<string, string> };
  /** ② 思考过程：需要 AssistantMessageComponent.prototype.updateContent 可用。 */
  thinking: { supported: boolean; failure?: string };
  /** ③ 输入框线框：需要 Pi fullscreen TUI 模式。 */
  inputFrame: { supported: boolean; failure?: string; tuiMode?: PiTuiMode };
};

/** 只有真实交互式 TUI 会话才允许触碰渲染资源。 */
export function isTuiSessionContext(ctx: unknown): boolean {
  const candidate = ctx as { mode?: unknown; hasUI?: unknown } | undefined;
  return candidate?.mode === "tui" && candidate?.hasUI === true;
}

export function readPiTuiMode(tui: unknown): PiTuiMode | undefined {
  try {
    const mode = (tui as { mode?: unknown } | undefined)?.mode;
    return mode === "regular" || mode === "fullscreen" ? mode : undefined;
  } catch {
    return undefined;
  }
}

export function inspectPiRuntimeCapabilities(
  tui?: unknown,
  components: PiComponentMap = PI_MESSAGE_COMPONENTS,
): PiRuntimeCapabilities {
  const failures = new Map<string, string>();
  for (const [id, ctor] of Object.entries(components)) {
    if (!ctor) {
      failures.set(id, "component constructor missing");
      continue;
    }
    if (!ctor.prototype || typeof ctor.prototype.render !== "function") {
      failures.set(id, "prototype.render missing");
    }
  }

  const assistantPrototype = components.AssistantMessageComponent?.prototype as any;
  const thinkingFailure =
    typeof assistantPrototype?.updateContent === "function"
      ? undefined
      : "AssistantMessageComponent.prototype.updateContent missing";

  const tuiMode = readPiTuiMode(tui);
  const inputFrameFailure =
    tui !== undefined && tuiMode !== "fullscreen"
      ? `需要 Pi fullscreen TUI 模式，当前检测为 ${tuiMode ?? "unknown"}`
      : undefined;

  return {
    messageFrame: { supported: failures.size === 0, failures },
    thinking: { supported: thinkingFailure === undefined, failure: thinkingFailure },
    inputFrame: { supported: inputFrameFailure === undefined, failure: inputFrameFailure, tuiMode },
  };
}

/** 汇总为可读的失败清单（用于日志与 /zxdl 状态输出）。 */
export function formatPiCapabilityFailures(capabilities: PiRuntimeCapabilities): string[] {
  const out = [...capabilities.messageFrame.failures].map(([id, reason]) => `message-frame ${id}: ${reason}`);
  if (capabilities.thinking.failure) out.push(`thinking: ${capabilities.thinking.failure}`);
  if (capabilities.inputFrame.failure) out.push(`input-frame: ${capabilities.inputFrame.failure}`);
  return out;
}
