import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../src/core/theme.ts";
import { resetGitBranchCache } from "../src/features/input-frame/git-status.ts";
import {
  buildFrameStatus,
  formatTokens,
  readContextUsage,
  readCwd,
  readModelName,
  readThinkingLevel,
  shortenModelName,
  shortenPath,
} from "../src/features/input-frame/status.ts";
import type { FrameSegment } from "../src/features/input-frame/segments.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };
const ALL = {
  showModel: true,
  showThinking: true,
  showPath: true,
  showGit: true,
  showContext: true,
};
const NONE = {
  showModel: false,
  showThinking: false,
  showPath: false,
  showGit: false,
  showContext: false,
};

function idsOf(segments: readonly FrameSegment[]): string[] {
  return segments.map((segment) => segment.id);
}

function textOf(segments: readonly FrameSegment[]): string {
  return segments.map((segment) => segment.text).join(" | ");
}

test("模型名压缩掉 provider 前缀", () => {
  assert.equal(shortenModelName("anthropic/claude-sonnet"), "claude-sonnet");
  assert.equal(shortenModelName("openai:gpt-5"), "gpt-5");
  assert.equal(shortenModelName("plain-model"), "plain-model");
  assert.equal(shortenModelName("  spaced  "), "spaced");
});

test("readModelName 全程防御性读取", () => {
  assert.equal(readModelName({ model: { id: "a/b" } }), "b");
  assert.equal(readModelName({ model: { name: "n" } }), "n");
  assert.equal(readModelName({ model: {} }), undefined);
  assert.equal(readModelName({}), undefined);
  assert.equal(readModelName(undefined), undefined);
  assert.equal(
    readModelName({
      get model(): never {
        throw new Error("stale ctx");
      },
    }),
    undefined,
  );
});

test("readCwd 只接受非空字符串", () => {
  assert.equal(readCwd({ cwd: "/tmp/x" }), "/tmp/x");
  assert.equal(readCwd({ cwd: "" }), undefined);
  assert.equal(readCwd({}), undefined);
  assert.equal(readCwd(undefined), undefined);
  assert.equal(
    readCwd({
      get cwd(): never {
        throw new Error("stale");
      },
    }),
    undefined,
  );
});

test("shortenPath 家目录缩写并保留尾部", () => {
  // 短路径原样返回
  assert.equal(shortenPath("/a/b", 40), "/a/b");

  // 超长路径只保留尾部两级
  const long = "/very/deeply/nested/project/sub/dir";
  const shortened = shortenPath(long, 16);
  assert.ok(shortened.startsWith("…/"), "超长路径应以 … 开头");
  assert.ok(shortened.endsWith("sub/dir"), "应保留尾部两级");
  assert.ok(shortened.length <= long.length);
});

test("thinking 级别为 off 时不展示", () => {
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "high" }), "high");
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "off" }), undefined);
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "" }), undefined);
  assert.equal(readThinkingLevel({}), undefined);
});

test("上下文用量读取与容错", () => {
  assert.deepEqual(readContextUsage({ getContextUsage: () => ({ tokens: 1000, contextWindow: 200000 }) }), {
    tokens: 1000,
    contextWindow: 200000,
  });
  assert.deepEqual(readContextUsage({ getContextUsage: () => ({ tokens: 100 }) }), {
    tokens: 100,
    contextWindow: undefined,
  });
  assert.equal(readContextUsage({ getContextUsage: () => ({}) }), undefined, "缺 tokens 视为无效");
  assert.equal(readContextUsage({}), undefined);
});

test("formatTokens 按量级压缩", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1200), "1.2k");
  assert.equal(formatTokens(12000), "12k");
  assert.equal(formatTokens(1_500_000), "1.5M");
});

test("buildFrameStatus 按顺序组装段并响应配置开关", () => {
  const ctx = {
    model: { name: "anthropic/claude-x" },
    cwd: "/tmp/proj",
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 42000, contextWindow: 200000 }),
  };

  const full = buildFrameStatus({ ctx, theme: THEME, settings: ALL });
  // git 段依赖异步查询，首次同步调用必定拿不到，因此这里不出现
  assert.deepEqual(idsOf(full.segments), ["model", "thinking", "path", "context"]);

  const text = textOf(full.segments);
  assert.ok(text.includes("claude-x"));
  assert.ok(text.includes("high"));
  assert.ok(text.includes("proj"), "路径段应出现在顶边");
  assert.ok(text.includes("21%"), "42000/200000 应为 21%");
  assert.ok(text.includes("200k"));
});

test("全部关闭时不产出任何段", () => {
  const ctx = {
    model: { name: "m" },
    cwd: "/tmp",
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 1, contextWindow: 100 }),
  };
  const status = buildFrameStatus({ ctx, theme: THEME, settings: NONE });
  assert.deepEqual(status.segments, []);
});

test("只开路径段时其它段不出现", () => {
  const ctx = {
    model: { name: "m" },
    cwd: "/tmp/proj",
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 1, contextWindow: 100 }),
  };
  const status = buildFrameStatus({
    ctx,
    theme: THEME,
    settings: { ...NONE, showPath: true },
  });
  assert.deepEqual(idsOf(status.segments), ["path"]);
});

test("缺数据时对应段被跳过，不留空占位", () => {
  const status = buildFrameStatus({ ctx: {}, theme: THEME, settings: ALL });
  assert.deepEqual(status.segments, []);
});

test("上下文进度条为固定宽度", () => {
  const ctx = { getContextUsage: () => ({ tokens: 100000, contextWindow: 200000 }) };
  const status = buildFrameStatus({
    ctx,
    theme: THEME,
    settings: { ...NONE, showContext: true },
  });

  const bar = (status.segments[0]?.text ?? "").split(" ")[0] ?? "";
  assert.equal(visibleWidth(bar), 10, "进度条宽度应固定为 10 列");
});

test("无窗口信息时上下文退化为 token 数", () => {
  const ctx = { getContextUsage: () => ({ tokens: 4200 }) };
  const status = buildFrameStatus({
    ctx,
    theme: THEME,
    settings: { ...NONE, showContext: true },
  });
  assert.equal(status.segments[0]?.text, "4.2k");
});

test("thinking 级别只做语义着色，不含彩虹等装饰", () => {
  const used: string[] = [];
  const theme: ThemeLike = {
    fg(token, text) {
      used.push(token);
      return text;
    },
  };
  buildFrameStatus({
    ctx: { getThinkingLevel: () => "xhigh" },
    theme,
    settings: { ...NONE, showThinking: true },
  });

  assert.ok(used.includes("error"), "xhigh 应用 error token");
  assert.ok(!used.includes("rainbow"));
});

test("minimal 使用缩写标签", () => {
  const status = buildFrameStatus({
    ctx: { getThinkingLevel: () => "minimal" },
    theme: THEME,
    settings: { ...NONE, showThinking: true },
  });
  assert.equal(status.segments[0]?.text, "min");
});

test("git 段首次同步读取必定拿不到（异步数据不阻塞渲染）", () => {
  resetGitBranchCache();
  const status = buildFrameStatus({
    ctx: { cwd: process.cwd() },
    theme: THEME,
    settings: { ...NONE, showGit: true },
  });
  assert.deepEqual(status.segments, [], "后台查询未完成前不应产出 git 段");
});
