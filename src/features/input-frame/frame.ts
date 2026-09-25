/**
 * 输入框线框的纯渲染层。
 *
 * 与消息外框的关键差异：
 * - 内容来自 Pi 的 editor 渲染输出，其中可能含 CURSOR_MARKER，
 *   必须原样保留其位置，否则 IME 候选窗与光标会错位
 * - 左右两侧都可以挂状态标签
 *
 * 算法思路参考 alps-pi `src/features/bottom-input/frame.ts`（MIT, MrCKR），此处为独立实现。
 */

import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../../core/theme.ts";
import { sanitizeTerminalText } from "../../utils/terminal-sanitizer.ts";
import { padToWidth, safeWidth } from "../../utils/width.ts";

/** 低于该宽度时不画框，回退原始 editor 输出。 */
export const MIN_FRAME_WIDTH = 8;

/** 左侧标签最多占内宽的比例。 */
const LEFT_LABEL_BUDGET_RATIO = 0.45;
/** 降级循环上限，防止极端输入下打转。 */
const DEGRADE_GUARD = 6;
/** 净化时用于临时占位，保证 CURSOR_MARKER 不被当作控制字符剥掉。 */
const CURSOR_PLACEHOLDER = "\uE000ZXDL_CURSOR\uE000";

/**
 * 边框字符集：轻线（light）+ 圆角。
 *
 * 曾经试过重线（┏━┓ ┃ ┗━┛），视觉太重；且 Unicode 的 Box Drawing
 * 里**没有重线圆角**字形，加粗必然变成直角 —— 所以回到轻线圆角。
 * 字符都集中在这一处，以后想换风格改这里即可。
 */
const BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

const SIDE = BORDER.vertical;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type EditorFrameStatus = {
  /** 左上：模型名。 */
  model?: string;
  /** 左上：thinking 级别（已着色）。 */
  thinking?: string;
  /** 右上：上下文进度（已着色）。 */
  context?: string;
};

export type RenderEditorFrameInput = {
  /** Pi 原生 editor 的输出行（已剥离原生上下线）。 */
  editorLines: readonly string[];
  width: number;
  theme: ThemeLike;
  status: EditorFrameStatus;
};

/** 把 editor 输出包进线框：顶边 + 内容 + 底边。 */
export function renderEditorFrame(input: RenderEditorFrameInput): string[] {
  const width = safeWidth(input.width);
  if (width < MIN_FRAME_WIDTH) return [...input.editorLines];

  const lines = input.editorLines.length > 0 ? input.editorLines : [""];
  return [
    buildTopBorder(width, input.theme, input.status),
    ...lines.map((line) => renderContentLine(line, width, input.theme)),
    buildBottomBorder(width, input.theme),
  ];
}

function buildTopBorder(width: number, theme: ThemeLike, status: EditorFrameStatus): string {
  const left = joinSegments([status.model, status.thinking], theme.fg("borderMuted", " · "));
  return buildBorderLine({
    width,
    theme,
    leftCorner: BORDER.topLeft,
    rightCorner: BORDER.topRight,
    leftLabel: left,
    rightLabel: status.context ?? "",
  });
}

function buildBottomBorder(width: number, theme: ThemeLike): string {
  return buildBorderLine({ width, theme, leftCorner: BORDER.bottomLeft, rightCorner: BORDER.bottomRight });
}

type BorderLineInput = {
  width: number;
  theme: ThemeLike;
  leftCorner: string;
  rightCorner: string;
  leftLabel?: string;
  rightLabel?: string;
};

/**
 * 拼装一条边框线，并保证宽度永远闭合。
 *
 * 降级顺序：裁右标签 → 裁左标签 → 整体省略标签。
 */
function buildBorderLine(input: BorderLineInput): string {
  const { width, theme, leftCorner, rightCorner } = input;
  const total = Math.max(2, width);
  const innerBudget = Math.max(0, total - 2);

  let leftLabel = fitLabel(
    input.leftLabel ?? "",
    Math.max(0, Math.floor(innerBudget * LEFT_LABEL_BUDGET_RATIO) - 2),
  );
  let rightLabel = fitLabel(
    input.rightLabel ?? "",
    Math.max(0, innerBudget - visibleWidth(padded(leftLabel)) - 2),
  );

  for (
    let guard = 0;
    guard < DEGRADE_GUARD &&
    visibleWidth(padded(leftLabel)) + visibleWidth(padded(rightLabel)) > innerBudget;
    guard += 1
  ) {
    const overflow = visibleWidth(padded(leftLabel)) + visibleWidth(padded(rightLabel)) - innerBudget;
    if (rightLabel) {
      rightLabel = fitLabel(rightLabel, Math.max(0, visibleWidth(rightLabel) - overflow));
    } else if (leftLabel) {
      leftLabel = fitLabel(leftLabel, Math.max(0, visibleWidth(leftLabel) - overflow));
    }
  }

  if (visibleWidth(padded(leftLabel)) + visibleWidth(padded(rightLabel)) > innerBudget) rightLabel = "";
  if (visibleWidth(padded(leftLabel)) + visibleWidth(padded(rightLabel)) > innerBudget) leftLabel = "";

  const dashCount = Math.max(
    0,
    innerBudget - visibleWidth(padded(leftLabel)) - visibleWidth(padded(rightLabel)),
  );

  return (
    theme.fg("borderMuted", leftCorner) +
    padded(leftLabel) +
    theme.fg("borderMuted", BORDER.horizontal.repeat(dashCount)) +
    padded(rightLabel) +
    theme.fg("borderMuted", rightCorner)
  );
}

