import assert from "node:assert/strict";
import test from "node:test";
import { createWrappedRender } from "../src/features/message-frame/patch.ts";
import type { MessageFrameConfig } from "../src/features/message-frame/patch.ts";
import type { ThemeLike } from "../src/features/message-frame/styles.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };

/** 剥 ANSI 后断言可见文本。 */
const plain = (line: string | undefined): string => (line ?? "").replace(/\x1b\[[0-9;:]*m/g, "");

/** boxed（经典外框）的完整配置：显式声明，避免依赖默认值。 */
const BOXED = (): MessageFrameConfig => ({
  style: "boxed",
  assistantFrame: true,
  userFrame: true,
  thinkingFrame: true,
  assistantAnchor: false,
  bashFrame: false,
  diffHighlight: false,
});

test("包装后内容被外框包裹，并以 innerWidth = width - 4 调用原始 render（boxed）", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`content@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME, BOXED);
  const lines = wrapped.call({}, 40);

  assert.ok(lines[0]?.includes("USER"));
  assert.ok(
    lines.some((line) => line.includes("content@36")),
    "原始 render 应收到减去边框占位后的内宽",
  );
});

test("取主题失败时回退到原始 render 输出", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`raw@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => {
    throw new Error("theme unavailable");
  });

  assert.deepEqual(wrapped.call({}, 40), ["raw@40"]);
});

test("只有思考内容的 assistant 使用 THINK 标签（boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["thinking..."];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, BOXED);
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "hmm" }] } };

  assert.ok(wrapped.call(instance, 40)[0]?.includes("THINK"));
});

test("含正文的 assistant 使用 ASSISTANT 标签（boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["answer"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, BOXED);
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
  };

  assert.ok(wrapped.call(instance, 40)[0]?.includes("ASSISTANT"));
});

test("折叠状态的思考消息使用紧凑框（三行，boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["deep thought", "more detail"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, BOXED);
  const instance = {
    hideThinkingBlock: true,
    lastMessage: { content: [{ type: "thinking", thinking: "deep" }] },
  };

  assert.equal(wrapped.call(instance, 40).length, 3);
});

test("工具状态影响标签符号（boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["done"];
  };
  const wrapped = createWrappedRender("toolPending", original, () => THEME, BOXED);

  const success = wrapped.call({ isPartial: false, result: {}, toolName: "read" }, 40);
  assert.ok(success[0]?.includes("✓"), "完成态应带 ✓");

  const failed = wrapped.call({ isPartial: false, result: { isError: true }, toolName: "read" }, 40);
  assert.ok(failed[0]?.includes("✗"), "失败态应带 ✗");

  const pending = wrapped.call({ isPartial: true, toolName: "read" }, 40);
  const header = pending[0] ?? "";
  assert.ok(!header.includes("✓") && !header.includes("✗"), "进行中不应带状态符号");
});

test("bash 按 status / exitCode 判定配色，但标签保持 BASH（boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["output"];
  };
  const used: string[] = [];
  const theme: ThemeLike = {
    fg(token, text) {
      used.push(token);
      return text;
    },
  };
  const wrapped = createWrappedRender("bash", original, () => theme, BOXED);

  used.length = 0;
  const complete = wrapped.call({ status: "complete" }, 40);
  assert.ok(complete[0]?.includes("BASH"), "bash 标签必须保持 BASH，不能被写成 TOOL");
  assert.ok(!(complete[0] ?? "").includes("✓"), "bash 标签不带状态符号");
  assert.ok(used.includes("success"), "完成态配色应使用 success token");

  used.length = 0;
  wrapped.call({ status: "error" }, 40);
  assert.ok(used.includes("error"), "失败态配色应使用 error token");

  used.length = 0;
  wrapped.call({ exitCode: 0 }, 40);
  assert.ok(used.includes("success"), "exitCode 0 应判定为成功");

  used.length = 0;
  wrapped.call({ exitCode: 1 }, 40);
  assert.ok(used.includes("error"), "非 0 exitCode 应判定为失败");

  used.length = 0;
  wrapped.call({}, 40);
  assert.ok(used.includes("borderAccent"), "无状态信息时应回退 pending 配色");
});

test("宽度不足时直接回退原始输出", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`raw@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME);

  assert.deepEqual(wrapped.call({}, 5), ["raw@5"]);
});

test("内容为空的消息返回空数组（不渲染空白框）", () => {
  const original = function (this: unknown): string[] {
    return [];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME);

  assert.deepEqual(wrapped.call({}, 40), []);
});

test("读取实例字段抛错时不崩溃，走正常渲染路径", () => {
  const original = function (this: unknown): string[] {
    return ["safe"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME);

  const hostile = {
    get lastMessage(): never {
      throw new Error("boom");
    },
  };

  const lines = wrapped.call(hostile, 40);
  assert.ok(lines.some((line) => line.includes("safe")));
});

test("关闭 assistantFrame 时该类型完全交还原生渲染（连宽度都不变）", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`raw@${width}`];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    assistantFrame: false,
  }));

  assert.deepEqual(wrapped.call({}, 40), ["raw@40"]);
});

test("关闭 userFrame 时用户消息不画框", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`raw@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME, () => ({
    ...BOXED(),
    userFrame: false,
  }));

  assert.deepEqual(wrapped.call({}, 40), ["raw@40"]);
});

