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
import { MIN_BOX_WIDTH, renderMessageBox, renderThinkingBox } from "./chrome.ts";
import { applyZoneMarkers, renderAssistantSegments } from "./segments.ts";
import { type ThemeLike } from "../../core/theme.ts";
import { frameLabel, resolveStyleKind, type MessageKind, type ToolStatus } from "./styles.ts";

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
  /** 助手回复是否加框。 */
  assistantFrame: boolean;
  /** 用户消息是否加框。 */
  userFrame: boolean;
  /** 思考块是否使用独立的 THINK 框（关闭后退回普通 ASSISTANT 框）。 */
  thinkingFrame: boolean;
};

export const DEFAULT_MESSAGE_FRAME_CONFIG: MessageFrameConfig = {
  assistantFrame: true,
  userFrame: true,
  thinkingFrame: true,
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
  getConfig: () => MessageFrameConfig = () => DEFAULT_MESSAGE_FRAME_CONFIG,
): (this: any, width: number) => string[] {
  return function zxdlRender(this: any, width: number): string[] {
    const instance = this;
    const fallback = (): string[] => asLines(originalRender.call(instance, width));

    try {
      const config = getConfig();

      // 该类型被显式关闭时，完全交还 Pi 原生渲染（不画框、不动内容）。
      if (baseKind === "user" && !config.userFrame) return fallback();
      if (baseKind === "assistant" && !config.assistantFrame) return fallback();

      const numericWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (numericWidth < MIN_BOX_WIDTH) return fallback();

      // 标签用「原始 kind」，配色用「状态解析后的 kind」——两者必须分开，
      // 否则 bash 的标签会被错误地写成 TOOL。
      // 本项目不做思考动画；thinkingFrame 关闭时思考内容退回普通 assistant 外框。
      let labelKind = baseKind;
      if (config.thinkingFrame && baseKind === "assistant" && isThinkingOnlyAssistant(instance)) {
        labelKind = "thinking";
      }

      const status = deriveStatus(baseKind, instance);
      const styleKind = resolveStyleKind(labelKind, status);
      const toolName = deriveToolName(baseKind, instance);
      const label = frameLabel(labelKind, toolName, status);
      const theme = getTheme();

      // assistant 消息可能同时含思考块与正文：拆成各自独立的外框，
      // 否则它们会被 Pi 渲染成一个整体、进而被包进同一个框。
      if (baseKind === "assistant") {
        const segmented = renderAssistantSegments(instance, numericWidth, theme);
        if (segmented) {
          const hasToolCalls = Boolean((instance as { hasToolCalls?: unknown })?.hasToolCalls);
          return applyZoneMarkers(segmented, hasToolCalls);
        }
      }

      const innerLines = asLines(originalRender.call(instance, Math.max(1, numericWidth - 4)));
      const options = { theme, label, toolName, status };

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
