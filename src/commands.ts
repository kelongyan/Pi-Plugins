/**
 * /zxdl 命令：打开设置面板 / 查看状态。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiRuntimeCapabilities } from "./core/pi-compat.ts";
import { resolveTheme, type ThemeLike } from "./core/theme.ts";
import { SettingsPanel } from "./settings/panel.ts";
import { cloneSettings, type ZxdlSettings } from "./settings/schema.ts";

export type ZxdlStatus = {
  settings: ZxdlSettings;
  /** 当前实例是否持有 TUI 渲染资源所有权。 */
  active: boolean;
  capabilities?: PiRuntimeCapabilities;
  failures: string[];
};

export type CommandOps = {
  getStatus: () => ZxdlStatus;
  /** 取当前配置的副本（面板编辑用）。 */
  getSettings: () => ZxdlSettings;
  /** 保存配置（持久化 + 即时应用）。 */
  saveSettings: (settings: ZxdlSettings) => void;
};

const HELP = [
  "用法：",
  "  /zxdl            打开设置面板",
  "  /zxdl status     查看当前状态与能力探测",
  "  /zxdl help       显示本帮助",
].join("\n");

function notify(ctx: unknown, message: string, level: "info" | "warning" | "error" = "info"): void {
  try {
    const ui = (ctx as { ui?: { notify?: (text: string, kind: string) => void } } | undefined)?.ui;
    ui?.notify?.(message, level);
  } catch {
    // reload 后 stale ctx 会抛错，通知失败直接忽略。
  }
}

function onOff(value: boolean): string {
  return value ? "开" : "关";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatStatus(status: ZxdlStatus): string {
  const { settings, capabilities, active, failures } = status;
  const lines: string[] = [];

  lines.push(`pi-zxdl v0.1.0 · ${active ? "已接管 TUI 渲染资源" : "未接管（非交互式会话或未启动）"}`);
  lines.push(`总开关：${onOff(settings.enabled)}`);
  lines.push(
    `① 消息外框：${onOff(settings.messageFrame.enabled)}` +
      `（assistant ${settings.messageFrame.assistantFrame ? "加框" : "不加框"}` +
      ` / user ${settings.messageFrame.userFrame ? "加框" : "不加框"}）`,
  );
  lines.push(`② 思考过程线框：${onOff(settings.thinking.enabled)}（静态线框，无动画）`);
  lines.push(
    `③ 输入框线框：${onOff(settings.inputFrame.enabled)}` +
      `（thinking ${onOff(settings.inputFrame.showThinking)}` +
      ` / 上下文 ${onOff(settings.inputFrame.showContext)}` +
      ` / 模型名 ${onOff(settings.inputFrame.showModel)}）`,
  );

  if (capabilities) {
    lines.push(
      "能力探测：" +
        [
          `外框 ${capabilities.messageFrame.supported ? "可用" : "不可用"}`,
          `思考 ${capabilities.thinking.supported ? "可用" : "不可用"}`,
          `输入框 ${capabilities.inputFrame.supported ? "可用" : "不可用"}`,
        ].join(" / "),
    );
    if (capabilities.inputFrame.tuiMode) {
      lines.push(`TUI 模式：${capabilities.inputFrame.tuiMode}`);
    }
  } else {
    lines.push("能力探测：尚未执行（需在交互式会话中启动）");
  }

  if (failures.length > 0) {
    lines.push("降级原因：");
    for (const failure of failures) lines.push(`  · ${failure}`);
  }

  return lines.join("\n");
}

/** 面板主题兜底：Pi 传入的主题不可用时退回运行时主题。 */
function pickTheme(candidate: unknown): ThemeLike {
  const theme = candidate as { fg?: unknown } | undefined;
  if (theme && typeof theme.fg === "function") return candidate as ThemeLike;
  return resolveTheme();
}

/**
 * 打开设置面板（overlay）。
 * 用 overlay 而不是替换编辑器容器 —— 后者会导致设置页不出现、输入被清空、焦点异常。
 */
async function openSettingsPanel(ctx: unknown, ops: CommandOps): Promise<void> {
  const ui = (ctx as { ui?: { custom?: unknown } } | undefined)?.ui;
  if (!ui || typeof ui.custom !== "function") {
    notify(ctx, "设置面板需要交互式 UI（当前会话不支持）。", "warning");
    return;
  }

  // 编辑副本：面板里的改动先落到副本，每次变更再整体交回调用方保存。
  const draft = cloneSettings(ops.getSettings());

  try {
    await (ui.custom as (
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => unknown,
      options: Record<string, unknown>,
    ) => Promise<void>)(
      (_tui, panelTheme, _keybindings, done) =>
        new SettingsPanel(pickTheme(panelTheme), draft, {
          onChange: (next) => {
            ops.saveSettings(cloneSettings(next));
          },
          close: () => {
            done();
          },
        }),
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: "70%", minWidth: 48, maxHeight: "80%", margin: 1 },
      },
    );
  } catch (error) {
    notify(ctx, `设置面板打开失败：${describeError(error)}`, "error");
  }
}

export function registerZxdlCommand(pi: ExtensionAPI, ops: CommandOps): void {
  pi.registerCommand("zxdl", {
    description: "打开 pi-zxdl 设置面板（/zxdl status 查看状态）",
    handler: async (args: string, ctx: any) => {
      const trimmed = (args ?? "").trim();

      if (trimmed === "help") {
        notify(ctx, HELP);
        return;
      }
      if (trimmed === "status") {
        notify(ctx, formatStatus(ops.getStatus()));
        return;
      }
      if (trimmed === "" || trimmed === "settings") {
        await openSettingsPanel(ctx, ops);
        return;
      }

      notify(ctx, HELP, "warning");
    },
  });
}
