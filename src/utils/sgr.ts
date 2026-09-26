/**
 * SGR 序列与原生 UI 提示的精细化清理。
 *
 * 背景：Pi 原生给工具组件的内容行铺背景色（toolPendingBg / toolSuccessBg / toolErrorBg），
 * minimal 锚点风格需要「深底 + 前景色 + │ 引导」，因此剥离背景参数、保留前景与字重。
 * 同时清理 Pi 原生渲染混进摘要的括号 UI 提示（如 "(ctrl+o to expand)"）。
 */

const SGR_FINAL_MIN = 0x40;
const SGR_FINAL_MAX = 0x7e;

/** 判断某位置是否 CSI 序列起点（\x1b[ 或单字节 \x9b）。返回序列 introducer 的长度。 */
function csiStartLength(text: string, index: number): number {
  if (text[index] === "\x1b" && text[index + 1] === "[") return 2;
  if (text.charCodeAt(index) === 0x9b) return 1;
  return 0;
}

/** 从 SGR 参数串中移除背景参数后重新拼装；全部为背景时返回空串。 */
function stripBackgroundFromParameters(parameters: string): string {
  const parts = parameters.split(";");
  const kept: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const value = Number.parseInt(parts[index] ?? "", 10);
    if (Number.isNaN(value)) {
      kept.push(parts[index] ?? "");
      continue;
    }

    // 标准背景 / 亮背景 / 默认背景：整段丢弃。
    if (value === 49 || (value >= 40 && value <= 47) || (value >= 100 && value <= 107)) continue;

    // 扩展背景 48;5;n / 48;2;r;g;b：连同子参数一起丢弃。
    if (value === 48) {
      const mode = Number.parseInt(parts[index + 1] ?? "", 10);
      index += mode === 5 ? 2 : mode === 2 ? 4 : 0;
      continue;
    }

    // 扩展前景 38;5;n / 38;2;r;g;b：连同子参数一起保留。
    if (value === 38) {
      const mode = Number.parseInt(parts[index + 1] ?? "", 10);
      const extra = mode === 5 ? 2 : mode === 2 ? 4 : 0;
      kept.push(parts[index] ?? "");
      for (let k = 0; k < extra; k += 1) {
        index += 1;
        kept.push(parts[index] ?? "");
      }
      continue;
    }

    kept.push(parts[index] ?? "");
  }

  if (kept.length === 0) return "";
  return `\x1b[${kept.join(";")}m`;
}

/**
 * 剥离文本中所有 SGR 序列的背景参数，保留前景与其他属性。
 * 非 SGR 的控制序列原样保留（本模块不做安全净化，净化由 terminal-sanitizer 负责）。
 */
export function stripBackgroundSgr(text: string): string {
  const input = String(text);
  let output = "";
  let index = 0;

  while (index < input.length) {
    const startLength = csiStartLength(input, index);
    if (startLength > 0) {
      let end = index + startLength;
      while (end < input.length && !(input.charCodeAt(end) >= SGR_FINAL_MIN && input.charCodeAt(end) <= SGR_FINAL_MAX)) {
        end += 1;
      }
      const sequence = input.slice(index, end + 1);
      const final = input[end];
      if (final === "m") {
        const body = sequence.slice(startLength, -1);
        output += body === "" ? sequence : stripBackgroundFromParameters(body);
      } else {
        output += sequence;
      }
      index = end + 1;
      continue;
    }

    output += input[index];
    index += 1;
  }

  return output;
}

/** 剥掉 Pi 原生折叠提示等括号 UI 文案（展开提示 / 行数提示）。 */
export function stripUiHints(text: string): string {
  return String(text)
    .replace(/\s*\([^()]*\bto expand\)\s*/gu, " ")
    .replace(/\s*\([^()]*\d+ (?:more|earlier) lines[^()]*\)\s*/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}
