/**
 * 消息外框的组件包装层。
 *
 * 用 installMethodPatch 包装消息组件的 `prototype.render`：
 * 先用「内宽」（width - 4）调用原始 render 拿到内容行，再把它们包进外框。
 *
 * ⚠️ 本文件读取的组件实例字段（toolName / isPartial / result / status / exitCode /
 * hideThinkingBlock / lastMessage）属于 **Pi 内部结构**，不在官方扩展契约承诺范围内。
 * 所有这类依赖集中在本文件，且读取一律带防御；Pi 升级后只需检查这里。
 *
 * 状态判定口径参考 alps-pi `src/features/chrome-frame/patch.ts`（MIT, MrCKR）。
 */

import { disposeMethodPatch, installMethodPatch, type MethodPatch } from "../../core/method-patch.ts";
import { patchSlot } from "../../core/patch-keys.ts";
import { PI_MESSAGE_COMPONENTS } from "../../core/pi-compat.ts";
import {
  MIN_BOX_WIDTH,
  renderAnchoredMessage,
  renderAssistantAnchorLine,
  renderMessageBox,
  renderThinkingBox,
} from "./chrome.ts";
import { applyZoneMarkers, renderAssistantSegments, renderAssistantSegmentsMinimal } from "./segments.ts";
import { type ThemeLike } from "../../core/theme.ts";
import { frameLabel, resolveStyleKind, type MessageKind, type ToolStatus } from "./styles.ts";
import { transformEditDiffLines } from "../diff-highlight.ts";
import { renderBashInline } from "./bash-inline.ts";

/** 组件导出名 → 基础消息类型。 */
const COMPONENT_KIND: Record<string, MessageKind> = {
  UserMessageComponent: "user",
  AssistantMessageComponent: "assistant",
  CustomMessageComponent: "custom",
  SkillInvocationMessageComponent: "skill",
  CompactionSummaryMessageComponent: "compaction",
  BranchSummaryMessageComponent: "branch",
  ToolExecutionComponent: "toolPending",
  BashExecutionComponent: "bash",
};

function asLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 判断一条 assistant 消息是否「只有思考内容、没有正文」。
 * 只看原始 content 块，不从渲染后的 TUI 子节点反推。
 */
function assistantContentKinds(instance: any): { hasThinking: boolean; hasText: boolean } {
  let content: unknown;
  try {
    content = instance?.lastMessage?.content;
  } catch {
    return { hasThinking: false, hasText: false };
  }
  if (!Array.isArray(content)) return { hasThinking: false, hasText: false };

  let hasThinking = false;
  let hasText = false;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type === "thinking" && isNonEmptyText(block.thinking)) hasThinking = true;
    if (block?.type === "text" && isNonEmptyText(block.text)) hasText = true;
  }
  return { hasThinking, hasText };
}

function isThinkingOnlyAssistant(instance: any): boolean {
  const { hasThinking, hasText } = assistantContentKinds(instance);
  return hasThinking && !hasText;
}

function deriveToolStatus(instance: any): ToolStatus {
  try {
    if (instance?.isPartial !== false) return "pending";
    if (instance?.result?.isError) return "error";
    return "success";
  } catch {
    return "pending";
  }
}

function deriveBashStatus(instance: any): ToolStatus {
  try {
    if (instance?.status === "error" || instance?.status === "cancelled") return "error";
    if (instance?.status === "complete") return "success";
    if (typeof instance?.exitCode === "number") return instance.exitCode === 0 ? "success" : "error";
  } catch {
    // 读不到状态时按 pending 处理，仅影响配色，不影响内容展示。
  }
  return "pending";
}

function deriveStatus(baseKind: MessageKind, instance: any): ToolStatus | undefined {
  if (baseKind === "toolPending") return deriveToolStatus(instance);
  if (baseKind === "bash") return deriveBashStatus(instance);
  return undefined;
}

