import assert from "node:assert/strict";
import test from "node:test";
import { createWrappedRender } from "../src/features/message-frame/patch.ts";
import type { ThemeLike } from "../src/features/message-frame/styles.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };

test("包装后内容被外框包裹，并以 innerWidth = width - 4 调用原始 render", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`content@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME);
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

test("只有思考内容的 assistant 使用 THINK 标签", () => {
  const original = function (this: unknown): string[] {
    return ["thinking..."];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME);
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "hmm" }] } };

  assert.ok(wrapped.call(instance, 40)[0]?.includes("THINK"));
});

test("含正文的 assistant 使用 ASSISTANT 标签", () => {
  const original = function (this: unknown): string[] {
    return ["answer"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME);
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "hi" }] },
  };

  assert.ok(wrapped.call(instance, 40)[0]?.includes("ASSISTANT"));
});

test("折叠状态的思考消息使用紧凑框（三行）", () => {
  const original = function (this: unknown): string[] {
    return ["deep thought", "more detail"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME);
  const instance = {
    hideThinkingBlock: true,
    lastMessage: { content: [{ type: "thinking", thinking: "deep" }] },
  };

  assert.equal(wrapped.call(instance, 40).length, 3);
});

test("工具状态影响标签符号", () => {
  const original = function (this: unknown): string[] {
    return ["done"];
  };
  const wrapped = createWrappedRender("toolPending", original, () => THEME);

  const success = wrapped.call({ isPartial: false, result: {}, toolName: "read" }, 40);
  assert.ok(success[0]?.includes("✓"), "完成态应带 ✓");

  const failed = wrapped.call({ isPartial: false, result: { isError: true }, toolName: "read" }, 40);
  assert.ok(failed[0]?.includes("✗"), "失败态应带 ✗");

  const pending = wrapped.call({ isPartial: true, toolName: "read" }, 40);
  const header = pending[0] ?? "";
  assert.ok(!header.includes("✓") && !header.includes("✗"), "进行中不应带状态符号");
});

test("bash 按 status / exitCode 判定配色，但标签保持 BASH", () => {
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
  const wrapped = createWrappedRender("bash", original, () => theme);

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
    assistantFrame: false,
    userFrame: true,
    thinkingFrame: true,
  }));

  assert.deepEqual(wrapped.call({}, 40), ["raw@40"]);
});

test("关闭 userFrame 时用户消息不画框", () => {
  const original = function (this: unknown, width: number): string[] {
    return [`raw@${width}`];
  };
  const wrapped = createWrappedRender("user", original, () => THEME, () => ({
    assistantFrame: true,
    userFrame: false,
    thinkingFrame: true,
  }));

  assert.deepEqual(wrapped.call({}, 40), ["raw@40"]);
});

test("关闭 userFrame 不影响其它类型", () => {
  const original = function (this: unknown): string[] {
    return ["body"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    assistantFrame: true,
    userFrame: false,
    thinkingFrame: true,
  }));

  assert.ok(wrapped.call({}, 40)[0]?.includes("ASSISTANT"));
});

test("配置在每次 render 时读取，变更立即生效（无需重装补丁）", () => {
  let assistantFrame = true;
  const original = function (this: unknown): string[] {
    return ["body"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    assistantFrame,
    userFrame: true,
    thinkingFrame: true,
  }));

  assert.ok(wrapped.call({}, 40)[0]?.includes("ASSISTANT"), "开启时应画框");

  assistantFrame = false;
  assert.deepEqual(wrapped.call({}, 40), ["body"], "关闭后应立即退回原生渲染");
});

test("关闭 thinkingFrame 时思考内容退回 ASSISTANT 框", () => {
  const original = function (this: unknown): string[] {
    return ["deep thought"];
  };
  const wrapped = createWrappedRender("assistant", original, () => THEME, () => ({
    assistantFrame: true,
    userFrame: true,
    thinkingFrame: false,
  }));
  const instance = { lastMessage: { content: [{ type: "thinking", thinking: "t" }] } };

  const lines = wrapped.call(instance, 40);
  assert.ok(lines[0]?.includes("ASSISTANT"), "不再使用 THINK 标签");
  assert.ok(!lines[0]?.includes("THINK"));
});

