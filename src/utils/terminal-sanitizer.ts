/**
 * 终端展示层的文本净化。
 *
 * 目的：用户 prompt、扩展状态、工具输出等外部文本在进入 UI 之前，
 * 剥离可篡改终端状态的控制序列（OSC / DCS / APC / PM 与非 SGR CSI），
 * 只保留可见文本与可选的 SGR 样式。
 *
 * 设计思路参考 alps-pi `src/terminal-sanitizer.ts`（MIT, MrCKR），此处为独立实现。
 */

const ESC = "\x1b";
/** ESC 之后可开启字符串型控制序列的字节：OSC(]) / DCS(P) / APC(_) / PM(^)。 */
const STRING_CONTROL_INTRODUCERS = new Set(["]", "P", "_", "^"]);

const C0_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const C1_CONTROL = /[\x80-\x8f\x91-\x9a\x9c]/g;
const C1_STRING_CONTROL = /[\x90\x9d\x9e\x9f]/g;

export type SanitizeOptions = {
  /** 是否保留换行参与后续布局，默认保留。 */
  allowNewline?: boolean;
  /** 是否保留 tab，默认保留。 */
  allowTab?: boolean;
  /** 是否保留 SGR 颜色/样式序列（主题层已生成的 ANSI 可借此通过），默认保留。 */
  preserveSgr?: boolean;
};

/** 净化进入展示边界的外部文本。 */
export function sanitizeTerminalText(value: unknown, options: SanitizeOptions = {}): string {
  const input = value === undefined || value === null ? "" : String(value);
  if (input.length === 0) return "";

  const preserveSgr = options.preserveSgr !== false;
  let output = "";
  let index = 0;

  while (index < input.length) {
    const sequence = readControlSequence(input, index);
    if (sequence) {
      if (preserveSgr && isSgrSequence(sequence.code)) output += sequence.code;
      index += sequence.length;
      continue;
    }

    const char = input[index] as string;
    if (char === "\n") {
      if (options.allowNewline !== false) output += char;
      index += 1;
      continue;
    }
    if (char === "\t") {
      if (options.allowTab !== false) output += char;
      index += 1;
      continue;
    }
    if (isStrippedControl(char)) {
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

/** 压缩为单行安全文本，适合状态片段。 */
export function sanitizeTerminalSingleLine(value: unknown): string {
  return sanitizeTerminalText(value, { allowNewline: false, allowTab: false })
    .replace(/\s+/g, " ")
    .trim();
}

function isStrippedControl(char: string): boolean {
  const matched =
    C0_CONTROL.test(char) || C1_CONTROL.test(char) || C1_STRING_CONTROL.test(char);
  // 带 /g 的正则有状态，用后必须复位。
  C0_CONTROL.lastIndex = 0;
  C1_CONTROL.lastIndex = 0;
  C1_STRING_CONTROL.lastIndex = 0;
  return matched;
}

function isSgrSequence(code: string): boolean {
  return /^\x1b\[[0-9;:]*m$/.test(code) || /^\x9b[0-9;:]*m$/.test(code);
}

function readControlSequence(input: string, index: number): { code: string; length: number } | null {
  const char = input[index];

  if (char === ESC) {
    const next = input[index + 1];
    if (next === undefined) return { code: char, length: 1 };
    if (next === "[") return readCsiSequence(input, index);
    if (STRING_CONTROL_INTRODUCERS.has(next)) return readStringControlSequence(input, index, 2);
    return { code: input.slice(index, index + 2), length: 2 };
  }

  const code = input.charCodeAt(index);
  if (code === 0x9b) return readCsiSequence(input, index);
  if (code === 0x90 || code === 0x9d || code === 0x9e || code === 0x9f) {
    return readStringControlSequence(input, index, 1);
  }
  return null;
}

/** 读取 CSI 到最终字节，用于区分 SGR 与清屏 / 移动光标等危险控制。 */
function readCsiSequence(input: string, index: number): { code: string; length: number } {
  const bodyStart = input[index] === ESC ? index + 2 : index + 1;
  for (let end = bodyStart; end < input.length; end += 1) {
    const code = input.charCodeAt(end);
    if (code >= 0x40 && code <= 0x7e) {
      return { code: input.slice(index, end + 1), length: end + 1 - index };
    }
  }
  return { code: input.slice(index), length: input.length - index };
}

/** 读取 OSC/DCS/APC/PM 到 BEL 或 ST；未闭合时吞掉剩余文本，避免控制串泄漏。 */
function readStringControlSequence(
  input: string,
  index: number,
  prefixLength: number,
): { code: string; length: number } {
  for (let end = index + prefixLength; end < input.length; end += 1) {
    if (input[end] === "\x07") return { code: input.slice(index, end + 1), length: end + 1 - index };
    if (input[end] === ESC && input[end + 1] === "\\") {
      return { code: input.slice(index, end + 2), length: end + 2 - index };
    }
  }
  return { code: input.slice(index), length: input.length - index };
}
