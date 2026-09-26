/**
 * edit 工具 diff 视图的语法高亮。
 *
 * Pi 的 read/write 渲染器和 assistant markdown 代码块都带语法高亮（highlightCode），
 * 唯独 edit 的 diff 输出（components/diff.js 的 renderDiff）只有整行红/绿/灰三色。
 * 本模块在插件的 render 包装层对 edit 工具输出行做后处理：解析 diff 行格式，
 * 对代码内容重新跑 Pi 官方导出的 highlightCode，语义色保留在 +/- 符号与行号上。
 *
 * 仅在插件 render 包装内做行变换，不触碰 Pi 源码；API 缺失时整体静默降级。
 */

import { piHighlightCode, piHighlightSupported, piLanguageFromPath } from "../core/pi-compat.ts";
import type { ThemeLike } from "../core/theme.ts";
import { stripAnsi } from "../utils/width.ts";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 临时诊断日志（定位实机高亮失效用）：写 ~/.pi/agent/pi-zxdl-diff.log。
 * 定位完成后整体移除。
 */
export function debugDiffLog(...args: unknown[]): void {
  try {
    appendFileSync(
      join(homedir(), ".pi", "agent", "pi-zxdl-diff.log"),
      `${new Date().toISOString()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`,
    );
  } catch {
    // 日志失败不影响渲染。
  }
}

/**
 * diff 行格式（core/tools/edit-diff.js 生成）：`+12 内容` / `-12 内容`，
 * 行号按宽度 padStart 对齐（可含前导空格），行号后一个空格是分隔符，
 * 因此代码内容保留自身缩进。
 */
const ADDED_LINE_RE = /^\+(\s*\d+)\s(.*)$/;
const REMOVED_LINE_RE = /^-(\s*\d+)\s(.*)$/;

/** 高亮结果缓存：流式渲染期间同一 diff 每帧都会重出，按行缓存可零成本复用。 */
const CACHE_LIMIT = 500;
const highlightCache = new Map<string, string>();

function cachedHighlight(code: string, lang: string, highlight: HighlightFn): string | undefined {
  const key = `${lang}\u0000${code}`;
  const hit = highlightCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const value = highlight(code, lang).join("\n");
    debugDiffLog("[cachedHighlight] ok", `ansi=${/\x1b\[/.test(value)}`, `code=${JSON.stringify(code.slice(0, 40))}`);
    if (highlightCache.size >= CACHE_LIMIT) highlightCache.clear();
    highlightCache.set(key, value);
    return value;
  } catch (error) {
    debugDiffLog("[cachedHighlight] threw:", error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/** 从工具 args 提取 diff 的目标文件路径 → 高亮语言（edit 的 args 用 path / file_path）。 */
export function diffLanguageFromArgs(instance: unknown): string | undefined {
  try {
    const args = (instance as { args?: unknown } | undefined)?.args;
    if (typeof args !== "object" || args === null) return undefined;
    const record = args as Record<string, unknown>;
    const path = record.path ?? record.file_path ?? record.filePath;
    if (typeof path !== "string" || !path) return undefined;
    return piLanguageFromPath(path);
  } catch {
    return undefined;
  }
}

export type HighlightFn = (code: string, lang: string) => string[];

/** 语义色 token：增/删行的符号与行号用它，保证 +/- 语义在语法高亮下仍可辨认。 */
const SEMANTIC_TOKEN = { added: "toolDiffAdded", removed: "toolDiffRemoved" } as const;

function defaultHighlight(code: string, lang: string): string[] {
  return piHighlightCode(code, lang);
}

/**
 * 重绘单条 diff 行。
 * - 增/删行：剥掉 Pi 的整行单色，代码内容换成语法高亮，符号与行号保留语义色
 * - 上下文行 / 标题行 / 省略行 / 无语言：原样透传（上下文行保持 Pi 的弱化灰）
 * - 高亮失败：整行回落语义色（与 Pi 原生观感一致）
 */
export function renderEditDiffLine(
  line: string,
  lang: string,
  theme: ThemeLike,
  highlight: HighlightFn = defaultHighlight,
): string {
  const plain = stripAnsi(line);
  const added = ADDED_LINE_RE.exec(plain);
  const match = added ?? REMOVED_LINE_RE.exec(plain);
  if (!match) return line;

  const [, lineNum, code] = match;
  const token = added ? SEMANTIC_TOKEN.added : SEMANTIC_TOKEN.removed;
  const head = theme.fg(token, `${added ? "+" : "-"}${lineNum} `);
  const body = cachedHighlight(code, lang, highlight) ?? theme.fg(token, code);
  return head + body;
}

/**
 * 对工具输出行做 edit diff 高亮变换；不适用时原样返回（引用相等，零开销）。
 * 由 message-frame 的 render 包装在拿到 Pi 原始输出后调用。
 */
export function transformEditDiffLines(
  toolName: string | undefined,
  instance: unknown,
  lines: string[],
  theme: ThemeLike,
  highlight: HighlightFn = defaultHighlight,
): string[] {
  if (toolName !== "edit" || lines.length === 0) {
    debugDiffLog("[transform] skip", `toolName=${toolName}`, `lines=${lines.length}`);
    return lines;
  }
  if (!piHighlightSupported()) {
    debugDiffLog("[transform] skip: highlight API unsupported");
    return lines;
  }
  const lang = diffLanguageFromArgs(instance);
  if (!lang) {
    const args = (instance as { args?: { path?: unknown } } | undefined)?.args;
    debugDiffLog("[transform] skip: no lang", `path=${JSON.stringify(args?.path)}`);
    return lines;
  }
  const matched = lines.filter((line) => {
    const plain = stripAnsi(line);
    return ADDED_LINE_RE.test(plain) || REMOVED_LINE_RE.test(plain);
  }).length;
  debugDiffLog("[transform] run", `lang=${lang}`, `lines=${lines.length}`, `matched=${matched}`, `sample=${JSON.stringify(stripAnsi(lines[0] ?? "").slice(0, 40))}`);
  const out = lines.map((line) => renderEditDiffLine(line, lang, theme, highlight));
  // 没有任何一行被改写时零拷贝返回原数组（透传语义，避免每帧无谓分配）。
  return out.every((value, index) => value === lines[index]) ? lines : out;
}
