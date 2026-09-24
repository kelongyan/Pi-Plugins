/**
 * 终端内联图片协议行的识别。
 *
 * Kitty 与 iTerm 的图片通过转义序列直接输出，这类行不能被文本包装、截断或加框，
 * 否则图片协议会被破坏（alps-pi 的 `image.ts` 与 `image-line.test.ts` 记录了这一点）。
 */

const KITTY_IMAGE_PREFIX = "\x1b_G";
const ITERM_IMAGE_PREFIX = "\x1b]1337;File=";

/** 该行是否承载终端图片协议。 */
export function isImageEscapeLine(line: string): boolean {
  return line.includes(KITTY_IMAGE_PREFIX) || line.includes(ITERM_IMAGE_PREFIX);
}

/** 行集合中是否含图片协议行。 */
export function containsImageEscape(lines: readonly string[]): boolean {
  return lines.some(isImageEscapeLine);
}
