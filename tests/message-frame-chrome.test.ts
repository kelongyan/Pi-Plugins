import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { isEmptyMessage, renderMessageBox, renderThinkingBox } from "../src/features/message-frame/chrome.ts";
import type { ThemeLike } from "../src/features/message-frame/styles.ts";

/** 纯文本主题：记录被用到的 token，同时不干扰宽度计算。 */
function recordingTheme(): { theme: ThemeLike; used: string[] } {
  const used: string[] = [];
  return {
    used,
    theme: {
      fg(token: string, text: string): string {
        used.push(token);
        return text;
      },
    },
  };
}

/** 真实 ANSI 主题：验证着色之后宽度计算依然成立。 */
const ANSI_THEME: ThemeLike = {
  fg: (_token, text) => `\x1b[38;2;10;20;30m${text}\x1b[39m`,
};

function assertAllLinesWidth(lines: readonly string[], width: number, label: string): void {
  for (const [index, line] of lines.entries()) {
    const actual = visibleWidth(line);
    assert.equal(actual, width, `${label} 第 ${index} 行宽度应为 ${width}，实际 ${actual}`);
  }
}

test("所有输出行的显示宽度严格等于给定宽度（含 ANSI 着色）", () => {
  const lines = renderMessageBox("assistant", ["hello world", "第二行内容"], 40, { theme: ANSI_THEME });
  assertAllLinesWidth(lines, 40, "ANSI 主题");
  assert.equal(lines.length, 4, "应为 顶框 + 2 内容行 + 底框");
});

test("外框结构正确：顶边带标签、内容行有竖线、底边闭合", () => {
  const lines = renderMessageBox("user", ["问题"], 30, { theme: recordingTheme().theme });
  assert.ok(lines[0]?.startsWith("╭─ "));
  assert.ok(lines[0]?.includes("USER"));
  assert.ok(lines[0]?.endsWith("╮"));
  assert.ok(lines[1]?.startsWith("│"));
  assert.ok(lines[1]?.endsWith("│"));
  assert.ok(lines.at(-1)?.startsWith("╰"));
  assert.ok(lines.at(-1)?.endsWith("╯"));
});

test("工具类型按状态使用对应主题 token", () => {
  const { theme, used } = recordingTheme();
  renderMessageBox("toolSuccess", ["ok"], 30, { theme, toolName: "read" });
  assert.ok(used.includes("success"), "成功态边框应使用 success token");
  assert.ok(used.includes("toolTitle"), "标签应使用 toolTitle token");
});

test("空内容的消息不渲染成空白框", () => {
  assert.deepEqual(renderMessageBox("assistant", [], 40, { theme: ANSI_THEME }), []);
  assert.deepEqual(renderMessageBox("assistant", ["", "   "], 40, { theme: ANSI_THEME }), []);
});

test("工具类即使正文为空也保留外框（框本身承载状态信息）", () => {
  const lines = renderMessageBox("toolSuccess", [], 40, { theme: ANSI_THEME, toolName: "bash" });
  assert.ok(lines.length >= 3);
});

test("宽度不足下限时回退为简单截断，不画框", () => {
  const lines = renderMessageBox("assistant", ["abcdefghij"], 6, { theme: ANSI_THEME });
  assert.equal(lines.length, 1);
  assert.ok(!(lines[0] ?? "").includes("╭"));
  assert.ok(visibleWidth(lines[0] ?? "") <= 6);
});

test("图片协议行整块透传，不被加框或截断", () => {
  const kitty = "\x1b_Ga=T,f=100;AAAA\x1b\\";
  const lines = renderMessageBox("toolSuccess", ["before", kitty, "after"], 40, {
    theme: ANSI_THEME,
    toolName: "read",
  });
  assert.ok(lines.includes(kitty), "图片行应原样出现在输出中");
});

test("超宽内容自动折行，且每行宽度依然合规", () => {
  const lines = renderMessageBox("assistant", ["x".repeat(200)], 30, { theme: ANSI_THEME });
  assertAllLinesWidth(lines, 30, "折行");
  assert.ok(lines.length > 3, "超长内容应产生多行");
});

test("底边框可携带耗时文本并保持闭合", () => {
  const lines = renderMessageBox("assistant", ["内容"], 40, {
    theme: recordingTheme().theme,
    elapsedText: "1.2s",
  });
  const bottom = lines.at(-1) ?? "";
  assert.ok(bottom.includes("1.2s"));
  assert.ok(bottom.endsWith("╯"));
});

test("紧凑思考框固定三行、带 THINK 标签且宽度合规", () => {
  const lines = renderThinkingBox(["deep thought here", "second line"], 30, { theme: ANSI_THEME });
  assert.equal(lines.length, 3);
  assert.ok(lines[0]?.includes("THINK"));
  assertAllLinesWidth(lines, 30, "思考框");
});

test("isEmptyMessage 只对消息类生效，工具类始终保留", () => {
  assert.equal(isEmptyMessage("assistant", []), true);
  assert.equal(isEmptyMessage("user", ["  "]), true);
  assert.equal(isEmptyMessage("thinking", []), true);
  assert.equal(isEmptyMessage("toolSuccess", []), false);
  assert.equal(isEmptyMessage("bash", []), false);
});

test("窄宽度下思考框同样回退，不产生破框", () => {
  const lines = renderThinkingBox(["abc"], 5, { theme: ANSI_THEME });
  assert.equal(lines.length, 1);
  assert.ok(!(lines[0] ?? "").includes("╭"));
});
