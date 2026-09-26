/**
 * 自定义启动画面：像素 logo header 替换 Pi 原生启动横幅。
 *
 * 走官方扩展 API `ctx.ui.setHeader`（同槽位替换 builtInHeader，传 undefined 恢复原生），
 * 不 patch 任何内部容器。前置条件：Pi 设置 quietStartup 已开启（屏蔽原生横幅与资源
 * 列表），否则原生横幅会与本 header 叠加显示。
 *
 * 布局对齐参考图（pi-open-tui README 预览）：
 *   [π logo]   Pi v0.87.1
 *   [π logo]   / commands · ! bash · ctrl+o more
 *   [π logo]   ● ready
 *
 *   ◆ Resources · tools 19 · commands 12
 *
 * ⚠️ 资源计数只展示扩展 API 可得项（tools / commands）；Pi 内部 resourceLoader 的
 * skills/themes 等计数不暴露给扩展，不读内部状态。
 */

import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { safeFg, type ThemeLike } from "../core/theme.ts";
import { padToWidth } from "../utils/width.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** π 字形像素画：# = 主题色块（渲染为 ██，占 2 列），空格留白。 */
const LOGO_TEMPLATE = [
  "######",
  "  #  #",
  "  #  #",
  "  #  #",
  " ##  #",
] as const;

const LOGO_CELL = "██";
const COLUMNS_GAP = "  ";
const INFO_OFFSET = 1;
/** 低于该宽度放弃双列布局，退化为单行版本号。 */
const MIN_WIDTH = 40;

/** 右列的固定快捷键提示（Pi 默认键位，quietStartup 横幅同款信息）。 */
const KEY_HINTS = "/ commands · ! bash · ctrl+o more";

export type ResourceCounts = { tools: number; commands: number; skills: number; mcp: number };

/**
 * 按 pi-mcp-adapter 的配置路径约定统计 MCP server 数（server 名并集去重）。
 * 同步实现：只在 header 安装时调用一次，结果缓存进计数闭包，render 零磁盘开销。
 * 只读标准位置的 JSON 配置，不碰任何运行时状态；单个文件缺失/损坏都安全跳过。
 * 兼容 `servers` 与 `mcpServers`（Claude Code 风格）两种键名。
 */
export function countMcpServers(cwd: string): number {
  const home = homedir();
  const candidates = [
    // Pi 全局覆盖（getAgentDir 尊重 PI_CODING_AGENT_DIR），其余按 pi-mcp-adapter README 的共享路径约定。
    join(getAgentDir(), "mcp.json"),
    join(home, ".config", "mcp", "mcp.json"),
    join(home, ".agents", "mcp.json"),
    join(home, ".agents", "mcp", "mcp.json"),
    join(cwd, ".mcp.json"),
    join(cwd, ".pi", "mcp.json"),
  ];

  const names = new Set<string>();
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as {
        servers?: Record<string, unknown>;
        mcpServers?: Record<string, unknown>;
      };
      for (const name of Object.keys(parsed.servers ?? {})) names.add(name);
      for (const name of Object.keys(parsed.mcpServers ?? {})) names.add(name);
    } catch {
      // 文件缺失（ENOENT）或 JSON 损坏：跳过该候选，不影响其余。
    }
  }
  return names.size;
}

export type StartupHeaderDeps = {
  theme: ThemeLike;
  /** 会话是否空闲（true → ready，false → working）。 */
  isIdle: () => boolean;
  /** 资源计数（扩展 API 可得项）。 */
  getResourceCounts: () => ResourceCounts;
};

/** header 主体行数（logo 高度 + Resources 行 + 分隔空行）。 */
export const HEADER_LINE_COUNT = LOGO_TEMPLATE.length + 2;

export class ZxdlHeader {
  private readonly deps: StartupHeaderDeps;

  constructor(deps: StartupHeaderDeps) {
    this.deps = deps;
  }

  /** pi-tui Component 契约：header 内容是静态的，无需失效缓存。 */
  invalidate(): void {}

  dispose(): void {}

