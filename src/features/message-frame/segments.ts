/**
 * assistant 消息的分段渲染。
 *
 * 背景：Pi 把一条 assistant 消息的所有内容块渲染成**一个整体**，
 * 因此思考块与正文会被包进同一个外框。本模块把它们拆成各自独立的框。
 *
 * 实现依据（读取自 pi-coding-agent 的 AssistantMessageComponent.updateContent）：
 * 它按 message.content 的顺序，向 contentContainer 逐个添加子组件 ——
 * text 块 → 一个 Markdown；连续 thinking 段 → 一个 Text（折叠）或 Markdown（展开）；
 * 块之间按需插入 Spacer。因此 content 的顺序可以**推导出子组件的类型序列**，
 * 从而把「思考子组件」与「正文子组件」分成两组，各自渲染、各自包框。
 *
 * ⚠️ 这是对 Pi 内部结构的依赖。任何不匹配（数量对不上、结构变化）都会返回 null，
 * 由调用方回退到「整条一个框」的原始行为，不会让渲染失败。
 */

import { SYMBOLS } from "./styles.ts";
import { renderMessageBox } from "./chrome.ts";
import type { ThemeLike } from "../../core/theme.ts";

/** 子组件对应的内容块类型。 */
export type SegmentKind = "thinking" | "text" | "spacer";

/** OSC133 shell 集成标记，取值与 Pi 的 AssistantMessageComponent 一致。 */
export const OSC133_ZONE_START = "\x1b]133;A\x07";
export const OSC133_ZONE_END = "\x1b]133;B\x07";
export const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export type SegmentGroup = {
  kind: "thinking" | "text";
  children: unknown[];
};

function isVisibleBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false;
  const candidate = block as { type?: unknown; text?: unknown; thinking?: unknown };
  if (candidate.type === "text") return typeof candidate.text === "string" && candidate.text.trim().length > 0;
  if (candidate.type === "thinking") {
    return typeof candidate.thinking === "string" && candidate.thinking.trim().length > 0;
  }
  return false;
}

/**
 * 推导 contentContainer 的子组件类型序列。
 * 与 Pi 的 updateContent 一一对应；结构变化时长度校验会失败并触发回退。
 */
export function expectedSegmentKinds(message: unknown): SegmentKind[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];

  const blocks = content as unknown[];
  const kinds: SegmentKind[] = [];

  if (blocks.some(isVisibleBlock)) kinds.push("spacer");

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const type = (block as { type?: unknown } | undefined)?.type;

    if (type === "text" && isVisibleBlock(block)) {
      kinds.push("text");
      continue;
    }

    if (type === "thinking") {
      let hasThinking = false;
      for (; index < blocks.length; index += 1) {
        const current = blocks[index];
        if ((current as { type?: unknown } | undefined)?.type !== "thinking") break;
        if (isVisibleBlock(current)) hasThinking = true;
      }
      index -= 1;
      if (!hasThinking) continue;

      kinds.push("thinking");
      const hasVisibleAfter = blocks.slice(index + 1).some(isVisibleBlock);
      if (hasVisibleAfter) kinds.push("spacer");
    }
  }

  return kinds;
}

/**
 * 按类型把子组件分组，连续同类合并。
 * 返回 null 表示子组件与推导出的序列不匹配（调用方应回退）。
 */
export function groupContentChildren(
  children: unknown,
  kinds: readonly SegmentKind[],
): SegmentGroup[] | null {
  if (!Array.isArray(children)) return null;
  if (children.length !== kinds.length) return null;

  const groups: SegmentGroup[] = [];
  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index];
    if (kind !== "thinking" && kind !== "text") continue;

    const previous = groups.at(-1);
    if (previous && previous.kind === kind) previous.children.push(children[index]);
    else groups.push({ kind, children: [children[index]] });
  }

  return groups;
}

function asLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

/**
 * 判断这条 assistant 消息是否需要拆框，并生成拆框后的行。
 *
 * 返回 undefined 表示「无需拆框或结构不匹配」，调用方走原有单框逻辑。
 */
