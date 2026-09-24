import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../src/core/theme.ts";
import { MIN_FRAME_WIDTH, renderEditorFrame } from "../src/features/input-frame/frame.ts";

/** 真实 ANSI 主题：验证着色后宽度计算依然成立。 */
const ANSI_THEME: ThemeLike = {
  fg: (_token, text) => `\x1b[38;2;1;2;3m${text}\x1b[39m`,
};

/** 纯文本主题：便于对标签做字符串断言。 */
const PLAIN_THEME: ThemeLike = { fg: (_token, text) => text };

function assertWidths(lines: readonly string[], width: number, label: string): void {
  for (const [index, line] of lines.entries()) {
    const actual = visibleWidth(line);
    assert.equal(actual, width, `${label} 第 ${index} 行宽度应为 ${width}，实际 ${actual}`);
  }
}

test("线框三部分齐全且每行宽度合规", () => {
  const lines = renderEditorFrame({
    editorLines: ["> 输入内容"],
    width: 40,
    theme: ANSI_THEME,
    status: {},
  });

  assert.equal(lines.length, 3);
  assert.ok((lines[0] ?? "").includes("╭"));
  assert.ok((lines[2] ?? "").includes("╰"));
  assertWidths(lines, 40, "基础线框");
});

test("顶边左侧嵌入模型名与 thinking 级别", () => {
  const lines = renderEditorFrame({
    editorLines: ["> x"],
    width: 50,
    theme: PLAIN_THEME,
    status: { model: "claude-x", thinking: "high" },
  });

  const top = lines[0] ?? "";
  assert.ok(top.includes("claude-x"));
  assert.ok(top.includes("high"));
  assert.ok(top.includes(" · "), "模型与 thinking 之间应有分隔符");
});

test("顶边右侧嵌入上下文状态", () => {
  const lines = renderEditorFrame({
    editorLines: ["> x"],
    width: 50,
    theme: PLAIN_THEME,
    status: { context: "42%" },
  });

  assert.ok((lines[0] ?? "").includes("42%"));
});

test("多行内容各占一行且都合规", () => {
  const lines = renderEditorFrame({
    editorLines: ["> 第一行", "> 第二行", "> 第三行"],
    width: 36,
    theme: ANSI_THEME,
    status: { model: "m" },
  });

  assert.equal(lines.length, 5, "应为 顶框 + 3 内容行 + 底框");
  assertWidths(lines, 36, "多行");
});

test("空内容也会保留一个空内容行", () => {
  const lines = renderEditorFrame({ editorLines: [], width: 30, theme: PLAIN_THEME, status: {} });
  assert.equal(lines.length, 3);
});

test("宽度不足时回退原始行，不画框", () => {
  const raw = ["> abc"];
  const lines = renderEditorFrame({
    editorLines: raw,
    width: MIN_FRAME_WIDTH - 1,
    theme: ANSI_THEME,
    status: {},
  });

  assert.deepEqual(lines, raw);
});

test("窄宽度下标签被降级，但外框保持闭合", () => {
  const lines = renderEditorFrame({
    editorLines: ["> x"],
    width: 20,
    theme: PLAIN_THEME,
    status: { model: "very-long-model-name", thinking: "high", context: "99% 200k" },
  });

  assertWidths(lines, 20, "窄宽度");
  assert.ok((lines[0] ?? "").startsWith("╭"));
  assert.ok((lines[0] ?? "").endsWith("╮"));
});

test("极端窄宽度下外框仍然闭合（标签全部省略）", () => {
  const lines = renderEditorFrame({
    editorLines: ["> x"],
    width: MIN_FRAME_WIDTH,
    theme: PLAIN_THEME,
    status: { model: "a-very-long-model-name", context: "99% 200k" },
  });

  assertWidths(lines, MIN_FRAME_WIDTH, "最小宽度");
  assert.ok((lines[0] ?? "").startsWith("╭"));
  assert.ok((lines[0] ?? "").endsWith("╮"));
});

test("超长内容截断后仍保留光标标记", () => {
  const line = `> ${"x".repeat(200)}${CURSOR_MARKER}`;
  const lines = renderEditorFrame({ editorLines: [line], width: 40, theme: PLAIN_THEME, status: {} });

  const content = lines[1] ?? "";
  assert.ok(content.includes(CURSOR_MARKER), "截断不得丢失光标标记");
  assert.equal(visibleWidth(content), 40);
});

test("宽度充足时光标标记之前的文本保持原样", () => {
  const line = `> abc${CURSOR_MARKER}`;
  const lines = renderEditorFrame({ editorLines: [line], width: 40, theme: PLAIN_THEME, status: {} });

  const content = lines[1] ?? "";
  const beforeMarker = content.slice(0, content.indexOf(CURSOR_MARKER));
  assert.ok(beforeMarker.endsWith("abc"));
});
