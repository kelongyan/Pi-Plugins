/**
 * 输入框下方的状态栏。
 *
 * 设计参考 pi-cc-ui 的底部状态栏：多个信息段用 `│` 分隔、每段带图标。
 * 宽度不足时**从右往左整段丢弃**（数组顺序即优先级），永不截断段内文字。
 *
 * 渲染是纯函数：所有数据在渲染前读好（git 走缓存、速度由 runtime 注入），
 * 因此这里没有任何异步或计时逻辑。
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { safeFg, type ThemeLike } from "../../core/theme.ts";
import { readGitBranch } from "./git-status.ts";
import { formatSpeed, readSessionTokens } from "./session-stats.ts";
import {
  formatTokens,
  readContextUsage,
  readCwd,
  readModelName,
  readThinkingLevel,
  shortenPath,
} from "./status.ts";

export type StatusBarSegmentId = "model" | "path" | "git" | "context" | "tokens" | "speed";

export type StatusBarIconStyle = "emoji" | "plain";

/** 每段的开关。 */
export type StatusBarSegmentSettings = Record<StatusBarSegmentId, boolean>;

export type StatusBarSegment = {
  id: StatusBarSegmentId;
  /** 已着色的文本（含图标）。 */
  text: string;
};

/** 段之间的分隔符。 */
export const STATUS_SEPARATOR = " │ ";

const ICON_SETS: Record<StatusBarIconStyle, Record<StatusBarSegmentId, string>> = {
  emoji: { model: "🎨", path: "📘", git: "ᛘ", context: "💾", tokens: "🔢", speed: "⚡" },
  plain: { model: "model", path: "dir", git: "git", context: "ctx", tokens: "tok", speed: "tps" },
};

/** 各段默认使用的主题 token。 */
const SEGMENT_TOKENS: Record<StatusBarSegmentId, string> = {
  model: "accent",
  path: "customMessageLabel",
  git: "success",
  context: "success",
  tokens: "muted",
  speed: "success",
};

export function segmentIcon(id: StatusBarSegmentId, style: StatusBarIconStyle): string {
  const set = ICON_SETS[style] ?? ICON_SETS.emoji;
  return set[id] ?? ICON_SETS.emoji[id];
}

/**
 * 把段装进一行。
 *
 * 宽度不足时从**尾部**整段丢弃（数组顺序即优先级，靠前优先保留）；
 * 全部装不下则返回空串（调用方据此不输出该行）。
 */
export function composeStatusBar(segments: readonly StatusBarSegment[], width: number): string {
  const limit = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const active = segments.filter((segment) => segment.text.length > 0);

  while (active.length > 0) {
    const text = ` ${active.map((segment) => segment.text).join(STATUS_SEPARATOR)}`;
    if (visibleWidth(text) <= limit) return text;
    active.pop();
  }

  return "";
}

export type StatusBarInput = {
  ctx: unknown;
  theme: ThemeLike;
  icons: StatusBarIconStyle;
  settings: StatusBarSegmentSettings;
  /** 流式速度（由 runtime 注入，拿不到就不显示该段）。 */
  tokensPerSecond?: number;
};

/**
 * 组装状态栏的段。
 * 返回顺序即显示顺序，也是宽度不足时的丢弃顺序（越靠后越先被丢）。
 */
export function buildStatusBarSegments(input: StatusBarInput): StatusBarSegment[] {
  const { ctx, theme, icons, settings, tokensPerSecond } = input;
  const out: StatusBarSegment[] = [];

  const add = (id: StatusBarSegmentId, content: string | undefined, token?: string): void => {
    if (!content) return;
    out.push({ id, text: safeFg(theme, token ?? SEGMENT_TOKENS[id], `${segmentIcon(id, icons)} ${content}`) });
  };

  if (settings.model) {
    const name = readModelName(ctx);
    if (name) {
      const level = readThinkingLevel(ctx);
      add("model", level ? `${name}(${level})` : name);
    }
  }

  if (settings.path) {
    const cwd = readCwd(ctx);
    add("path", cwd ? shortenPath(cwd, 20) : undefined);
  }

  if (settings.git) {
    add("git", readGitBranch(readCwd(ctx)) ?? undefined);
  }

  if (settings.context) {
    const usage = readContextUsage(ctx);
    if (usage) {
      const percent = usage.contextWindow
        ? Math.max(0, Math.min(100, (usage.tokens / usage.contextWindow) * 100))
        : undefined;
      const token =
        percent !== undefined && percent >= 90 ? "error" : percent !== undefined && percent >= 70 ? "warning" : "success";
      const tokens = formatTokens(usage.tokens);
      const window = usage.contextWindow ? formatTokens(usage.contextWindow) : "?";
      add("context", `${percent !== undefined ? `${percent.toFixed(1)}%` : "?"} (${tokens}/${window})`, token);
    }
  }

  // 本会话累计 token（输入 + 输出）；为 0 时不显示，避免刚开新会话就占位。
  if (settings.tokens) {
    const usage = readSessionTokens(ctx);
    if (usage) {
      const total = usage.input + usage.output;
      if (total > 0) add("tokens", formatTokens(total));
    }
  }

  if (settings.speed) {
    add("speed", formatSpeed(tokensPerSecond));
  }

  return out;
}
