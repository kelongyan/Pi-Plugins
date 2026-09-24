/**
 * 主题访问的唯一入口。
 *
 * Pi 把当前主题挂在 globalThis 的 symbol 上；读取与回退集中在这里，
 * 消息外框与输入框线框共用同一份实现。
 */

/** 主题的最小接口（只依赖 fg/bg，便于测试注入假主题）。 */
export type ThemeLike = {
  readonly name?: string;
  fg(token: string, text: string): string;
  bg?(token: string, text: string): string;
};

/** Pi 暴露当前主题用的全局 symbol（兼容旧包名）。 */
const THEME_SYMBOL_KEYS = [
  Symbol.for("@earendil-works/pi-coding-agent:theme"),
  Symbol.for("@mariozechner/pi-coding-agent:theme"),
];

/** 未绑定主题时的恒等回退：原样返回文本，保证渲染不会因缺主题而崩。 */
export const IDENTITY_THEME: ThemeLike = { fg: (_token, text) => text };

/** 读取 Pi 当前主题；拿不到时返回 undefined。 */
export function readRuntimeTheme(): ThemeLike | undefined {
  for (const key of THEME_SYMBOL_KEYS) {
    try {
      const candidate = (globalThis as unknown as Record<PropertyKey, unknown>)[key] as
        | { fg?: unknown }
        | undefined;
      if (candidate && typeof candidate.fg === "function") return candidate as ThemeLike;
    } catch {
      // globalThis 取值理论上不抛；防御一下不影响后续候选。
    }
  }
  return undefined;
}

/** 取当前主题，拿不到时回退为恒等主题。 */
export function resolveTheme(): ThemeLike {
  return readRuntimeTheme() ?? IDENTITY_THEME;
}

/** 安全取色：token 不存在时退回 fallback，再失败则返回原文。 */
export function safeFg(theme: ThemeLike, token: string, text: string, fallback = "text"): string {
  try {
    return theme.fg(token, text);
  } catch {
    try {
      return theme.fg(fallback, text);
    } catch {
      return text;
    }
  }
}
