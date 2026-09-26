/**
 * shell 工具（bash / powershell）的 ZCode 式单行呈现。
 *
 * 设计参考 ZCode 对话流的工具条目：运行中一行折叠 + 左侧加载动画，完成后命令收进
 * 摘要行、输出保持 Pi 原生折叠预览。蓝色整行命令（Pi 原生 toolTitle + bold）被显式
 * 丢弃，命令文本以 text 色并入锚点行。
 *
 * 动画约束：扩展没有主动重绘 API，spinner 借力 Pi bash 渲染器运行中的 1Hz invalidate
 * （刷 Elapsed），按时间片取帧——每秒跳一格。
 *
 * fail-closed：命令拿不到、行结构识别失败、宽度不足时返回 undefined，
 * 调用方回退现有锚点呈现。
 */

import { safeWidth } from "../../utils/width.ts";
import { stripAnsi, isBlankLine } from "../../utils/width.ts";
import { stripBackgroundSgr } from "../../utils/sgr.ts";
import { isImageEscapeLine } from "../../utils/image-escape.ts";
import type { ThemeLike } from "../../core/theme.ts";
import { buildAnchorLine, buildGutterLine, MIN_ANCHOR_WIDTH } from "./chrome.ts";
import { SYMBOLS, type ToolStatus } from "./styles.ts";

/** braille spinner 帧；按时间片轮换，无需组件状态。 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function spinnerFrame(now: number = Date.now()): string {
  return SPINNER_FRAMES[Math.floor(now / 120) % SPINNER_FRAMES.length];
}

/** Pi 原生命令行的提示符：bash 为 `$`，powershell 为 `PS>`。 */
const SHELL_PROMPTS = [/^\$ /, /^PS>\s?/] as const;

/** 时长格式（formatDuration 产物）：`3.2s` / `1m 2s` / `1h 3m`。 */
const DURATION_RE = /^[\dhms. ]+$/;

export type ShellLineClassification = {
  /** 是否识别到原生命令行（首个提示符行；其后内容里再出现的 `$` 视为输出）。 */
  hasCommandLine: boolean;
  /** Elapsed / Tooke 行解析出的时长文本（如 "3.2s"）。 */
  elapsedText: string | undefined;
  /** 保留的行（输出预览 / 折叠提示 / 截断警告），原样带 ANSI。 */
  keepLines: string[];
};

/**
 * 对 Pi 原生 shell 输出行做分类。
 * - 命令行（首个 `$ ` / `PS> ` 前缀行）→ 丢弃（由 args.command 重绘）
 * - 整行匹配 `Elapsed|Took + 纯时长` → 解析为耗时（避免误伤输出里的 "Took 3.2s" 文本，加时长格式约束）
 * - 其余（含空行）→ 保留
 */
export function classifyShellLines(nativeLines: readonly string[]): ShellLineClassification {
  let hasCommandLine = false;
  let elapsedText: string | undefined;
  const keepLines: string[] = [];

  for (const raw of nativeLines) {
    const line = String(raw);
    const plain = stripAnsi(line).trim();

    const elapsed = /^(?:Elapsed|Took) (.+)$/.exec(plain);
    if (elapsed && DURATION_RE.test(elapsed[1] ?? "")) {
      elapsedText = elapsed[1]?.trim();
      continue;
    }
    if (!hasCommandLine && SHELL_PROMPTS.some((re) => re.test(plain))) {
      hasCommandLine = true;
      continue;
    }
    keepLines.push(line);
  }

  return { hasCommandLine, elapsedText, keepLines };
}

/** 命令摘要：args.command 优先（首行），回退从原生命令行剥 ANSI 提取；都拿不到返回 undefined。 */
function summarizeCommand(command: string | undefined, nativeLines: readonly string[]): string | undefined {
  const fromArgs = command?.split(/\r?\n/u, 1)[0]?.trim();
  if (fromArgs) return fromArgs;

  for (const raw of nativeLines) {
    const plain = stripAnsi(String(raw)).trim();
    for (const prompt of SHELL_PROMPTS) {
      const text = new RegExp(prompt.source + "(.+)$").exec(plain)?.[1]?.trim();
      if (text) return text;
    }
  }
  return undefined;
}

/** 裁掉保留行组首尾的空行（原生结构里的分隔空行由本模块统一重排）。 */
function trimBoundaryBlanks(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && isBlankLine(stripAnsi(out[0] ?? ""))) out.shift();
  while (out.length > 0 && isBlankLine(stripAnsi(out[out.length - 1] ?? ""))) out.pop();
  return out;
}

export type BashInlineInput = {
  toolName: string;
  status: ToolStatus;
  /** instance.args.command（bash/powershell 的命令文本）。 */
  command: string | undefined;
  /** Pi 原生 render 输出行（带 ANSI）。 */
  nativeLines: readonly string[];
  theme: ThemeLike;
  width: number;
};

/**
 * shell 工具的单行呈现。
 * 返回 undefined 表示不适用（调用方回退现有锚点呈现）。
 */
export function renderBashInline(input: BashInlineInput): string[] | undefined {
  const { toolName, status, command, nativeLines, theme, width } = input;
  const boxWidth = safeWidth(width);
  if (boxWidth < MIN_ANCHOR_WIDTH) return undefined;

  const { elapsedText, keepLines } = classifyShellLines(nativeLines);
  const commandText = summarizeCommand(command, nativeLines);
  if (!commandText) return undefined;

  if (status === "pending") {
    // 运行中：纯一行（spinner 动态 + 命令 + 耗时），输出预览丢弃。
    return [
      buildAnchorLine(
        spinnerFrame(),
        "accent",
        toolName,
        "toolTitle",
        `running ${commandText}`,
        "text",
        elapsedText,
        boxWidth,
        theme,
      ),
    ];
  }

  const symbol = status === "error" ? SYMBOLS.error : SYMBOLS.success;
  const anchorToken = status === "error" ? "error" : "success";
  const anchor = buildAnchorLine(
    symbol,
    anchorToken,
    toolName,
    "toolTitle",
    commandText,
    "text",
    elapsedText,
    boxWidth,
    theme,
  );

  const keep = trimBoundaryBlanks(keepLines).map((raw) =>
    // Pi 完成的工具输出行带 toolSuccessBg 绿背景——与锚点呈现同一口径：剥背景保前景，
    // 呈现为「深底 + 前景色 + │ 引导」；图片协议行整块透传。
    isImageEscapeLine(raw) ? raw : stripBackgroundSgr(raw),
  );
  if (keep.length === 0) return [anchor];
  // 锚点行 + 空行 + 输出（Pi 原生折叠预览，gutter 对齐）。
  // 竖线随执行结果变色（成功绿 / 失败红），思考等其他呈现的竖线保持灰色。
  const gutterToken = status === "error" ? "error" : "success";
  return [anchor, "", ...keep.map((raw) => buildGutterLine(raw, boxWidth, theme, gutterToken))];
}