  render(width: number): string[] {
    const numericWidth = Number.isFinite(width) ? Math.floor(width) : 0;
    try {
      return this.renderInner(numericWidth);
    } catch {
      return [`Pi v${VERSION}`];
    }
  }

  private renderInner(width: number): string[] {
    const theme = this.deps.theme;
    if (width < MIN_WIDTH) {
      return [safeFg(theme, "accent", `Pi v${VERSION}`)];
    }

    const logoWidth = LOGO_TEMPLATE[0].length * LOGO_CELL.length;
    const infoLines = this.renderInfoLines();
    const lines: string[] = [];

    for (let y = 0; y < LOGO_TEMPLATE.length; y++) {
      const logoRow = [...LOGO_TEMPLATE[y]]
        .map((ch) => (ch === "#" ? safeFg(theme, "accent", LOGO_CELL) : "  "))
        .join("");
      const index = y - INFO_OFFSET;
      const info = index >= 0 && index < infoLines.length ? infoLines[index] : "";
      const row = padToWidth(logoRow, logoWidth) + COLUMNS_GAP + info;
      lines.push(visibleWidth(row) > width ? row.slice(0, width) : row);
    }

    lines.push("");
    // Resources 行带多处 ANSI，宽度不足时用 pi-tui 的宽度安全截断（suffix 置空避免尾部 reset）。
    lines.push(truncateToWidth(this.renderResourcesLine(), width, ""));
    return lines;
  }

  private renderInfoLines(): string[] {
    const theme = this.deps.theme;
    const version = safeFg(theme, "accent", "Pi") + safeFg(theme, "dim", ` v${VERSION}`);
    const hints = safeFg(theme, "dim", KEY_HINTS);
    let ready: string;
    try {
      ready = this.deps.isIdle()
        ? safeFg(theme, "accent", "● ready")
        : safeFg(theme, "muted", "● working");
    } catch {
      ready = "● ready";
    }
    return [version, hints, ready];
  }

  private renderResourcesLine(): string {
    const theme = this.deps.theme;
    let counts: ResourceCounts = { tools: 0, commands: 0, skills: 0, mcp: 0 };
    try {
      counts = this.deps.getResourceCounts();
    } catch {
      // 计数失败显示 0，不影响 header 其余部分。
    }
    const entry = (label: string, value: number) =>
      safeFg(theme, "muted", `${label} `) + safeFg(theme, "accent", String(value));
    return (
      safeFg(theme, "accent", "◆ ") +
      safeFg(theme, "text", "Resources") +
      safeFg(theme, "dim", " · ") +
      entry("tools", counts.tools) +
      safeFg(theme, "dim", " · ") +
      entry("commands", counts.commands) +
      safeFg(theme, "dim", " · ") +
      entry("skills", counts.skills) +
      safeFg(theme, "dim", " · ") +
      entry("mcp", counts.mcp)
    );
  }
}

/** Pi 扩展门面上与本功能相关的最小 UI 形状（只声明用到的）。 */
type HeaderUiLike = {
  setHeader?: (factory: ((tui: unknown) => unknown) | undefined) => void;
};

export type StartupHeaderHandle = {
  dispose(): void;
};

/**
 * 安装自定义启动 header。
 * 返回 undefined 表示 ctx.ui.setHeader 不可用（老版本 Pi / 非 TUI 门面），调用方 fail-closed。
 */
export function installStartupHeader(ctx: unknown, deps: StartupHeaderDeps): StartupHeaderHandle | undefined {
  const ui = (ctx as { ui?: HeaderUiLike } | undefined)?.ui;
  if (!ui || typeof ui.setHeader !== "function") return undefined;

  let component: ZxdlHeader | undefined;
  let disposed = false;
  try {
    ui.setHeader(() => {
      component = new ZxdlHeader(deps);
      return component;
    });
  } catch {
    return undefined;
  }

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        // 传 undefined 恢复 Pi 原生 header（setExtensionHeader 的官方回退路径）。
        ui.setHeader?.(undefined);
      } catch {
        // reload 后 stale ctx 会抛错；组件引用一并释放即可。
      }
      component?.dispose();
      component = undefined;
    },
  };
}
