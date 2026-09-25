/**
 * 自带主题（Eva）的应用逻辑。
 *
 * pi-zxdl 打包了 `eva-dark` / `eva-light` 两套主题（由 Eva-Theme 的配色映射到 Pi 主题 roles）。
 * 安装后首次启动会自动切过去，但**只在当前主题仍是 Pi 自带默认值时**才接管 ——
 * 用户手动选过任何其它主题就不再干预，避免「改完又被改回去」。
 */

/** 优先尝试自动跟随终端明暗；不被接受时退回单一深色主题。 */
export const ZXDL_THEME_SETTING = "eva-light/eva-dark";
export const ZXDL_THEME_FALLBACK = "eva-dark";

/** Pi 自带的主题名（含自动模式的组合写法）。 */
const BUILTIN_THEMES = new Set(["dark", "light", "light/dark", "dark/light"]);

export type ThemeUiLike = {
  setTheme?: (theme: string) => { success: boolean; error?: string } | undefined;
};

/** 当前主题设置是否仍为 Pi 自带（含从未设置）。 */
export function isBuiltinTheme(setting: string | undefined): boolean {
  if (setting === undefined) return true;
  const trimmed = setting.trim();
  if (trimmed === "") return true;
  return BUILTIN_THEMES.has(trimmed);
}

/**
 * 尝试把主题切到自带的 eva。
 * 返回实际切到的主题名；未切换时返回 undefined（API 不可用 / 用户已有自定义主题 / 两个候选都失败）。
 */
export function applyDefaultTheme(
  ui: ThemeUiLike | undefined,
  currentSetting: string | undefined,
): string | undefined {
  if (!ui || typeof ui.setTheme !== "function") return undefined;
  if (!isBuiltinTheme(currentSetting)) return undefined;

  for (const name of [ZXDL_THEME_SETTING, ZXDL_THEME_FALLBACK]) {
    try {
      const result = ui.setTheme(name);
      if (result?.success) return name;
    } catch {
      // 单个候选失败不影响下一个。
    }
  }
  return undefined;
}
