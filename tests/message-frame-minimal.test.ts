import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderAnchoredMessage } from "../src/features/message-frame/chrome.ts";
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

/** 剥掉 SGR 序列，取可见文本（用于判断可见内容的前缀）。 */
function plain(line: string | undefined): string {
  return (line ?? "").replace(/\x1b\[[0-9;:]*m/g, "");
}

test("用户消息：固定蓝色竖线引用块，无符号、无背景", () => {
  const { theme, used } = recordingTheme();
  const lines = renderAnchoredMessage("user", ["帮我把这个函数重构成纯函数"], 40, { theme });

  assert.equal(lines.length, 1);
  assert.ok(plain(lines[0]).startsWith("│ "), "每行以竖线开头");
  assert.ok(used.includes("accent"), "竖线应使用 accent token（固定蓝色）");
  assert.ok(!used.some((t) => t === "userMessageBg"), "不再使用背景条");
});

test("用户消息：原生背景被剥掉，不残留原生背景参数", () => {
  const nativeBgLine = "\x1b[48;5;99m 学习我的这个项目 \x1b[0m";
  const lines = renderAnchoredMessage("user", [nativeBgLine], 40, { theme: ANSI_THEME });

  assert.ok(!lines.some((line) => line.includes("48;5;99")), "原生背景参数应被剥掉");
  assert.match(plain(lines[0] ?? ""), /^│ 学习我的这个项目$/u);
});

test("用户消息多行时竖线逐行延续", () => {
  const lines = renderAnchoredMessage("user", ["第一行内容", "第二行内容"], 40, {
    theme: ANSI_THEME,
  });

  assert.equal(lines.length, 2);
  assert.ok(plain(lines[0]).startsWith("│ "));
  assert.ok(plain(lines[1]).startsWith("│ "), "折行以竖线延续（引用块形态）");
});

test("所有非空行的显示宽度不超过给定宽度（含 ANSI）", () => {
  const cases: Array<[Parameters<typeof renderAnchoredMessage>[0], string[]]> = [
    ["user", ["这一行比较长，用来观察折行与锚点宽度是否正确"]],
    ["thinking", ["先看调用方是否依赖内部状态…", "再看边界条件。", "还有第三行思考内容"]],
    ["toolSuccess", ["已修改 3 处", "- \"port\": 3000", "+ \"port\": 8080"]],
    ["bash", ["$ pnpm test", "✓ 78 passed", "✓ 79 passed"]],
    ["compaction", ["已把前 20 轮对话压缩为要点"]],
  ];

  for (const [kind, content] of cases) {
    const lines = renderAnchoredMessage(kind, content, 30, { theme: ANSI_THEME, toolName: "edit" });
    for (const [index, line] of lines.entries()) {
      assert.ok(
        visibleWidth(line) <= 30,
        `${kind} 第 ${index} 行宽度 ${visibleWidth(line)} 超过 30`,
      );
    }
  }
});

test("空内容的用户消息不渲染", () => {
  assert.deepEqual(renderAnchoredMessage("user", [], 40, { theme: ANSI_THEME }), []);
  assert.deepEqual(renderAnchoredMessage("user", ["", "   "], 40, { theme: ANSI_THEME }), []);
});

test("思考块：首行进摘要，其余行带 │ 引导", () => {
  const lines = renderAnchoredMessage(
    "thinking",
    ["先看调用方是否依赖内部状态…", "再看边界条件。"],
    40,
    { theme: recordingTheme().theme },
  );

  assert.equal(lines.length, 2);
  assert.ok(lines[0]?.includes("◆"));
  assert.ok(lines[0]?.includes("Thinking"));
  assert.ok(lines[0]?.includes("先看调用方"), "首行应作为摘要");
  assert.ok(lines[1]?.startsWith("│ "), "其余行应以 muted │ 引导");
});

test("折叠态思考（单行）只渲染锚点行", () => {
  const lines = renderAnchoredMessage("thinking", ["正在分析调用链…"], 40, {
    theme: ANSI_THEME,
  });

  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("◆"));
  assert.ok(lines[0]?.includes("正在分析调用链"));
});

test("工具成功/失败/进行中使用对应符号与配色 token", () => {
  const { theme, used } = recordingTheme();

  renderAnchoredMessage("toolSuccess", ["done"], 40, { theme, toolName: "edit" });
  assert.ok(used.includes("success"), "成功锚点应用 success token");

  used.length = 0;
  renderAnchoredMessage("toolError", ["Exit code 1"], 40, { theme, toolName: "bash" });
  assert.ok(used.includes("error"), "失败锚点应用 error token");

  used.length = 0;
  renderAnchoredMessage("toolPending", ["读取 src/index.ts …"], 40, { theme, toolName: "read" });
  assert.ok(used.includes("accent"), "进行中锚点应用 accent token");
});

test("工具锚点带工具名，缺省时回退 tool / bash", () => {
  const tool = renderAnchoredMessage("toolSuccess", ["ok"], 40, { theme: ANSI_THEME });
  assert.ok(tool[0]?.includes("tool"), "缺省工具名应显示 tool");

  const bash = renderAnchoredMessage("bash", ["$ ls"], 40, { theme: ANSI_THEME });
  assert.ok(bash[0]?.includes("bash"), "bash 应显示 bash 名称");
});