function deriveToolName(baseKind: MessageKind, instance: any): string | undefined {
  if (baseKind !== "toolPending" && baseKind !== "bash") return undefined;
  try {
    const name = instance?.toolName;
    return typeof name === "string" && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

/** 摘要候选字段（参考 MiniMax formatTuiToolSummary 的键序，cwd 供 shell 类兜底）。 */
const ARGS_SUMMARY_KEYS = [
  "path",
  "filePath",
  "file_path",
  "command",
  "query",
  "pattern",
  "url",
  "description",
  "cwd",
] as const;

function firstLineOf(value: string): string {
  return value.split(/\r?\n/u, 1)[0]?.trim() ?? "";
}

/**
 * 从工具 args（Pi 内部结构，tool-execution.js 的 constructor 存对象）提取一行摘要。
 * 流式期间 args 可能不完整——任何异常都返回 undefined，调用方回退原生首行。
 */
function deriveToolSummary(instance: any): string | undefined {
  try {
    const args = instance?.args;
    if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
    const record = args as Record<string, unknown>;
    for (const key of ARGS_SUMMARY_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return firstLineOf(value.trim());
      if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")) {
        const joined = value.map((item) => String(item).trim()).filter(Boolean).join(" ");
        if (joined) return firstLineOf(joined);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 该 assistant 消息的思考块是否处于折叠状态（折叠时用紧凑思考框）。 */
function isHiddenThinking(instance: any): boolean {
  try {
    return instance?.hideThinkingBlock === true;
  } catch {
    return false;
  }
}

/** 消息外框的运行时配置。每次 render 时读取，因此设置变更无需重新安装补丁即可生效。 */
export type MessageFrameConfig = {
  /** 呈现风格：minimal = 锚点 + gutter（默认）；boxed = 经典外框（兼容旧行为）。 */
  style: "minimal" | "boxed";
  /** 助手回复是否接管（关闭后完全交还 Pi 原生渲染）。 */
  assistantFrame: boolean;
  /** 用户消息是否接管。 */
  userFrame: boolean;
  /** 思考块是否用独立呈现（关闭后退回普通 assistant 呈现）。 */
  thinkingFrame: boolean;
  /** minimal 下 assistant 正文前是否加一行 `●` 锚点。 */
  assistantAnchor: boolean;
  /** minimal 下 bash 是否保留经典单框（长输出视觉隔离用）。 */
  bashFrame: boolean;
  /** edit 工具 diff 视图是否做行内语法高亮（Pi 原生只有整行红/绿）。 */
  diffHighlight: boolean;
};

export const DEFAULT_MESSAGE_FRAME_CONFIG: MessageFrameConfig = {
  style: "minimal",
  assistantFrame: true,
  userFrame: true,
  thinkingFrame: true,
  assistantAnchor: false,
  bashFrame: false,
  diffHighlight: true,
};

/**
 * 构造新的 render。
 *
 * 行为契约：
 * - 任何异常都回退到原始 render；原始 render 也失败时返回空数组
 * - 宽度不足时直接回退原始输出，不尝试画框
 * - 配置里关闭的类型直接交还 Pi 原生渲染
 */
export function createWrappedRender(
  baseKind: MessageKind,
  originalRender: (...args: any[]) => unknown,
  getTheme: () => ThemeLike,
  getConfig: () => Partial<MessageFrameConfig> = () => DEFAULT_MESSAGE_FRAME_CONFIG,
): (this: any, width: number) => string[] {
  return function zxdlRender(this: any, width: number): string[] {
    const instance = this;
    const fallback = (): string[] => asLines(originalRender.call(instance, width));

    try {
      // getConfig 允许返回部分配置（补齐默认值），保证下游拿到的永远是完整对象。
      const config: MessageFrameConfig = { ...DEFAULT_MESSAGE_FRAME_CONFIG, ...getConfig() };

      // 该类型被显式关闭时，完全交还 Pi 原生渲染（不画框、不动内容）。
      if (baseKind === "user" && !config.userFrame) return fallback();
      if (baseKind === "assistant" && !config.assistantFrame) return fallback();

      const numericWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (numericWidth < MIN_BOX_WIDTH) return fallback();

      const status = deriveStatus(baseKind, instance);
      const toolName = deriveToolName(baseKind, instance);
      const theme = getTheme();

      // 本项目不做思考动画；thinkingFrame 关闭时思考内容退回普通 assistant 呈现。
      const thinkingOnly = config.thinkingFrame && baseKind === "assistant" && isThinkingOnlyAssistant(instance);

      // 用户消息在 minimal 下用纯箭头锚点（›，无框无背景）——原生 userMessageBg 背景条
      // 会在 renderAnchoredMessage 的 user 分支里被剥掉重排；boxed 风格仍走经典外框。

      // —— minimal：对话流零边框，锚点行 + gutter（bash 可选保留经典单框）——
      const bashWantsBox = baseKind === "bash" && config.bashFrame;
      if (config.style === "minimal" && !bashWantsBox) {
        if (baseKind === "assistant") {
          if (thinkingOnly) {
            const inner = asLines(originalRender.call(instance, Math.max(1, numericWidth - 2)));
            return renderAnchoredMessage("thinking", inner, numericWidth, { theme, status });
          }
          // 混合消息（思考 + 正文）：思考组加 ◆ Thinking 锚点，正文裸排；
          // 结构不匹配时回退裸排（与 boxed 分段共用安全网）。
          const segmented = renderAssistantSegmentsMinimal(instance, numericWidth, theme);
          if (segmented) {
            const hasToolCalls = Boolean((instance as { hasToolCalls?: unknown })?.hasToolCalls);
            return applyZoneMarkers(segmented, hasToolCalls);
          }
          // assistant 正文默认裸排（既定决策）：不加锚点、不画框，Pi 原生渲染。
          if (!config.assistantAnchor) return fallback();
          return renderAssistantAnchorLine(theme, fallback());
        }
        const inner = asLines(originalRender.call(instance, Math.max(1, numericWidth - 2)));
        const argsSummary = deriveToolSummary(instance);
        // edit 的 diff 视图加行内语法高亮（非 edit 工具原样返回）。
        const diffInner = config.diffHighlight
          ? transformEditDiffLines(toolName, instance, inner, theme)
          : inner;
        // shell 类工具（bash / powershell）：ZCode 式单行呈现（运行中 spinner 动态，
        // 完成后命令收进摘要行、输出保留折叠预览）；不适用时回退锚点呈现。
        if (toolName === "bash" || toolName === "powershell") {
          const argsRecord = instance?.args as Record<string, unknown> | undefined;
          const shellCommand = typeof argsRecord?.command === "string" ? argsRecord.command : undefined;
          const inline = renderBashInline({
            toolName,
            status: status ?? "pending",
            command: shellCommand,
            nativeLines: diffInner,
            theme,
            width: numericWidth,
          });
          if (inline) return inline;
        }
        return renderAnchoredMessage(baseKind, diffInner, numericWidth, {
          theme,
          toolName,
          status,
          summaryOverride: argsSummary,
        });
      }

      // —— boxed：经典外框（兼容旧行为）——
      // 标签用「原始 kind」，配色用「状态解析后的 kind」——两者必须分开，
      // 否则 bash 的标签会被错误地写成 TOOL。
      let labelKind = baseKind;
      if (thinkingOnly) labelKind = "thinking";

      const styleKind = resolveStyleKind(labelKind, status);
      const label = frameLabel(labelKind, toolName, status);

      // assistant 消息可能同时含思考块与正文：拆成各自独立的外框，
      // 否则它们会被 Pi 渲染成一个整体、进而被包进同一个框。
      if (baseKind === "assistant") {
        const segmented = renderAssistantSegments(instance, numericWidth, theme);
        if (segmented) {
          const hasToolCalls = Boolean((instance as { hasToolCalls?: unknown })?.hasToolCalls);
          return applyZoneMarkers(segmented, hasToolCalls);
        }
      }

      const rawInnerLines = asLines(originalRender.call(instance, Math.max(1, numericWidth - 4)));
      const innerLines = config.diffHighlight
        ? transformEditDiffLines(toolName, instance, rawInnerLines, theme)
        : rawInnerLines;
      // user 的原生内容行带 userMessageBg 背景，框内保留会形成「框里套条」的双重框感，
      // 剥掉后由外框独自承担分隔（pad 空行已在 chrome 层裁剪）。
      const options = { theme, label, toolName, status, stripBackground: baseKind === "user" };

      if (labelKind === "thinking" && isHiddenThinking(instance)) {
        return renderThinkingBox(innerLines, numericWidth, options);
      }
      return renderMessageBox(styleKind, innerLines, numericWidth, options);
    } catch {
      try {
        return fallback();
      } catch {
        return [];
      }
    }
  };
}

export type MessageFrameHandle = {
  /** 已成功包装的组件数量。 */
  readonly patchCount: number;
  /** 已包装的组件名。 */
  readonly targets: readonly string[];
  dispose(): void;
};

const OWNER = Symbol("pi-zxdl-message-frame-owner");

/**
 * 安装消息外框。
 * 返回 undefined 表示没有任何组件被成功包装（调用方应 fail-closed）。
 */
export function installMessageFrame(
  getTheme: () => ThemeLike,
  getConfig: () => MessageFrameConfig = () => DEFAULT_MESSAGE_FRAME_CONFIG,
): MessageFrameHandle | undefined {
  const components = PI_MESSAGE_COMPONENTS as unknown as Record<string, any>;
  const patches: MethodPatch[] = [];
  const targets: string[] = [];

  for (const [name, baseKind] of Object.entries(COMPONENT_KIND)) {
    const ctor = components[name];
    if (!ctor?.prototype) continue;

    const patch = installMethodPatch({
      slot: patchSlot(`message-frame.${name}`),
      target: ctor.prototype as Record<string, any>,
      method: "render",
      owner: OWNER,
      create: (original) => createWrappedRender(baseKind, original, getTheme, getConfig),
    });

    if (patch) {
      patches.push(patch);
      targets.push(name);
    }
  }

  if (patches.length === 0) return undefined;

  return {
    patchCount: patches.length,
    targets,
    dispose(): void {
      for (const patch of patches) disposeMethodPatch(patch);
      patches.length = 0;
    },
  };
}
