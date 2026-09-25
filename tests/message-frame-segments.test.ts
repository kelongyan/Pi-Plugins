import assert from "node:assert/strict";
import test from "node:test";
import type { ThemeLike } from "../src/core/theme.ts";
import {
  applyZoneMarkers,
  expectedSegmentKinds,
  groupContentChildren,
  renderAssistantSegments,
} from "../src/features/message-frame/segments.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };

/** 伪造一个可渲染的子组件。 */
function fakeChild(lines: string[]): { render: (width: number) => string[] } {
  return { render: (_width: number) => lines };
}

test("expectedSegmentKinds 推导出与 Pi 一致的子组件类型序列", () => {
  // 思考 + 正文：块之间会插入 Spacer
  assert.deepEqual(
    expectedSegmentKinds({ content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }] }),
    ["spacer", "thinking", "spacer", "text"],
  );

  assert.deepEqual(expectedSegmentKinds({ content: [{ type: "text", text: "a" }] }), ["spacer", "text"]);
  assert.deepEqual(expectedSegmentKinds({ content: [{ type: "thinking", thinking: "t" }] }), ["spacer", "thinking"]);
  assert.deepEqual(expectedSegmentKinds({ content: [] }), []);
  assert.deepEqual(expectedSegmentKinds({}), []);
  assert.deepEqual(expectedSegmentKinds(undefined), []);
});

test("toolCall 块不产生子组件，不影响序列", () => {
  assert.deepEqual(
    expectedSegmentKinds({ content: [{ type: "text", text: "a" }, { type: "toolCall" }] }),
    ["spacer", "text"],
  );
});

test("空白的 text / thinking 块被忽略", () => {
  assert.deepEqual(
    expectedSegmentKinds({ content: [{ type: "text", text: "   " }, { type: "text", text: "a" }] }),
    ["spacer", "text"],
  );
});

test("groupContentChildren 按类型分组，连续同类合并", () => {
  const spacer = fakeChild([""]);
  const thinking = fakeChild(["think"]);
  const text = fakeChild(["body"]);

  const groups = groupContentChildren(
    [spacer, thinking, spacer, text],
    ["spacer", "thinking", "spacer", "text"],
  );

  assert.ok(groups);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.kind, "thinking");
  assert.equal(groups[1]?.kind, "text");
  assert.equal(groups[0]?.children.length, 1);
});

test("groupContentChildren 在长度不匹配时返回 null", () => {
  assert.equal(groupContentChildren([fakeChild([""])], ["spacer", "text"]), null);
  assert.equal(groupContentChildren(undefined, ["spacer"]), null);
  assert.equal(groupContentChildren("not-an-array", ["spacer"]), null);
});

test("renderAssistantSegments 把思考与正文拆成两个独立的框", () => {
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }] },
    contentContainer: {
      children: [fakeChild([""]), fakeChild(["思考内容"]), fakeChild([""]), fakeChild(["正文内容"])],
    },
  };

  const lines = renderAssistantSegments(instance, 40, THEME);
  assert.ok(lines, "应产出分段渲染结果");

  const topBorders = lines.filter((line) => line.includes("╭"));
  assert.equal(topBorders.length, 2, "应有两个独立的顶边框");

  const joined = lines.join("\n");
  assert.ok(joined.includes("THINK"));
  assert.ok(joined.includes("ASSISTANT"));
  assert.ok(joined.includes("思考内容"));
  assert.ok(joined.includes("正文内容"));
});

test("两段之间插入空行做视觉分隔", () => {
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }] },
    contentContainer: {
      children: [fakeChild([""]), fakeChild(["t"]), fakeChild([""]), fakeChild(["a"])],
    },
  };

  const lines = renderAssistantSegments(instance, 40, THEME) ?? [];
  assert.ok(lines.includes(""), "段与段之间应有一个空行");
});

test("只有一组时不拆分（交给单框路径，保持原有标签行为）", () => {
  const textOnly = {
    lastMessage: { content: [{ type: "text", text: "a" }] },
    contentContainer: { children: [fakeChild([""]), fakeChild(["正文"])] },
  };
  assert.equal(renderAssistantSegments(textOnly, 40, THEME), undefined);

  const thinkingOnly = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }] },
    contentContainer: { children: [fakeChild([""]), fakeChild(["思考"])] },
  };
  assert.equal(renderAssistantSegments(thinkingOnly, 40, THEME), undefined);
});

test("子组件与推导序列不匹配时返回 undefined（触发回退）", () => {
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }] },
    contentContainer: { children: [] },
  };
  assert.equal(renderAssistantSegments(instance, 40, THEME), undefined);
});

test("缺少 contentContainer 或 lastMessage 时不崩溃", () => {
  assert.equal(renderAssistantSegments({}, 40, THEME), undefined);
  assert.equal(renderAssistantSegments({ lastMessage: { content: [{ type: "text", text: "a" }] } }, 40, THEME), undefined);
  assert.equal(renderAssistantSegments(undefined, 40, THEME), undefined);
});

test("子组件 render 抛错时整体回退，不向外抛异常", () => {
  const exploding = {
    render(): never {
      throw new Error("boom");
    },
  };
  const instance = {
    lastMessage: { content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }] },
    contentContainer: { children: [fakeChild([""]), exploding, fakeChild([""]), fakeChild(["a"])] },
  };

  assert.equal(renderAssistantSegments(instance, 40, THEME), undefined);
});

test("applyZoneMarkers 在首末行加 OSC133 标记", () => {
  const marked = applyZoneMarkers(["a", "b"], false);
  assert.ok(marked[0]?.startsWith("\x1b]133;A\x07"));
  assert.ok(marked[1]?.includes("\x1b]133;B\x07"));
  assert.ok(marked[1]?.includes("\x1b]133;C\x07"));
});

test("applyZoneMarkers 在有工具调用或空行时不加标记", () => {
  const lines = ["a", "b"];
  assert.deepEqual(applyZoneMarkers(lines, true), lines);
  assert.deepEqual(applyZoneMarkers([], false), []);
});
