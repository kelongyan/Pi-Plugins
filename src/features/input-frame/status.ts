/**
 * 输入框线框的状态数据源。
 *
 * 读取的 ctx 方法（getThinkingLevel / getContextUsage / model）属于官方扩展上下文，
 * 但返回结构未在类型层面完全固定，因此一律做防御性读取，失败即隐藏该段。
 *
 * 说明：这里只做静态文本，不做任何动画或彩虹效果。
 */

import { homedir } from "node:os";
import type { ThemeLike } from "../../core/theme.ts";
import { safeFg } from "../../core/theme.ts";
import type { EditorFrameStatus } from "./frame.ts";

/** 上下文进度条的总宽（列）。 */
export const CONTEXT_BAR_WIDTH = 10;
const CONTEXT_WARN_PERCENT = 70;
const CONTEXT_ERROR_PERCENT = 90;

export type InputFrameSettingsLike = {
  showModel: boolean;
  showThinking: boolean;
  showContext: boolean;
};

export type FrameStatusInput = {
  ctx: unknown;
  theme: ThemeLike;
  settings: InputFrameSettingsLike;
};

/** 组装线框顶部要展示的状态段。取不到的段直接隐藏，不留空占位。 */
export function buildFrameStatus(input: FrameStatusInput): EditorFrameStatus {
  const { ctx, theme, settings } = input;
  const status: EditorFrameStatus = {};

  if (settings.showModel) {
    const name = readModelName(ctx);
    if (name) status.model = safeFg(theme, "accent", name);
  }

  if (settings.showThinking) {
    const level = readThinkingLevel(ctx);
    if (level) status.thinking = styleThinkingLevel(theme, level);
  }

  if (settings.showContext) {
    const context = renderContextSegment(ctx, theme);
    if (context) status.context = context;
  }

  return status;
}

/** 读取模型名，并压缩成短名（去掉 provider 前缀）。 */
export function readModelName(ctx: unknown): string | undefined {
  try {
    const model = (ctx as { model?: { name?: unknown; id?: unknown } } | undefined)?.model;
    const raw = typeof model?.name === "string" ? model.name : typeof model?.id === "string" ? model.id : undefined;
    if (!raw || raw.trim().length === 0) return undefined;
    return shortenModelName(raw.trim());
  } catch {
    return undefined;
  }
}

/**
 * 压缩模型名为短名：`anthropic/claude-x` → `claude-x`，`openai:gpt-5` → `gpt-5`。
 * 先剥 host/ 前缀，再剥 provider: 前缀。
 */
export function shortenModelName(name: string): string {
  let text = name;
  const slash = text.lastIndexOf("/");
  if (slash >= 0) text = text.slice(slash + 1);
  const colon = text.indexOf(":");
  if (colon >= 0) text = text.slice(colon + 1);
  return text.trim() || name;
}

/** 读取 thinking 级别；off / 缺失都视为不展示。 */
export function readThinkingLevel(ctx: unknown): string | undefined {
  try {
    const reader = (ctx as { getThinkingLevel?: () => unknown } | undefined)?.getThinkingLevel;
    if (typeof reader !== "function") return undefined;
    const level = reader.call(ctx);
    if (typeof level !== "string" || level.length === 0) return undefined;
    return level === "off" ? undefined : level;
  } catch {
    return undefined;
  }
}

/** thinking 级别只按语义 token 上色，不做彩虹等装饰。 */
function styleThinkingLevel(theme: ThemeLike, level: string): string {
  const token =
    level === "max" || level === "xhigh"
      ? "error"
      : level === "high"
        ? "warning"
        : level === "medium"
          ? "accent"
          : "muted";
  return safeFg(theme, token, shortenLevel(level), "muted");
}

function shortenLevel(level: string): string {
  if (level === "minimal") return "min";
  if (level === "medium") return "med";
  return level;
}

/** 右上角上下文进度：`━━━━────── 42% 200.0k`。无窗口信息时退化为 token 数。 */
export function renderContextSegment(ctx: unknown, theme: ThemeLike): string | undefined {
  const usage = readContextUsage(ctx);
  if (!usage) return undefined;

  if (!usage.contextWindow) {
    return usage.tokens > 0 ? safeFg(theme, "muted", formatTokens(usage.tokens)) : undefined;
  }

  const percent = clampPercent((usage.tokens / usage.contextWindow) * 100);
  const token =
    percent >= CONTEXT_ERROR_PERCENT ? "error" : percent >= CONTEXT_WARN_PERCENT ? "warning" : "success";

  return [
    renderBar(percent, theme, token),
    safeFg(theme, token, `${percent.toFixed(0)}%`),
    safeFg(theme, "muted", formatTokens(usage.contextWindow)),
  ].join(" ");
}

export type ContextUsage = {
  tokens: number;
  contextWindow?: number;
};

/** 读取上下文用量；结构不符时返回 undefined。 */
export function readContextUsage(ctx: unknown): ContextUsage | undefined {
  try {
    const reader = (ctx as { getContextUsage?: () => unknown } | undefined)?.getContextUsage;
    if (typeof reader !== "function") return undefined;
    const usage = reader.call(ctx) as { tokens?: unknown; contextWindow?: unknown } | undefined;
    if (!usage || typeof usage !== "object") return undefined;

    const tokens =
      typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? usage.tokens : undefined;
    if (tokens === undefined) return undefined;

    const window =
      typeof usage.contextWindow === "number" && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
        ? usage.contextWindow
        : undefined;

    return { tokens, contextWindow: window };
  } catch {
    return undefined;
  }
}

function renderBar(percent: number, theme: ThemeLike, token: string): string {
  const filled = Math.round((percent / 100) * CONTEXT_BAR_WIDTH);
  return (
    safeFg(theme, token, "━".repeat(filled)) +
    safeFg(theme, "borderMuted", "─".repeat(Math.max(0, CONTEXT_BAR_WIDTH - filled)), "muted")
  );
}

/** 1234 → 1.2k；1234567 → 1.2M。 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** 读取当前工作目录（官方 ExtensionContext 提供 cwd）。 */
export function readCwd(ctx: unknown): string | undefined {
  try {
    const cwd = (ctx as { cwd?: unknown } | undefined)?.cwd;
    return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把路径压缩成适合窄空间的短形式：家目录缩写为 `~`，过长时只保留尾部两级。
 */
export function shortenPath(cwd: string, maxLength = 24): string {
  let text = cwd.replace(/\\/g, "/");
  const home = (process.env.HOME || process.env.USERPROFILE || homedir() || "").replace(/\\/g, "/");

  if (home && text.startsWith(home)) {
    text = `~${text.slice(home.length)}`;
  }
  if (text.length <= maxLength) return text;

  const parts = text.split("/").filter((part) => part.length > 0);
  if (parts.length <= 2) return text;
  return `…/${parts.slice(-2).join("/")}`;
}
