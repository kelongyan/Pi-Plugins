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

// ---------------------------------------------------------------------------
// minimal（锚点）风格的符号表与 token 映射。
//
// 设计参考 MiniMax Code `transcript/presentation/content.ts` 的 statusPresentation：
// 对话流零边框，层级靠「符号锚点行 + │ 竖线引导 + 空行分组」表达。
// 注意：底部状态栏的 emoji 体系是独立保留项（用户明确偏好），与本表互不相干。
// ---------------------------------------------------------------------------

/** 对话流专用符号。每个符号全插件只用一个含义。 */
export const SYMBOLS = {
  /** 进行中。 */
  running: "●",
  /** 成功。 */
  success: "✓",
  /** 失败。 */
  error: "×",
  /** 思考。 */
  thinking: "◆",
  /** 弱信息（摘要类消息、耗时等元信息）。 */
  muted: "·",
} as const;

/** minimal 锚点行的 token 映射：anchor=符号，name=主体名，summary=摘要。 */
export type AnchorStyle = { anchor: string; name: string; summary: string };

/** 摘要类消息（custom/skill/compaction/branch）在 minimal 下的统一形态。 */
export const SUMMARY_KINDS: readonly MessageKind[] = ["custom", "skill", "compaction", "branch"];

function isSummaryKind(kind: MessageKind): boolean {
  return SUMMARY_KINDS.includes(kind);
}

/**
 * minimal 锚点的符号与配色。
 * 状态符号优先取显式 status，未提供时从 kind 推断（与 resolveStyleKind 口径一致）。
 */
export function anchorPresentation(
  kind: MessageKind,
  status?: ToolStatus,
): { symbol: string; style: AnchorStyle } {
  if (kind === "thinking") {
    return { symbol: SYMBOLS.thinking, style: { anchor: "muted", name: "muted", summary: "muted" } };
  }
  if (isSummaryKind(kind)) {
    return { symbol: SYMBOLS.muted, style: { anchor: "muted", name: "muted", summary: "muted" } };
  }

  // 工具与 bash：符号随状态变色。
  const resolved = resolveStyleKind(kind, status);
  if (resolved === "toolSuccess") {
    return { symbol: SYMBOLS.success, style: { anchor: "success", name: "toolTitle", summary: "muted" } };
  }
  if (resolved === "toolError") {
    return { symbol: SYMBOLS.error, style: { anchor: "error", name: "error", summary: "muted" } };
  }
  return { symbol: SYMBOLS.running, style: { anchor: "accent", name: "toolTitle", summary: "muted" } };
}

/** minimal 模式下的主体名：工具用工具名，bash 固定 bash，其余类型不显示主体名。 */
export function anchorName(kind: MessageKind, toolName?: string): string | undefined {
  if (kind === "toolPending" || kind === "toolSuccess" || kind === "toolError") {
    return toolName && toolName.length > 0 ? toolName : "tool";
  }
  if (kind === "bash") return "bash";
  if (kind === "thinking") return "Thinking";
  return undefined;
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
