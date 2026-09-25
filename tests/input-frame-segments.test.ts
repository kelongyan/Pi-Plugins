import assert from "node:assert/strict";
import test from "node:test";
import { SEGMENT_SEPARATOR, composeSegments, type FrameSegment } from "../src/features/input-frame/segments.ts";

function seg(id: FrameSegment["id"], text: string): FrameSegment {
  return { id, text };
}

test("全部装得下时按顺序拼接", () => {
  const result = composeSegments([seg("model", "m"), seg("git", "main")], 40);

  assert.equal(result.text, `m${SEGMENT_SEPARATOR}main`);
  assert.deepEqual(result.dropped, []);
});

test("宽度不足时从末尾整段丢弃", () => {
  const result = composeSegments([seg("model", "model-name"), seg("path", "~/a/b"), seg("git", "main")], 14);

  assert.equal(result.text, "model-name", "只剩装得下的最高优先级段");
  assert.deepEqual(result.dropped, ["git", "path"], "按丢弃先后顺序记录");
});

test("持续丢弃直到能装下", () => {
  const result = composeSegments(
    [seg("model", "aaa"), seg("thinking", "bbb"), seg("path", "ccc"), seg("git", "ddd")],
    10,
  );

  assert.deepEqual(result.dropped, ["git", "path"]);
  assert.equal(result.text, `aaa${SEGMENT_SEPARATOR}bbb`);
});

test("空文本的段被忽略，不产生多余分隔符", () => {
  const result = composeSegments([seg("model", "m"), seg("thinking", ""), seg("path", "~/p")], 40);

  assert.equal(result.text, `m${SEGMENT_SEPARATOR}~/p`);
});

test("预算为 0 时全部丢弃", () => {
  const result = composeSegments([seg("model", "m")], 0);

  assert.equal(result.text, "");
  assert.equal(result.width, 0);
  assert.deepEqual(result.dropped, ["model"]);
});

test("返回的宽度是显示宽度，ANSI 不计入", () => {
  const colored = "\x1b[38;2;1;2;3mmodel\x1b[39m";
  const result = composeSegments([seg("model", colored)], 40);

  assert.equal(result.width, 5);
});

test("段内的文字不会被截断，只整段丢弃", () => {
  const result = composeSegments([seg("model", "a-very-long-model-name")], 5);

  assert.equal(result.text, "", "装不下就整段丢，而不是截一半");
  assert.deepEqual(result.dropped, ["model"]);
});