export function renderAssistantSegments(
  instance: unknown,
  width: number,
  theme: ThemeLike,
): string[] | undefined {
  try {
    const holder = instance as { lastMessage?: unknown; contentContainer?: { children?: unknown } };
    const kinds = expectedSegmentKinds(holder?.lastMessage);
    if (kinds.length === 0) return undefined;

    const groups = groupContentChildren(holder?.contentContainer?.children, kinds);
    if (!groups) return undefined;
    // 只有一组时无需拆分，交给原有的单框路径（保持标签等行为一致）。
    if (groups.length < 2) return undefined;

    const innerWidth = Math.max(1, Math.floor(width) - 4);
    const output: string[] = [];

    for (const [index, group] of groups.entries()) {
      const lines: string[] = [];
      for (const child of group.children) {
        const render = (child as { render?: (w: number) => unknown } | undefined)?.render;
        if (typeof render !== "function") continue;
        lines.push(...asLines(render.call(child, innerWidth)));
      }

      // 段与段之间留一个空行，让两个框在视觉上明确分开。
      if (index > 0) output.push("");

      output.push(
        ...renderMessageBox(group.kind === "thinking" ? "thinking" : "assistant", lines, width, {
          theme,
          label: group.kind === "thinking" ? "THINK" : "ASSISTANT",
        }),
      );
    }

    return output;
  } catch {
    // 结构不符或渲染异常时静默回退，绝不影响宿主渲染。
    return undefined;
  }
}

/**
 * minimal 风格的 assistant 分段：思考组前加一行 `◆ Thinking` 锚点，正文组裸排。
 *
 * 仅处理「思考 + 正文」混合消息（单组消息交给调用方走原有路径）。
 * 思考内容保持 Pi 原生渲染（斜体灰、全宽）；折叠态下原生只有一行 "Thinking…" 文案，
 * 与锚点重复，直接吞掉。
 *
 * 返回 undefined 表示结构不匹配（调用方回退裸排，与 boxed 分段的安全网一致）。
 */
export function renderAssistantSegmentsMinimal(
  instance: unknown,
  width: number,
  theme: ThemeLike,
): string[] | undefined {
  try {
    const holder = instance as { lastMessage?: unknown; contentContainer?: { children?: unknown } };
    const kinds = expectedSegmentKinds(holder?.lastMessage);
    if (kinds.length === 0) return undefined;

    const groups = groupContentChildren(holder?.contentContainer?.children, kinds);
    if (!groups) return undefined;
    if (groups.length < 2) return undefined;

    const innerWidth = Math.max(1, Math.floor(width));
    const output: string[] = [];

    for (const [index, group] of groups.entries()) {
      const lines: string[] = [];
      for (const child of group.children) {
        const render = (child as { render?: (w: number) => unknown } | undefined)?.render;
        if (typeof render !== "function") continue;
        lines.push(...asLines(render.call(child, innerWidth)));
      }

      if (index > 0) output.push("");

      if (group.kind === "thinking") {
        output.push(theme.fg("muted", `${SYMBOLS.thinking} Thinking`));
        output.push(...lines.filter((line) => !isHiddenThinkingLabelLine(line)));
      } else {
        output.push(...lines);
      }
    }

    return output;
  } catch {
    // 结构不符或渲染异常时静默回退，绝不影响宿主渲染。
    return undefined;
  }
}

/** 折叠态思考的原生占位行（"Thinking…" / "Thinking complete"），minimal 下由锚点行替代。 */
function isHiddenThinkingLabelLine(line: string): boolean {
  const text = String(line)
    // 剥 SGR 后再匹配，避免着色影响判定。
    .replace(/\x1b\[[0-9;:]*m/gu, "")
    .trim();
  return /^Thinking(\.{3}|…| complete)?$/u.test(text);
}

/** 补回 Pi 原生 render 会加的 OSC133 边界标记（有工具调用时不加）。 */
export function applyZoneMarkers(lines: string[], hasToolCalls: boolean): string[] {
  if (hasToolCalls || lines.length === 0) return lines;
  const output = [...lines];
  output[0] = OSC133_ZONE_START + output[0];
  output[output.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + output[output.length - 1];
  return output;
}