/** 标签两侧各留一个空格。 */
function padded(label: string): string {
  return label ? ` ${label} ` : "";
}

/** 内容行：`│ 编辑器内容 │`，光标标记必须原样保留。 */
function renderContentLine(line: string, width: number, theme: ThemeLike): string {
  const innerWidth = Math.max(0, width - 4);
  const safe = sanitizeEditorLine(line);
  const clipped = closeOpenAnsi(truncateKeepingCursor(safe, innerWidth));
  const filled = padToWidth(clipped, innerWidth);
  return theme.fg("borderMuted", SIDE) + " " + filled + " " + theme.fg("borderMuted", SIDE);
}

/** 按标签可用宽度截断；截断前先去掉 ANSI 以免破坏着色状态。 */
function fitLabel(label: string, maxWidth: number): string {
  if (!label || maxWidth <= 0) return "";
  if (visibleWidth(label) <= maxWidth) return label;
  return truncateToWidth(stripAnsi(label), maxWidth, "…", false);
}

function joinSegments(segments: Array<string | undefined>, separator: string): string {
  return segments.filter((segment): segment is string => Boolean(segment)).join(separator);
}

/** 净化 editor 行，但把光标标记保护起来（它本身是控制序列，会被净化掉）。 */
function sanitizeEditorLine(line: string): string {
  const guarded = String(line).split(CURSOR_MARKER).join(CURSOR_PLACEHOLDER);
  const cleaned = sanitizeTerminalText(guarded, {
    allowNewline: false,
    allowTab: true,
    preserveSgr: true,
  });
  return cleaned.split(CURSOR_PLACEHOLDER).join(CURSOR_MARKER);
}

/** 截断内容但保留光标标记的位置。 */
function truncateKeepingCursor(line: string, width: number): string {
  if (width <= 0) return line.includes(CURSOR_MARKER) ? CURSOR_MARKER : "";
  if (!line.includes(CURSOR_MARKER)) return truncateToWidth(line, width, "", false);

  const markerIndex = line.indexOf(CURSOR_MARKER);
  const before = line.slice(0, markerIndex);
  const after = line.slice(markerIndex + CURSOR_MARKER.length);
  const beforeWidth = visibleWidth(before);

  if (beforeWidth + visibleWidth(after) <= width) return line;

  // 光标标记零宽，不占内容预算；按可见列切片以保留 grapheme 与 SGR 的完整性。
  const startCol = Math.max(0, beforeWidth - Math.max(0, width - 1));
  const head = sliceVisibleColumns(before, startCol, beforeWidth - startCol);
  const remaining = Math.max(0, width - visibleWidth(head));
  const tail = sliceVisibleColumns(after, 0, remaining);
  return `${head}${CURSOR_MARKER}${tail}`;
}

/** 按终端可见列截取，保留 SGR 序列与 grapheme 完整性。 */
function sliceVisibleColumns(line: string, startCol: number, length: number): string {
  if (length <= 0) return "";
  const endCol = startCol + length;
  let result = "";
  let column = 0;
  let pendingAnsi = "";

  for (let index = 0; index < line.length; ) {
    const ansi = readAnsiAt(line, index);
    if (ansi) {
      if (column >= startCol && column < endCol) result += ansi.code;
      else if (column < startCol) pendingAnsi += ansi.code;
      index += ansi.length;
      continue;
    }

    let textEnd = index;
    while (textEnd < line.length && !readAnsiAt(line, textEnd)) textEnd += 1;

    for (const { segment } of segmenter.segment(line.slice(index, textEnd))) {
      const segmentWidth = visibleWidth(segment);
      const inRange = column >= startCol && column < endCol;
      const fits = column + segmentWidth <= endCol;
      if (inRange && fits) {
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += segment;
      }
      column += segmentWidth;
      if (column >= endCol) break;
    }

    index = textEnd;
    if (column >= endCol) break;
  }

  return result;
}

/** 裁剪后补一个 reset，避免输入内容的前景色泄漏到 padding 与右边框。 */
function closeOpenAnsi(line: string): string {
  return hasSgr(line) ? `${line}\x1b[0m` : line;
}

function hasSgr(line: string): boolean {
  return /\x1b\[[0-9;:]*m/.test(line) || /\x9b[0-9;:]*m/.test(line);
}

function stripAnsi(line: string): string {
  return sanitizeTerminalText(line, { allowNewline: false, allowTab: false, preserveSgr: false });
}

/** 解析一行中某个位置的 ANSI 序列（CSI / OSC / DCS / APC / PM）。 */
function readAnsiAt(line: string, index: number): { code: string; length: number } | null {
  if (line[index] !== "\x1b") return null;
  const next = line[index + 1];

  if (next === "[") {
    for (let end = index + 2; end < line.length; end += 1) {
      const code = line.charCodeAt(end);
      if (code >= 0x40 && code <= 0x7e) {
        return { code: line.slice(index, end + 1), length: end + 1 - index };
      }
    }
    return null;
  }

  if (next === "]" || next === "_" || next === "P" || next === "^") {
    for (let end = index + 2; end < line.length; end += 1) {
      if (line[end] === "\x07") return { code: line.slice(index, end + 1), length: end + 1 - index };
      if (line[end] === "\x1b" && line[end + 1] === "\\") {
        return { code: line.slice(index, end + 2), length: end + 2 - index };
      }
    }
  }

  return null;
}
