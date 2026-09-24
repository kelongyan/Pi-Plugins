/**
 * /zxdl 命令：展示当前状态与能力探测结果。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PiRuntimeCapabilities } from "./core/pi-compat.ts";
import type { ZxdlSettings } from "./settings/schema.ts";

export type ZxdlStatus = {
  settings: ZxdlSettings;
  /** 当前实例是否持有 TUI 渲染资源所有权。 */
  active: boolean;
  capabilities?: PiRuntimeCapabilities;
  failures: string[];
};

export type CommandOps = {
  getStatus: () => ZxdlStatus;
};

const HELP = "用法：/zxdl 查看状态；/zxdl help 查看帮助。";

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

function formatStatus(status: ZxdlStatus): string {
  const { settings, capabilities, active, failures } = status;
  const lines: string[] = [];

  lines.push(`pi-zxdl v0.1.0 · ${active ? "已接管 TUI 渲染资源" : "未接管（非交互式会话或未启动）"}`);
  lines.push(`总开关：${onOff(settings.enabled)}`);
  lines.push(
    `① 消息外框：${onOff(settings.messageFrame.enabled)}` +
      `（assistant ${settings.messageFrame.assistantFrame ? "加框" : "不加框"}` +
      ` / user ${settings.messageFrame.userFrame ? "加框" : "不加框"}）`,
  );
  lines.push(`② 思考过程：${onOff(settings.thinking.enabled)}（${settings.thinking.fps} fps）`);
  lines.push(`③ 输入框线框：${onOff(settings.inputFrame.enabled)}`);

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

  lines.push("当前处于 P0 骨架阶段：基础设施就绪，UI 功能尚未接入。");
  return lines.join("\n");
}

export function registerZxdlCommand(pi: ExtensionAPI, ops: CommandOps): void {
  pi.registerCommand("zxdl", {
    description: "查看 pi-zxdl 状态与能力探测结果",
    handler: async (args: string, ctx: any) => {
      const trimmed = (args ?? "").trim();
      if (trimmed === "help") {
        notify(ctx, HELP);
        return;
      }
      notify(ctx, formatStatus(ops.getStatus()));
    },
  });
}
