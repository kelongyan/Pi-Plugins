/**
 * /zxdl 设置面板。
 *
 * 用 `ctx.ui.custom()` + `overlay: true` 打开 —— 官方推荐的自定义交互界面方式。
 * 刻意**不用** non-overlay：那会替换 editor 容器，导致设置页不出现、输入被清空、焦点异常
 * （alps-pi 的 `input-layer-freeze.md` 记录了这些坑）。
 *
 * 渲染与状态分离：`renderPanelLines()` 是纯函数（可单测），面板类只负责键盘交互。
 */

import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../core/theme.ts";
import type { ZxdlSettings } from "./schema.ts";

export type ToggleItem = {
  id: string;
  label: string;
  /** 缩进层级，用于表达从属关系。 */
  depth: number;
  get(settings: ZxdlSettings): boolean;
  set(settings: ZxdlSettings, value: boolean): void;
};

/** 枚举项：Enter/空格在 values 中循环切换。 */
export type ChoiceItem = {
  id: string;
  label: string;
  depth: number;
  kind: "choice";
  values: readonly string[];
  /** 值 → 面板显示文本。 */
  labels: Readonly<Record<string, string>>;
  getChoice(settings: ZxdlSettings): string;
  setChoice(settings: ZxdlSettings, value: string): void;
};

export type SettingsItem = ToggleItem | ChoiceItem;

/** 面板里的开关清单，顺序即显示顺序。 */
export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  {
    id: "enabled",
    label: "总开关",
    depth: 0,
    get: (settings) => settings.enabled,
    set: (settings, value) => {
      settings.enabled = value;
    },
  },
  {
    id: "style",
    label: "对话流风格",
    depth: 1,
    kind: "choice",
    values: ["minimal", "boxed"],
    labels: { minimal: "极简（锚点）", boxed: "经典（外框）" },
    getChoice: (settings) => settings.style,
    setChoice: (settings, value) => {
      settings.style = value === "boxed" ? "boxed" : "minimal";
    },
  },
  {
    id: "assistantAnchor",
    label: "assistant 加 ● 锚点",
    depth: 2,
    get: (settings) => settings.assistantAnchor,
    set: (settings, value) => {
      settings.assistantAnchor = value;
    },
  },
  {
    id: "bashFrame",
    label: "bash 保留外框",
    depth: 2,
    get: (settings) => settings.bashFrame,
    set: (settings, value) => {
      settings.bashFrame = value;
    },
  },
  {
    id: "hideScrollToEnd",
    label: "隐藏 Jump to latest 提示",
    depth: 1,
    get: (settings) => settings.hideScrollToEnd,
    set: (settings, value) => {
      settings.hideScrollToEnd = value;
    },
  },
  {
    id: "diffHighlight",
    label: "edit 代码高亮",
    depth: 1,
    get: (settings) => settings.diffHighlight,
    set: (settings, value) => {
      settings.diffHighlight = value;
    },
  },
  {
    id: "startupHeader",
    label: "自定义启动画面（需 Pi Quiet startup）",
    depth: 1,
    get: (settings) => settings.startup.enabled,
    set: (settings, value) => {
      settings.startup.enabled = value;
    },
  },
  {
    id: "messageFrame",
    label: "消息外框",
    depth: 1,
    get: (settings) => settings.messageFrame.enabled,
    set: (settings, value) => {
      settings.messageFrame.enabled = value;
    },
  },
  {
    id: "assistantFrame",
    label: "助手回复加框",
    depth: 2,
    get: (settings) => settings.messageFrame.assistantFrame,
    set: (settings, value) => {
      settings.messageFrame.assistantFrame = value;
    },
  },
  {
    id: "userFrame",
    label: "用户消息加框",
    depth: 2,
    get: (settings) => settings.messageFrame.userFrame,
    set: (settings, value) => {
      settings.messageFrame.userFrame = value;
    },
  },
  {
    id: "thinkingFrame",
    label: "思考块独立框",
    depth: 2,
    get: (settings) => settings.thinking.enabled,
    set: (settings, value) => {
      settings.thinking.enabled = value;
    },
  },
  {
    id: "inputFrame",
    label: "输入框线框",
    depth: 1,
    get: (settings) => settings.inputFrame.enabled,
    set: (settings, value) => {
      settings.inputFrame.enabled = value;
    },
  },
  {
    id: "showThinking",
    label: "顶边显示 thinking",
    depth: 2,
    get: (settings) => settings.inputFrame.showThinking,
    set: (settings, value) => {
      settings.inputFrame.showThinking = value;
    },
  },
  {
    id: "showContext",
    label: "顶边显示上下文",
    depth: 2,
    get: (settings) => settings.inputFrame.showContext,
    set: (settings, value) => {
      settings.inputFrame.showContext = value;
    },
  },
  {
    id: "showModel",
    label: "顶边显示模型名",
    depth: 2,
    get: (settings) => settings.inputFrame.showModel,
    set: (settings, value) => {
      settings.inputFrame.showModel = value;
    },
  },
  {
    id: "statusBar",
    label: "底部状态栏",
    depth: 1,
    get: (settings) => settings.statusBar.enabled,
    set: (settings, value) => {
      settings.statusBar.enabled = value;
    },
  },
  {
    id: "sbModel",
    label: "模型 + thinking",
    depth: 2,
    get: (settings) => settings.statusBar.segments.model,
    set: (settings, value) => {
      settings.statusBar.segments.model = value;
    },
  },
  {
    id: "sbPath",
    label: "工作目录",
    depth: 2,
    get: (settings) => settings.statusBar.segments.path,
    set: (settings, value) => {
      settings.statusBar.segments.path = value;
    },
  },
  {
    id: "sbGit",
    label: "git 分支",
    depth: 2,
    get: (settings) => settings.statusBar.segments.git,
    set: (settings, value) => {
      settings.statusBar.segments.git = value;
    },
  },
  {
    id: "sbContext",
    label: "上下文用量",
    depth: 2,
    get: (settings) => settings.statusBar.segments.context,
    set: (settings, value) => {
      settings.statusBar.segments.context = value;
    },
  },
  {
    id: "sbTokens",
    label: "Token 计数",
    depth: 2,
    get: (settings) => settings.statusBar.segments.tokens,
    set: (settings, value) => {
      settings.statusBar.segments.tokens = value;
    },
  },
  {
    id: "sbSpeed",
    label: "输出速度",
    depth: 2,
    get: (settings) => settings.statusBar.segments.speed,
    set: (settings, value) => {
      settings.statusBar.segments.speed = value;
    },
  },
  {
    id: "sbIcons",
    label: "使用 emoji 图标",
    depth: 2,
    get: (settings) => settings.statusBar.icons === "emoji",
    set: (settings, value) => {
      settings.statusBar.icons = value ? "emoji" : "plain";
    },
  },
];