test("摘要类消息用 · 弱锚点，整行 muted", () => {
  const { theme, used } = recordingTheme();
  const lines = renderAnchoredMessage("compaction", ["已把前 20 轮对话压缩为要点"], 40, { theme });

  assert.equal(lines.length, 1);
  assert.ok(plain(lines[0]).startsWith("· "));
  assert.ok(used.every((token) => token === "muted"), "摘要类应全部使用 muted token");
});

test("摘要类多行时其余行进 gutter", () => {
  const lines = renderAnchoredMessage("custom", ["来自扩展的消息", "附加详情"], 40, {
    theme: ANSI_THEME,
  });

  assert.equal(lines.length, 2);
  assert.ok(plain(lines[0]).startsWith("· "));
  assert.ok(plain(lines[1]).startsWith("│ "));
});

test("锚点行永不超宽：超长摘要被截断", () => {
  const lines = renderAnchoredMessage("toolSuccess", ["x".repeat(200)], 30, {
    theme: ANSI_THEME,
    toolName: "edit",
  });

  assert.equal(lines.length, 1);
  assert.ok(visibleWidth(lines[0] ?? "") <= 30);
  assert.ok(lines[0]?.includes("edit"), "主体名不应被摘要挤掉");
});

test("图片协议行整块透传，不加 gutter 前缀", () => {
  const kitty = "\x1b_Ga=T,f=100;AAAA\x1b\\";
  const lines = renderAnchoredMessage("toolSuccess", ["before", kitty, "after"], 40, {
    theme: ANSI_THEME,
    toolName: "read",
  });

  assert.ok(lines.includes(kitty), "图片行应原样出现在输出中");
});

test("宽度不足下限时回退为简单截断", () => {
  const lines = renderAnchoredMessage("assistant", ["abcdefghij"], 5, { theme: ANSI_THEME });
  assert.equal(lines.length, 1);
  assert.ok(visibleWidth(lines[0] ?? "") <= 5);
});

test("工具正文为空时锚点行仍保留（符号行承载状态信息）", () => {
  const lines = renderAnchoredMessage("toolSuccess", [], 40, { theme: ANSI_THEME, toolName: "bash" });

  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.includes("✓"));
  assert.ok(lines[0]?.includes("bash"));
});

// ---------------------------------------------------------------------------
// 实机反馈修订（v1.2）：剥背景 / 摘要覆盖 / 首词去重 / UI 提示清理
// ---------------------------------------------------------------------------

test("工具输出行的背景色被剥离，前景保留", () => {
  const bgLine = "\x1b[48;5;22m-rw-r--r-- file.txt\x1b[0m";
  const lines = renderAnchoredMessage("bash", ["$ ls", bgLine], 60, { theme: ANSI_THEME });

  assert.ok(!lines.some((line) => line.includes("48;5;22")), "不应残留背景参数");
  assert.ok(lines.some((line) => line.includes("-rw-r--r-- file.txt")), "文本内容应保留");
});

test("工具锚点摘要里的背景色同样被剥离", () => {
  const titledLine = "\x1b[48;5;22m\x1b[1mread\x1b[22m F:\\Kite\\TERAX.md\x1b[0m";
  const lines = renderAnchoredMessage("toolSuccess", [titledLine], 60, {
    theme: ANSI_THEME,
    toolName: "read",
  });

  assert.ok(!lines[0]?.includes("48;5;22"), "锚点摘要不应带原生背景");
  assert.ok(lines[0]?.includes("TERAX.md"));
});

test("summaryOverride 优先于内容首行（args 提取）", () => {
  const lines = renderAnchoredMessage("toolSuccess", ["原生标题行内容"], 60, {
    theme: ANSI_THEME,
    toolName: "read",
    summaryOverride: "F:\\Kite\\TERAX.md",
  });

  assert.ok(lines[0]?.includes("F:\\Kite\\TERAX.md"));
  assert.ok(!lines[0]?.includes("原生标题行内容"));
});

test("原生首行摘要自动去重与工具名相同的首词", () => {
  const lines = renderAnchoredMessage("toolSuccess", ["read F:\\Kite\\TERAX.md"], 60, {
    theme: ANSI_THEME,
    toolName: "read",
  });

  assert.ok(lines[0]?.includes("F:\\Kite\\TERAX.md"));
  assert.equal((lines[0]?.match(/read/gu) ?? []).length, 1, "read 只应出现一次（主体名），摘要首词已去重");
});

test("原生首行摘要剥掉 (ctrl+o to expand) 提示", () => {
  const lines = renderAnchoredMessage("toolSuccess", ["read resource CLAUDE.md (ctrl+o to expand)"], 80, {
    theme: ANSI_THEME,
    toolName: "read",
  });

  assert.ok(!lines[0]?.includes("ctrl+o"), "UI 提示不应出现在锚点行");
  assert.ok(lines[0]?.includes("CLAUDE.md"));
});

test("多行工具摘要的 UI 提示行进入 gutter 后原文保留", () => {
  const lines = renderAnchoredMessage("bash", ["$ ls -la", "... (46 earlier lines, ctrl+o to expand)", "file"], 60, {
    theme: ANSI_THEME,
    toolName: "bash",
  });

  // 摘要行剥提示；gutter 行是交互提示，原文保留。
  assert.ok(!lines[0]?.includes("ctrl+o"));
  assert.ok(lines.some((line) => line.includes("46 earlier lines")));
});
