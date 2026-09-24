/**
 * 终端宽度安全工具。
 *
 * 所有自绘内容都必须经过这里，因为 ANSI 转义、宽字符、emoji、组合字符
 * 都会让「字符串长度」不等于「显示列数」（官方 docs/tui.md 明确要求）。
 */

import { visibleWidth } from "@earendil-works/pi-tui";

/** 把任意输入收敛为可用的列数。 */
export function safeWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

/** 用空格补齐到指定显示宽度；已超宽则原样返回。 */
export function padToWidth(line: string, width: number): string {
  const current = visibleWidth(line);
  if (current >= width) return line;
  return line + " ".repeat(width - current);
}

/** 该行是否为空行（忽略 ANSI 控制序列）。 */
export function isBlankLine(line: string): boolean {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;:]*m/g, "").trim().length === 0;
}

/** 去掉 ANSI 控制序列，保留可见文本。 */
export function stripAnsi(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;:]*m/g, "");
}
