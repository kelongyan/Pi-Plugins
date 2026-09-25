/**
 * 会话级统计：累计费用与流式输出速度。
 *
 * 数据来自 Pi 的 session entries 与流式事件，**不在官方扩展契约内** ——
 * 因此全部防御式读取：拿不到就返回 undefined，由调用方隐藏对应段。
 */

/** 读取本会话累计花费（通常是 USD）。取不到返回 undefined。 */
export function readSessionCost(ctx: unknown): number | undefined {
  try {
    const sessionManager = (
      ctx as { sessionManager?: { getBranch?: () => unknown } } | undefined
    )?.sessionManager;
    if (typeof sessionManager?.getBranch !== "function") return undefined;

    const entries = sessionManager.getBranch();
    if (!Array.isArray(entries)) return undefined;

    let total = 0;
    let found = false;

    for (const entry of entries as Array<Record<string, unknown>>) {
      const message = entry?.message as { usage?: { cost?: { total?: unknown } } } | undefined;
      const cost = message?.usage?.cost?.total;
      if (typeof cost === "number" && Number.isFinite(cost)) {
        total += cost;
        found = true;
      }
    }

    return found ? total : undefined;
  } catch {
    return undefined;
  }
}

/** 费用格式化：极小额用 4 位小数，避免一直显示 $0.00。 */
export function formatCost(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/**
 * 流式输出速度跟踪。
 *
 * 语义：一轮生成期间累计 output token 并计时；一轮结束时冻结最后速度，
 * 空闲时显示上一次的速度（而不是瞬间归零，避免闪烁）。
 */
export class StreamSpeedTracker {
  private startedAt = 0;
  private tokens = 0;
  private frozen: number | undefined;

  /** 流式更新时调用（来自 message_update 事件）。 */
  onStream(usage: { output?: unknown } | undefined): void {
    if (this.startedAt === 0) this.startedAt = Date.now();
    const output = usage?.output;
    if (typeof output === "number" && Number.isFinite(output) && output > 0) {
      this.tokens = output;
    }
  }

  /** 一轮结束时调用：冻结当前速度并复位计时。 */
  onIdle(): void {
    const current = this.compute();
    if (current !== undefined) this.frozen = current;
    this.startedAt = 0;
    this.tokens = 0;
  }

  /** 当前速度（tokens/s）：生成中取实时值，空闲取上次冻结值。 */
  get tokensPerSecond(): number | undefined {
    return this.compute() ?? this.frozen;
  }

  /** 清空全部状态（会话切换时用）。 */
  reset(): void {
    this.startedAt = 0;
    this.tokens = 0;
    this.frozen = undefined;
  }

  private compute(): number | undefined {
    if (this.startedAt === 0 || this.tokens <= 0) return undefined;
    const seconds = (Date.now() - this.startedAt) / 1000;
    // 采样窗口太短时噪声很大，直接不给值。
    if (seconds < 0.5) return undefined;
    return this.tokens / seconds;
  }
}

/** 速度格式化。 */
export function formatSpeed(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return `${value.toFixed(1)} tps`;
}
