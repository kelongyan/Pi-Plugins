import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../src/core/theme.ts";
import {
  buildFrameStatus,
  formatTokens,
  readContextUsage,
  readModelName,
  readThinkingLevel,
  shortenModelName,
} from "../src/features/input-frame/status.ts";

const THEME: ThemeLike = { fg: (_token, text) => text };
const ALL = { showModel: true, showThinking: true, showContext: true };

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

test("thinking 级别为 off 时不展示", () => {
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "high" }), "high");
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "off" }), undefined);
  assert.equal(readThinkingLevel({ getThinkingLevel: () => "" }), undefined);
  assert.equal(readThinkingLevel({}), undefined);
  assert.equal(readThinkingLevel(undefined), undefined);
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
  assert.equal(readContextUsage({ getContextUsage: () => undefined }), undefined);
  assert.equal(readContextUsage({ getContextUsage: () => { throw new Error("boom"); } }), undefined);
  assert.equal(readContextUsage({}), undefined);
});

test("formatTokens 按量级压缩", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(-5), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1200), "1.2k");
  assert.equal(formatTokens(12000), "12k");
  assert.equal(formatTokens(1_500_000), "1.5M");
});

test("buildFrameStatus 组装三段并响应配置开关", () => {
  const ctx = {
    model: { name: "anthropic/claude-x" },
    getThinkingLevel: () => "high",
    getContextUsage: () => ({ tokens: 42000, contextWindow: 200000 }),
  };

  const full = buildFrameStatus({ ctx, theme: THEME, settings: ALL });
  assert.equal(full.model, "claude-x");
  assert.ok(full.thinking?.includes("high"));
  assert.ok(full.context?.includes("21%"), "42000/200000 应为 21%");
  assert.ok(full.context?.includes("200k"));

  const minimal = buildFrameStatus({
    ctx,
    theme: THEME,
    settings: { showModel: false, showThinking: false, showContext: false },
  });
  assert.deepEqual(minimal, {}, "全部关闭时不应产出任何段");
});

test("上下文进度条为固定宽度", () => {
  const ctx = { getContextUsage: () => ({ tokens: 100000, contextWindow: 200000 }) };
  const status = buildFrameStatus({ ctx, theme: THEME, settings: ALL });

  const bar = (status.context ?? "").split(" ")[0] ?? "";
  assert.equal(visibleWidth(bar), 10, "进度条宽度应固定为 10 列");
});

test("无窗口信息时退化为 token 数", () => {
  const ctx = { getContextUsage: () => ({ tokens: 4200 }) };
  const status = buildFrameStatus({ ctx, theme: THEME, settings: ALL });

  assert.equal(status.context, "4.2k");
});

test("缺数据时对应段被隐藏，不留空占位", () => {
  const status = buildFrameStatus({ ctx: {}, theme: THEME, settings: ALL });
  assert.deepEqual(status, {});
});

test("thinking 级别只做语义着色，不含彩虹等装饰", () => {
  const used: string[] = [];
  const theme: ThemeLike = {
    fg(token, text) {
      used.push(token);
      return text;
    },
  };
  const ctx = { getThinkingLevel: () => "xhigh" };
  buildFrameStatus({ ctx, theme, settings: { showModel: false, showThinking: true, showContext: false } });

  assert.ok(used.includes("error"), "xhigh 应用 error token");
  assert.ok(!used.includes("rainbow"), "不应出现彩虹效果");
});

test("minimal / medium 使用缩写标签", () => {
  const ctx = { getThinkingLevel: () => "minimal" };
  const status = buildFrameStatus({ ctx, theme: THEME, settings: { showModel: false, showThinking: true, showContext: false } });
  assert.equal(status.thinking, "min");
});
