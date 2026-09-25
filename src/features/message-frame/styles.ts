/**
 * 消息外框的类型、主题 token 映射与标签。
 *
 * token 映射策略参考 alps-pi `src/features/chrome-frame/styles.ts`（MIT, MrCKR）：
 * 绘制层只引用语义 token，实际颜色一律来自当前 Pi 主题，因此换主题即换色，无需改代码。
 */

/** 主题接口统一由 core/theme 提供，这里 re-export 以保持既有引用可用。 */
export type { ThemeLike } from "../../core/theme.ts";

/** 消息分块类型。 */
export type MessageKind =
  | "user"
  | "assistant"
  | "thinking"
  | "custom"
  | "skill"
  | "compaction"
  | "branch"
  | "toolPending"
  | "toolSuccess"
  | "toolError"
  | "bash";

/** 工具执行状态。 */
export type ToolStatus = "pending" | "success" | "error";

export type FrameStyle = {
  /** 边框色 token。 */
  border: string;
  /** 标签色 token。 */
  label: string;
  /** 正文色 token。 */
  text: string;
};

export const FRAME_STYLES: Record<MessageKind, FrameStyle> = {
  user: { border: "borderAccent", label: "accent", text: "userMessageText" },
  assistant: { border: "borderMuted", label: "accent", text: "text" },
  thinking: { border: "borderMuted", label: "accent", text: "text" },
  custom: { border: "borderAccent", label: "customMessageLabel", text: "customMessageText" },
  skill: { border: "borderAccent", label: "customMessageLabel", text: "customMessageText" },
  compaction: { border: "borderMuted", label: "muted", text: "text" },
  branch: { border: "borderMuted", label: "muted", text: "text" },
  toolPending: { border: "borderAccent", label: "toolTitle", text: "toolOutput" },
  toolSuccess: { border: "success", label: "toolTitle", text: "toolOutput" },
  toolError: { border: "error", label: "toolTitle", text: "toolOutput" },
  bash: { border: "borderAccent", label: "toolTitle", text: "toolOutput" },
};

/**
 * 工具与 bash 按执行状态落到具体 token 组。
 *
 * 注意：这只影响**配色**，不影响标签 —— 标签始终用原始 kind，
 * 否则 BASH 会被错误地写成 TOOL。这一点与 alps-pi 的 normalizeKind 口径一致。
 */
export function resolveStyleKind(kind: MessageKind, status?: ToolStatus): MessageKind {
  if (kind === "toolPending" || kind === "bash") {
    if (status === "error") return "toolError";
    if (status === "success") return "toolSuccess";
    if (status === "pending") return "toolPending";
  }
  return kind;
}

export function frameStyle(kind: MessageKind): FrameStyle {
  return FRAME_STYLES[kind] ?? FRAME_STYLES.assistant;
}

/** 顶边框上的标签文本。状态符号只加在 TOOL 上，BASH 保持纯标签。 */
export function frameLabel(kind: MessageKind, toolName?: string, status?: ToolStatus): string {
  const tool = toolName ? ` ${toolName}` : "";
  // 状态符号优先取显式 status；未提供时从 kind 推断，方便直接按 kind 渲染的场景。
  const mark =
    status === "success" || kind === "toolSuccess"
      ? " ✓"
      : status === "error" || kind === "toolError"
        ? " ✗"
        : "";
  switch (kind) {
    case "user":
      return "USER";
    case "assistant":
      return "ASSISTANT";
    case "thinking":
      return "THINK";
    case "custom":
      return "CUSTOM";
    case "skill":
      return "SKILL";
    case "compaction":
      return "COMPACT";
    case "branch":
      return "BRANCH";
    case "bash":
      return "BASH";
    case "toolPending":
    case "toolSuccess":
    case "toolError":
      return `TOOL${tool}${mark}`;
    default:
      return "MESSAGE";
  }
}
