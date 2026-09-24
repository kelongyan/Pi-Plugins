/**
 * 消息外框的纯渲染层。
 *
 * 只负责把「内容行」变成「带边框的行」，不含任何 patch、状态或缓存逻辑。
 * 算法思路参考 alps-pi `src/features/chrome-frame/chrome.ts`（MIT, MrCKR），此处为独立实现。
 *
 * 硬约束（每条都有对应测试）：
 * - 每条输出行的显示宽度必须等于传入宽度
 * - 宽度不足时逐级降级，保证外框永不破
 * - 图片协议行整块透传，不截断、不加框
 * - 空消息不渲染成空白框
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isImageEscapeLine } from "../../utils/image-escape.ts";
import { sanitizeTerminalText } from "../../utils/terminal-sanitizer.ts";
import { isBlankLine, padToWidth, safeWidth } from "../../utils/width.ts";
import { frameLabel, frameStyle, type MessageKind, type ThemeLike, type ToolStatus } from "./styles.ts";

/** 低于该宽度时放弃画框，回退为简单截断。 */
export const MIN_BOX_WIDTH = 8;

const CORNER_TOP_LEFT = "╭";
const CORNER_TOP_RIGHT = "╮";
const CORNER_BOTTOM_LEFT = "╰";
const CORNER_BOTTOM_RIGHT = "╯";
const SIDE = "│";
const TOP_PREFIX = `${CORNER_TOP_LEFT}─ `;
const TOP_SEPARATOR = " ";

/** 思考过程的紧凑框标签。 */
export const THINKING_LABEL = "THINK";

export type RenderBoxOptions = {
  theme: ThemeLike;
  /** 覆盖默认标签。 */
  label?: string;
  /** 工具名（用于拼 TOOL 标签）。 */
  toolName?: string;
  /** 工具执行状态（用于标签符号）。 */
  status?: ToolStatus;
  /** 底边右侧的耗时文本（调用方负责着色）。 */
  elapsedText?: string;
};

function styleText(theme: ThemeLike, token: string, text: string): string {
  return theme.fg(token, text);
}

