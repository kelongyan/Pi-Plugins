import assert from "node:assert/strict";
import test from "node:test";
import { stripBackgroundSgr, stripUiHints } from "../src/utils/sgr.ts";

test("stripBackgroundSgr 剥标准背景，保留前景与其他属性", () => {
  assert.equal(stripBackgroundSgr("\x1b[41m红底\x1b[0m"), "红底\x1b[0m");
  assert.equal(stripBackgroundSgr("\x1b[1;42m粗体绿底\x1b[0m"), "\x1b[1m粗体绿底\x1b[0m");
  assert.equal(stripBackgroundSgr("\x1b[103m亮黄底\x1b[0m"), "亮黄底\x1b[0m");
  assert.equal(stripBackgroundSgr("\x1b[49m恢复默认底\x1b[0m"), "恢复默认底\x1b[0m");
});

test("stripBackgroundSgr 剥扩展背景（256 色 / RGB），保留扩展前景", () => {
  assert.equal(stripBackgroundSgr("\x1b[38;5;10;48;5;20m文本\x1b[0m"), "\x1b[38;5;10m文本\x1b[0m");
  assert.equal(stripBackgroundSgr("\x1b[48;2;10;20;30m纯背景\x1b[0m"), "纯背景\x1b[0m");
  assert.equal(
    stripBackgroundSgr("\x1b[38;2;200;100;50;48;2;1;2;3m彩色前景\x1b[0m"),
    "\x1b[38;2;200;100;50m彩色前景\x1b[0m",
  );
});

test("stripBackgroundSgr 序列全部为背景时整条删除", () => {
  assert.equal(stripBackgroundSgr("\x1b[44m蓝底\x1b[0m"), "蓝底\x1b[0m");
  assert.equal(stripBackgroundSgr("\x1b[4;44m下划线蓝底\x1b[0m"), "\x1b[4m下划线蓝底\x1b[0m");
});

test("stripBackgroundSgr 不动非 SGR 序列与普通文本", () => {
  assert.equal(stripBackgroundSgr("纯文本"), "纯文本");
  assert.equal(stripBackgroundSgr("\x1b]0;标题\x07文本"), "\x1b]0;标题\x07文本");
  assert.equal(stripBackgroundSgr("\x1b[2J清屏\x1b[0m"), "\x1b[2J清屏\x1b[0m");
  assert.equal(stripBackgroundSgr(""), "");
});

test("stripBackgroundSgr 处理 reset 序列与空参数", () => {
  assert.equal(stripBackgroundSgr("\x1b[m重置"), "\x1b[m重置");
  assert.equal(stripBackgroundSgr("\x1b[0m重置"), "\x1b[0m重置");
});

test("stripUiHints 剥展开提示与行数提示", () => {
  assert.equal(stripUiHints("read resource CLAUDE.md (ctrl+o to expand)"), "read resource CLAUDE.md");
  assert.equal(stripUiHints("... (46 earlier lines, ctrl+o to expand)"), "...");
  assert.equal(stripUiHints("output (12 more lines, ctrl+o to expand)"), "output");
  assert.equal(stripUiHints("普通 (100 words) 文本"), "普通 (100 words) 文本");
});

test("stripUiHints 保留含 to expand 的正常内容语义不受额外空格影响", () => {
  assert.equal(stripUiHints("  a  (ctrl+o to expand)  b  "), "a b");
});