const TITLE = " pi-zxdl 设置 ";
const HINT = "  ↑↓ 选择 · Enter/空格 切换 · Esc 关闭";

function isChoiceItem(item: SettingsItem): item is ChoiceItem {
  return "kind" in item && item.kind === "choice";
}

/** 枚举项的显示文本。 */
function choiceDisplay(item: ChoiceItem, settings: ZxdlSettings): string {
  const current = item.getChoice(settings);
  return item.labels[current] ?? current;
}

/**
 * 纯渲染：产出整屏行，每行显示宽度严格等于 width。
 */
export function renderPanelLines(
  theme: ThemeLike,
  settings: ZxdlSettings,
  selectedIndex: number,
  width: number,
): string[] {
  const total = Math.max(24, Math.floor(width) || 0);
  const inner = Math.max(0, total - 4);
  const border = (text: string): string => theme.fg("borderMuted", text);

  const contentLine = (text: string, selected: boolean): string => {
    const clipped = truncateToWidth(text, inner, "", false);
    const padded = clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
    const styled = selected ? theme.fg("accent", padded) : padded;
    return border("│") + " " + styled + " " + border("│");
  };

  const out: string[] = [];

  // 顶边：标题嵌在边框里
  const titleText = truncateToWidth(TITLE, Math.max(0, inner - 2), "", false);
  const topDashes = Math.max(0, total - 3 - visibleWidth(titleText));
  out.push(border("╭─") + theme.fg("accent", titleText) + border(`${"─".repeat(topDashes)}╮`));

  for (const [index, item] of SETTINGS_ITEMS.entries()) {
    const selected = index === selectedIndex;
    const marker = selected ? ">" : " ";
    const indent = "  ".repeat(item.depth);
    const label = `${marker} ${indent}${item.label}`;
    const value = isChoiceItem(item) ? choiceDisplay(item, settings) : item.get(settings) ? "开" : "关";
    const gap = Math.max(1, inner - visibleWidth(label) - visibleWidth(value) - 1);
    out.push(contentLine(`${label}${" ".repeat(gap)}${value}`, selected));
  }

  out.push(contentLine("", false));
  out.push(contentLine(HINT, false));
  out.push(border(`╰${"─".repeat(Math.max(0, total - 2))}╯`));

  return out;
}

export type PanelCallbacks = {
  /** 任一开关变化后调用（持久化 + 即时应用）。 */
  onChange(settings: ZxdlSettings): void;
  /** 请求关闭面板。 */
  close(): void;
};

export class SettingsPanel {
  private selectedIndex = 0;
  private readonly theme: ThemeLike;
  private readonly settings: ZxdlSettings;
  private readonly callbacks: PanelCallbacks;

  // 注意：这里刻意不用 TS 的构造函数参数属性（`constructor(private x: T)`）。
  // 本项目测试跑在 node 的 strip-only 模式下，该语法需要代码生成，
  // 会直接报 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  constructor(theme: ThemeLike, settings: ZxdlSettings, callbacks: PanelCallbacks) {
    this.theme = theme;
    this.settings = settings;
    this.callbacks = callbacks;
  }

  render(width: number): string[] {
    return renderPanelLines(this.theme, this.settings, this.selectedIndex, width);
  }

  invalidate(): void {
    // 无缓存，无需处理。
  }

  handleInput(data: string): void {
    const count = SETTINGS_ITEMS.length;
    if (count === 0) return;

    if (matchesKey(data, "up") || data === "k") {
      this.selectedIndex = (this.selectedIndex + count - 1) % count;
      return;
    }
    if (matchesKey(data, "down") || data === "j") {
      this.selectedIndex = (this.selectedIndex + 1) % count;
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "space") || data === " ") {
      const item = SETTINGS_ITEMS[this.selectedIndex];
      if (item) {
        if (isChoiceItem(item)) {
          // 枚举项：循环切到下一个值。
          const current = item.getChoice(this.settings);
          const index = item.values.indexOf(current);
          const next = item.values[(index + 1) % item.values.length] ?? current;
          item.setChoice(this.settings, next);
        } else {
          item.set(this.settings, !item.get(this.settings));
        }
        this.callbacks.onChange(this.settings);
      }
      return;
    }
    if (matchesKey(data, "escape") || data === "q") {
      this.callbacks.close();
    }
  }
}