const SGR_PATTERN = /\x1b\[([0-9;:]*)m/g;

/** 根据一条 SGR 参数串更新「前景色是否处于激活态」。 */
function updateForegroundState(parameters: string, active: boolean): boolean {
  const groups = parameters === "" ? ["0"] : parameters.split(";");
  let next = active;

  for (let index = 0; index < groups.length; index += 1) {
    const fields = (groups[index] ?? "").split(":");
    const value = Number.parseInt(fields[0] ?? "", 10);
    if (Number.isNaN(value)) continue;

    if (value === 38 || value === 48 || value === 58) {
      if (value === 38) next = true;
      if (fields.length > 1) continue;
      const mode = Number.parseInt(groups[index + 1] ?? "", 10);
      if (mode === 5) index += 2;
      else if (mode === 2) index += 4;
      continue;
    }
    if (value === 0 || value === 39) next = false;
    else if ((value >= 30 && value <= 37) || (value >= 90 && value <= 97)) next = true;
  }

  return next;
}

/**
 * 内容里已带前景色时优先保留；其 reset 之后的静态文本重新套用外框 token。
 * 这样「代码高亮 / diff 着色」与「边框配色」不会互相吞掉。
 */
export function styleTextWithEmbeddedForeground(theme: ThemeLike, token: string, text: string): string {
  if (!text.includes("\x1b[")) return styleText(theme, token, text);

  let output = "";
  let cursor = 0;
  let foregroundActive = false;
  SGR_PATTERN.lastIndex = 0;

  for (let match = SGR_PATTERN.exec(text); match; match = SGR_PATTERN.exec(text)) {
    const plain = text.slice(cursor, match.index);
    if (plain) output += foregroundActive ? plain : styleText(theme, token, plain);
    output += match[0];
    foregroundActive = updateForegroundState(match[1] ?? "", foregroundActive);
    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) output += foregroundActive ? tail : styleText(theme, token, tail);
  return output;
}

/** 顶边框：`╭─ LABEL ─────╮` */
function buildTopBorder(
  label: string,
  width: number,
  theme: ThemeLike,
  borderToken: string,
  labelToken: string,
): string {
  const right = CORNER_TOP_RIGHT;
  const budget = Math.max(0, width - visibleWidth(TOP_PREFIX + TOP_SEPARATOR + right));
  const visibleLabel = truncateToWidth(label, budget, "", false);
  const dashCount = Math.max(0, width - visibleWidth(TOP_PREFIX + visibleLabel + TOP_SEPARATOR + right));

  return (
    styleText(theme, borderToken, TOP_PREFIX) +
    styleTextWithEmbeddedForeground(theme, labelToken, visibleLabel) +
    styleText(theme, borderToken, TOP_SEPARATOR + "─".repeat(dashCount) + right)
  );
}

/** 底边框：`╰────────╯`，可带右侧耗时文本。 */
function buildBottomBorder(
  width: number,
  theme: ThemeLike,
  borderToken: string,
  elapsedText?: string,
): string {
  const plainBottom = `${CORNER_BOTTOM_LEFT}${"─".repeat(Math.max(0, width - 2))}${CORNER_BOTTOM_RIGHT}`;
  const text = elapsedText?.trim();
  if (!text) return styleText(theme, borderToken, plainBottom);

  const textBudget = Math.max(0, width - visibleWidth(`${CORNER_BOTTOM_LEFT}  ${CORNER_BOTTOM_RIGHT}`));
  const visibleText = truncateToWidth(text, textBudget, "", false);
  if (!visibleText) return styleText(theme, borderToken, plainBottom);

  const suffixWidth = visibleWidth(` ${visibleText} ${CORNER_BOTTOM_RIGHT}`);
  const dashCount = Math.max(0, width - 1 - suffixWidth);

  return (
    styleText(theme, borderToken, `${CORNER_BOTTOM_LEFT}${"─".repeat(dashCount)} `) +
    styleTextWithEmbeddedForeground(theme, borderToken, visibleText) +
    styleText(theme, borderToken, ` ${CORNER_BOTTOM_RIGHT}`)
  );
}

/** 内容行：`│ 内容 │` */
function buildContentLine(
  line: string,
  width: number,
  theme: ThemeLike,
  borderToken: string,
  textToken: string,
): string {
  const innerWidth = Math.max(0, width - 4);
  const clipped = truncateToWidth(line, innerWidth, "", false);
  const padded = padToWidth(clipped, innerWidth);
  return (
    styleText(theme, borderToken, SIDE) +
    " " +
    styleTextWithEmbeddedForeground(theme, textToken, padded) +
    " " +
    styleText(theme, borderToken, SIDE)
  );
}

/** 窄宽度回退：只净化与截断，不画框。 */
function fallbackLines(lines: readonly string[], width: number): string[] {
  const max = safeWidth(width);
  if (max <= 0) return [];
  const raw = lines.length > 0 ? lines : [""];
  return raw
    .flatMap((line) => sanitizeTerminalText(line, { preserveSgr: true }).split("\n"))
    .map((line) => truncateToWidth(line, max, "", false));
}

/** 净化内容行；图片协议行原样保留。 */
function sanitizeContentLines(lines: readonly string[]): string[] {
  const raw = lines.length > 0 ? lines : [""];
  return raw.map((line) =>
    isImageEscapeLine(line) ? String(line) : sanitizeTerminalText(line, { preserveSgr: true }),
  );
}

/** 只裁掉首尾的空行；正文中间的空行保持原样。用户消息不裁剪（可能是刻意留白）。 */
function trimBoundaryBlankLines(kind: MessageKind, lines: readonly string[]): string[] {
  if (kind === "user") return [...lines];
  const normalized = [...lines];
  while (normalized.length > 0 && !isImageEscapeLine(normalized[0] ?? "") && isBlankLine(normalized[0] ?? "")) {
    normalized.shift();
  }
  while (
    normalized.length > 0 &&
    !isImageEscapeLine(normalized.at(-1) ?? "") &&
    isBlankLine(normalized.at(-1) ?? "")
  ) {
    normalized.pop();
  }
  return normalized;
}

/**
 * 空内容判定。
 * 工具类即使正文为空也要保留外框——外框本身承载了「哪个工具、成功还是失败」的信息。
 */
export function isEmptyMessage(kind: MessageKind, contentLines: readonly string[]): boolean {
  if (kind !== "user" && kind !== "assistant" && kind !== "thinking") return false;
  if (contentLines.length === 0) return true;
  return contentLines.every((line) => isBlankLine(line));
}

/** 渲染一个消息外框。返回空数组表示该消息无可展示内容。 */
export function renderMessageBox(
  kind: MessageKind,
  contentLines: readonly string[],
  width: number,
  options: RenderBoxOptions,
): string[] {
  const { theme } = options;
  const boxWidth = safeWidth(width);

  if (boxWidth < MIN_BOX_WIDTH) return fallbackLines(contentLines, boxWidth);

  const markers = trimBoundaryBlankLines(kind, contentLines);
  const rawLines = sanitizeContentLines(markers);
  if (isEmptyMessage(kind, rawLines)) return [];

  const style = frameStyle(kind);
  const label = options.label ?? frameLabel(kind, options.toolName, options.status);
  const innerWidth = Math.max(1, boxWidth - 4);

  const out: string[] = [buildTopBorder(label, boxWidth, theme, style.border, style.label)];

  for (const raw of rawLines) {
    for (const part of String(raw).split("\n")) {
      if (isImageEscapeLine(part)) {
        // 图片协议行整块透传，不参与包装与着色。
        out.push(part);
        continue;
      }
      const wrapped = wrapTextWithAnsi(part, innerWidth);
      const segments = wrapped.length > 0 ? wrapped : [""];
      for (const segment of segments) {
        out.push(buildContentLine(segment, boxWidth, theme, style.border, style.text));
      }
    }
  }

  // 只有顶框时补一个空内容行，避免出现「顶边紧贴底边」的退化形态。
  if (out.length === 1) {
    out.push(buildContentLine("", boxWidth, theme, style.border, style.text));
  }

  out.push(buildBottomBorder(boxWidth, theme, style.border, options.elapsedText));
  return out;
}

/**
 * 思考过程的紧凑框：固定三行（顶框 + 单行内容 + 底框）。
 *
 * 与完整消息框的区别是只取第一行可见内容并居中成一行，
 * 用于 Pi 折叠状态的 thinking 标签（未展开时内容本就只有一行）。
 */
export function renderThinkingBox(
  contentLines: readonly string[],
  width: number,
  options: RenderBoxOptions,
): string[] {
  const { theme } = options;
  const boxWidth = safeWidth(width);
  if (boxWidth < MIN_BOX_WIDTH) return fallbackLines(contentLines, boxWidth);

  const style = frameStyle("thinking");
  const label = options.label ?? THINKING_LABEL;
  const innerWidth = Math.max(0, boxWidth - 4);
  const content = truncateToWidth(firstVisibleLine(contentLines), innerWidth, "", false);
  const padded = padToWidth(content, innerWidth);

  return [
    buildTopBorder(label, boxWidth, theme, style.border, style.label),
    styleText(theme, style.border, SIDE) +
      " " +
      styleTextWithEmbeddedForeground(theme, style.text, padded) +
      " " +
      styleText(theme, style.border, SIDE),
    buildBottomBorder(boxWidth, theme, style.border, options.elapsedText),
  ];
}

/** 取第一行有可见内容的行；都没有则给一个完成态占位。 */
function firstVisibleLine(lines: readonly string[]): string {
  for (const raw of lines) {
    for (const part of String(raw).split("\n")) {
      const text = sanitizeTerminalText(part, { preserveSgr: true, allowNewline: false, allowTab: false }).trim();
      if (text) return text;
    }
  }
  return "Thinking complete";
}
