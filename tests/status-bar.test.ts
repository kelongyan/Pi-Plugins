import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../src/core/theme.ts";
import { resetGitBranchCache } from "../src/features/input-frame/git-status.ts";
import {
  STATUS_SEPARATOR,
  buildStatusBarSegments,
  composeStatusBar,
  segmentIcon,
  type StatusBarSegment,
} from "../src/features/input-frame/status-bar.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };
const ALL = { model: true, path: true, git: true, context: true, tokens: true, speed: true };
const NONE = { model: false, path: false, git: false, context: false, tokens: false, speed: false };

function seg(id: StatusBarSegment["id"], text: string): StatusBarSegment {
  return { id, text };
}

test("装得下时保留全部段，且以前导空格开头", () => {
  const line = composeStatusBar([seg("model", "m"), seg("path", "p")], 60);

  assert.ok(line.startsWith(" "), "应与输入框左边框空开一格");
  assert.ok(line.includes(STATUS_SEPARATOR.trim()), "段之间应有分隔符");
  assert.ok(visibleWidth(line) <= 60);
});

test("宽度不足时从尾部整段丢弃", () => {
  // " model │ path │ git " 需要 19 列；给 16 列时最靠后的 git 段应被丢弃。
  const line = composeStatusBar([seg("model", "model"), seg("path", "path"), seg("git", "git")], 16);

  assert.ok(line.includes("model"), "靠前的段应保留");
  assert.ok(line.includes("path"));
  assert.ok(!line.includes("git"), "最靠后的段应被丢弃");
  assert.ok(visibleWidth(line) <= 16);
});

test("全部装不下时返回空串（调用方据此不输出该行）", () => {
  assert.equal(composeStatusBar([seg("model", "a-very-long-model-name")], 3), "");
});

test("空文本的段被忽略，不产生多余分隔符", () => {
  const line = composeStatusBar([seg("model", "m"), seg("path", ""), seg("git", "g")], 60);

  assert.ok(line.includes("m"));
  assert.ok(line.includes("g"));
  assert.equal(line.split(STATUS_SEPARATOR).length, 2, "应只有一个分隔符");
});

test("segmentIcon 按风格返回对应图标", () => {
  assert.equal(segmentIcon("model", "emoji"), "🎨");
  assert.equal(segmentIcon("model", "plain"), "model");
  assert.notEqual(segmentIcon("git", "emoji"), segmentIcon("git", "plain"));
});

test("buildStatusBarSegments 按配置组装各段", () => {
  const ctx = {
    model: { name: "anthropic/claude-x" },
    cwd: "/tmp/proj",
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 42000, contextWindow: 200000 }),
  };

  const segments = buildStatusBarSegments({
    ctx,
    theme: THEME,
    icons: "plain",
    settings: ALL,
    tokensPerSecond: 18.4,
  });

  const ids = segments.map((item) => item.id);
  assert.ok(ids.includes("model"));
  assert.ok(ids.includes("path"));
  assert.ok(ids.includes("context"));
  assert.ok(ids.includes("speed"));

  const text = segments.map((item) => item.text).join(" | ");
  assert.ok(text.includes("claude-x(high)"), "模型段应带 thinking 级别");
  assert.ok(text.includes("proj"), "目录段应显示 basename");
  assert.ok(text.includes("21.0%"), "42000/200000 应为 21.0%");
  assert.ok(text.includes("18.4 tps"));
});

test("全部段关闭时不产出任何段", () => {
  const ctx = {
    model: { name: "m" },
    cwd: "/tmp",
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 1, contextWindow: 100 }),
  };
  const segments = buildStatusBarSegments({ ctx, theme: THEME, icons: "plain", settings: NONE });

  assert.deepEqual(segments, []);
});

test("git 段首次同步调用拿不到（异步查询不阻塞渲染）", () => {
  resetGitBranchCache();
  const segments = buildStatusBarSegments({
    ctx: { cwd: process.cwd() },
    theme: THEME,
    icons: "plain",
    settings: { ...NONE, git: true },
  });

  assert.deepEqual(segments, [], "后台查询未完成前不应产出 git 段");
});

test("缺数据时对应段被跳过，不留空占位", () => {
  const segments = buildStatusBarSegments({ ctx: {}, theme: THEME, icons: "plain", settings: ALL });

  assert.deepEqual(segments, []);
});

test("上下文高占用时使用 error 色", () => {
  const used: string[] = [];
  const theme: ThemeLike = {
    fg(token, text) {
      used.push(token);
      return text;
    },
  };

  buildStatusBarSegments({
    ctx: { getContextUsage: () => ({ tokens: 950, contextWindow: 1000 }) },
    theme,
    icons: "plain",
    settings: { ...NONE, context: true },
  });

  assert.ok(used.includes("error"), "95% 应使用 error 色");
});

test("无窗口信息时上下文段显示问号而非崩溃", () => {
  const segments = buildStatusBarSegments({
    ctx: { getContextUsage: () => ({ tokens: 4200 }) },
    theme: THEME,
    icons: "plain",
    settings: { ...NONE, context: true },
  });

  assert.equal(segments.length, 1);
  assert.ok(segments[0]?.text.includes("?"));
  assert.ok(segments[0]?.text.includes("4.2k"));
});

test("token 段显示本会话累计（输入 + 输出）", () => {
  const ctx = {
    sessionManager: { getBranch: () => [{ message: { usage: { input: 3400, output: 1200 } } }] },
  };
  const segments = buildStatusBarSegments({
    ctx,
    theme: THEME,
    icons: "plain",
    settings: { ...NONE, tokens: true },
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.id, "tokens");
  assert.ok(segments[0]?.text.includes("4.6k"), "3400 + 1200 = 4.6k");
});

test("token 为 0 时不显示该段（避免新会话就占位）", () => {
  const ctx = {
    sessionManager: { getBranch: () => [{ message: { usage: { input: 0, output: 0 } } }] },
  };
  const segments = buildStatusBarSegments({
    ctx,
    theme: THEME,
    icons: "plain",
    settings: { ...NONE, tokens: true },
  });

  assert.deepEqual(segments, []);
});

test("token 段图标按风格返回", () => {
  assert.equal(segmentIcon("tokens", "emoji"), "Σ");
  assert.equal(segmentIcon("tokens", "plain"), "tok");
});