test("关闭 userFrame 不影响其它类型", () => {
  const original = function (this: unknown): string[] {
    return ["body"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    userFrame: false,
  }));

  assert.ok(wrapped.call({}, 40)[0]?.includes("ASSISTANT"));
});

test("配置在每次 render 时读取，变更立即生效（无需重装补丁）", () => {
  let assistantFrame = true;
  const original = function (this: unknown): string[] {
    return ["body"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    assistantFrame,
  }));

  assert.ok(wrapped.call({}, 40)[0]?.includes("ASSISTANT"), "开启时应画框");

  assistantFrame = false;
  assert.deepEqual(wrapped.call({}, 40), ["body"], "关闭后应立即退回原生渲染");
});

test("关闭 thinkingFrame 时思考内容退回 ASSISTANT 框（boxed）", () => {
  const original = function (this: unknown): string[] {
    return ["deep thought"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    thinkingFrame: false,
  }));
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "t" }] } };

  const lines = wrapped.call(instance, 40);
  assert.ok(lines[0]?.includes("ASSISTANT"), "不再使用 THINK 标签");
  assert.ok(!lines[0]?.includes("THINK"));
});

// ---------------------------------------------------------------------------
// minimal（锚点）分流
// ---------------------------------------------------------------------------

test("用户消息在 minimal 下走蓝色竖线引用块", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`question@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));

  const lines = wrapped.call({}, 40);
  assert.ok(!lines.some((line) => line.includes("╭")), "minimal 下用户消息走蓝色竖线引用块");
  assert.match(plain(lines[0] ?? ""), /^│ question@38$/u, "箭头锚点 + 内宽渲染的正文");
});

test("用户消息在 boxed 风格下仍保留经典外框", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`question@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME, BOXED);

  const lines = wrapped.call({}, 40);
  assert.ok(lines[0]?.includes("╭"), "boxed 风格用户消息保留外框");
  assert.ok(lines[0]?.includes("USER"));
});

test("minimal 下 assistant 默认裸排（不加锚点、不画框）", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`body@${width}`];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));

  assert.deepEqual(wrapped.call({}, 40), ["body@40"]);
});

test("minimal 下 assistantAnchor 开启时正文前加一行 ● 锚点", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`body@${width}`];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
    assistantAnchor: true,
  }));

  const lines = wrapped.call({}, 40);
  assert.equal(lines.length, 2);
  assert.ok(lines[0]?.includes("●"), "锚点行应带 ●");
  assert.equal(lines[1], "body@40", "正文应原样保留");
});

test("minimal 下思考只有内容变成 ◆ Thinking 锚点行", () => {
  const original = function (this: unknown): string[] {
    return ["pondering the chain"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "deep" }] } };

  const lines = wrapped.call(instance, 40);
  assert.equal(lines.length, 1, "单行思考应只有锚点行");
  assert.ok(lines[0]?.includes("◆"), "应使用 ◆ 符号");
  assert.ok(lines[0]?.includes("Thinking"), "应带 Thinking 名称");
  assert.ok(lines[0]?.includes("pondering the chain"), "内容首行应作为摘要");
});

test("minimal 下多行思考的首行进摘要、其余行进 gutter", () => {
  const original = function (this: unknown): string[] {
    return ["first line", "second line", "third line"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "deep" }] } };

  const lines = wrapped.call(instance, 40);
  assert.equal(lines.length, 3, "锚点行 + 2 行 gutter");
  assert.ok(lines[0]?.includes("first line"));
  assert.ok(lines[1]?.startsWith("│"), "细节行应以 │ 引导");
  assert.ok(lines[2]?.startsWith("│"));
});

test("minimal 下工具成功锚点带 ✓ 与工具名", () => {
  const original = function (this: unknown): string[] {
    return ["done quickly"];
  };
  const wrapped = createWrappedRender("toolPending", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { isPartial: false, result: {}, toolName: "read" };

  const lines = wrapped.call(instance, 40);
  assert.ok(lines[0]?.includes("✓"), "成功态应带 ✓");
  assert.ok(lines[0]?.includes("read"), "应显示工具名");
  assert.ok(!lines.some((line) => line.includes("╭")), "minimal 不应有外框");
});

test("minimal 下 bash 走锚点，bashFrame 开启时回到经典外框", () => {
  const original = function (this: unknown): string[] {
    return ["$ pnpm test", "✓ 78 passed"];
  };

  const anchored = createWrappedRender("bash", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const anchoredLines = anchored.call({ status: "complete" }, 40);
  assert.ok(anchoredLines[0]?.includes("✓"), "bash 默认走锚点");
  assert.ok(!anchoredLines.some((line) => line.includes("╭")));

  const boxed = createWrappedRender("bash", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
    bashFrame: true,
  }));
  const boxedLines = boxed.call({ status: "complete" }, 40);
  assert.ok(boxedLines[0]?.includes("╭"), "bashFrame 开启时应恢复经典外框");
  assert.ok(boxedLines[0]?.includes("BASH"));
});

