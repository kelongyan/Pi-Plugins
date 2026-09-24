/**
 * 带线框的编辑器。
 *
 * 继承 Pi 官方 `CustomEditor`，**只接管 render** ——
 * 输入、提交、补全、历史、粘贴等语义全部保留父类行为（官方 docs/tui.md 的明确要求）。
 * 拿不到 CustomEditor 时退回 pi-tui 的 `Editor`，逻辑等价。
 *
 * 注意：`setEditorComponent` 挂载的 factory 返回 undefined 是合法语义（表示不接管），
 * 因此这里的降级路径不会破坏宿主。
 */

import * as PiAgent from "@earendil-works/pi-coding-agent";
import { Editor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { IDENTITY_THEME, type ThemeLike } from "../../core/theme.ts";
import { sanitizeTerminalText } from "../../utils/terminal-sanitizer.ts";
import { MIN_FRAME_WIDTH, renderEditorFrame, type EditorFrameStatus } from "./frame.ts";

export type FramedEditorState = {
  getTheme(): ThemeLike;
  getStatus(): EditorFrameStatus;
};

export type FramedEditorOptions = {
  /** 测试注入点：替换 CustomEditor 基类。传 null 可强制走 Editor 降级路径。 */
  CustomEditor?: unknown;
};

function asLines(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

/**
 * 创建带线框的 editor。
 * 返回的实例只覆盖 render，其余行为继承基类。
 */
export function createFramedEditor(
  tui: unknown,
  editorTheme: unknown,
  keybindings: unknown,
  state: FramedEditorState,
  options: FramedEditorOptions = {},
): unknown {
  const theme = (editorTheme ?? IDENTITY_THEME) as ThemeLike;
  const injected = options.CustomEditor;
  const Base: unknown =
    injected !== undefined ? injected : (PiAgent as { CustomEditor?: unknown }).CustomEditor;

  if (typeof Base === "function") {
    class ZxdlFramedEditor extends (Base as any) {
      render(width: number): string[] {
        const numericWidth = Number.isFinite(width) ? Math.floor(width) : 0;
        if (numericWidth < MIN_FRAME_WIDTH) return asLines(super.render(numericWidth));

        const innerWidth = Math.max(1, numericWidth - 4);
        const { editorLines, popupLines } = splitNativeEditorRender(asLines(super.render(innerWidth)));

        return [
          ...renderEditorFrame({
            editorLines,
            width: numericWidth,
            theme: state.getTheme(),
            status: state.getStatus(),
          }),
          ...fitPopupLines(popupLines, numericWidth),
        ];
      }
    }
    // 基类是运行时注入的，TS 无法推断其构造签名，这里显式放宽。
    const FramedCtor = ZxdlFramedEditor as unknown as new (...args: unknown[]) => unknown;
    return new FramedCtor(tui, theme, keybindings, { paddingX: 0 });
  }

  class ZxdlFallbackEditor extends Editor {
    render(width: number): string[] {
      const numericWidth = Number.isFinite(width) ? Math.floor(width) : 0;
      if (numericWidth < MIN_FRAME_WIDTH) return asLines(super.render(numericWidth));

      const innerWidth = Math.max(1, numericWidth - 4);
      const { editorLines, popupLines } = splitNativeEditorRender(asLines(super.render(innerWidth)));

      return [
        ...renderEditorFrame({
          editorLines,
          width: numericWidth,
          theme: state.getTheme(),
          status: state.getStatus(),
        }),
        ...fitPopupLines(popupLines, numericWidth),
      ];
    }
  }
  return new ZxdlFallbackEditor(tui as any, theme as any, { paddingX: 0 } as any);
}

/** 判断一行是否为 Pi 原生 editor 的上下横线（可能带滚动提示字符）。 */
export function isNativeEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  if (!plain.includes("─")) return false;
  for (const char of plain) {
    if (!"─↑↓ 0123456789more".includes(char)) return false;
  }
  return true;
}

/**
 * 剥离 Pi 原生 editor 的上下横线。
 * autocomplete / select-list 等弹出内容保留，由调用方追加在线框之外。
 */
export function splitNativeEditorRender(lines: readonly string[]): {
  editorLines: string[];
  popupLines: string[];
} {
  if (lines.length === 0) return { editorLines: [], popupLines: [] };

  const withoutTop = isNativeEditorRule(lines[0] ?? "") ? lines.slice(1) : lines.slice();
  const bottomRuleIndex = withoutTop.findIndex(isNativeEditorRule);
  if (bottomRuleIndex === -1) return { editorLines: withoutTop, popupLines: [] };

  return {
    editorLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

/** 弹出内容补足到整宽，保证它们不会破坏线框外的视觉对齐。 */
function fitPopupLines(lines: readonly string[], width: number): string[] {
  return lines.map((line) => {
    const clipped = truncateToWidth(line, Math.max(1, width), "", true);
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  });
}

function stripAnsi(line: string): string {
  return sanitizeTerminalText(line, { allowNewline: false, allowTab: false, preserveSgr: false });
}