// ---------------------------------------------------------------------------
// 实机反馈修订（v1.2）：args 摘要 / 混合消息思考锚点
// ---------------------------------------------------------------------------

test("minimal 下工具摘要优先取自 args（file_path / command）", () => {
  const original = function (this: unknown): string[] {
    return ["read F:\\Kite\\TERAX.md (ctrl+o to expand)"];
  };
  const wrapped = createWrappedRender("toolPending", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { isPartial: false, result: {}, toolName: "read", args: { file_path: "F:\\Kite\\TERAX.md" } };

  const lines = wrapped.call(instance, 60);
  assert.ok(lines[0]?.includes("F:\\Kite\\TERAX.md"), "摘要应来自 args");
  assert.ok(!lines[0]?.includes("ctrl+o"), "原生首行不应成为摘要");
  assert.ok(!lines[0]?.includes("F:\\\\Kite"), "原生首行的重复路径不应出现");
});

test("minimal 下 bash 摘要取 command 字段，不带 $", () => {
  const original = function (this: unknown): string[] {
    return ["$ ls -la F:\\Kite"];
  };
  const wrapped = createWrappedRender("bash", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { status: "complete", args: { command: "ls -la F:\\Kite" } };

  const lines = wrapped.call(instance, 60);
  assert.ok(lines[0]?.includes("ls -la F:\\Kite"));
  assert.ok(!lines[0]?.includes("$"), "command 摘要不应带 $ 前缀");
});

test("args 摘要解析失败时回退原生首行（流式期间 args 不完整）", () => {
  const original = function (this: unknown): string[] {
    return ["原生标题 fallback"];
  };
  const wrapped = createWrappedRender("toolPending", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = { isPartial: true, toolName: "read", args: undefined };

  const lines = wrapped.call(instance, 60);
  assert.ok(lines[0]?.includes("fallback"), "应回退原生首行");
});

test("minimal 下混合消息（思考+正文）分段：思考组带 ◆ Thinking 锚点", () => {
  const original = function (this: unknown): string[] {
    return ["整条原生渲染（不会走到）"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = {
    lastMessage: {
      content: [
        { type: "thinking", thinking: "Let me read the files." },
        { type: "text", text: "我来学习你的项目。" },
      ],
    },
    // 与 Pi 的 updateContent 结构一致：块之间有 spacer 子组件。
    contentContainer: {
      children: [
        { render: () => [] },
        { render: () => ["The user wants me to learn…", "Let me start by reading."] },
        { render: () => [] },
        { render: () => ["我来学习你的项目。先读取核心文档和结构。"] },
      ],
    },
  };

  const lines = wrapped.call(instance, 60);
  assert.ok(lines[0]?.includes("◆"), "思考组应以 ◆ 锚点开头");
  assert.ok(lines[0]?.includes("Thinking"));
  assert.ok(lines.some((line) => line.includes("The user wants me to learn…")), "思考内容保持原生渲染");
  assert.ok(lines.some((line) => line.includes("我来学习你的项目")), "正文裸排");
  assert.ok(!lines.some((line) => line.includes("╭")), "minimal 无外框");
});

test("minimal 混合消息折叠态：吞掉原生 Thinking… 占位行，只留锚点", () => {
  const original = function (this: unknown): string[] {
    return ["ignored"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = {
    hideThinkingBlock: true,
    lastMessage: {
      content: [
        { type: "thinking", thinking: "deep" },
        { type: "text", text: "正文" },
      ],
    },
    contentContainer: {
      children: [{ render: () => [] }, { render: () => ["Thinking..."] }, { render: () => [] }, { render: () => ["正文"] }],
    },
  };

  const lines = wrapped.call(instance, 60);
  const thinkingLines = lines.filter((line) => line.includes("Thinking"));
  assert.equal(thinkingLines.length, 1, "折叠态应只有锚点行带 Thinking");
});

test("minimal 混合消息结构不匹配时回退裸排（安全网）", () => {
  const original = function (this: unknown): string[] {
    return ["raw body"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    ...BOXED(),
    style: "minimal",
  }));
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "x" }] },
    contentContainer: { children: [{ render: () => ["x"] }] }, // 子组件数量与推导不符
  };

  assert.deepEqual(wrapped.call(instance, 60), ["raw body"]);
});
