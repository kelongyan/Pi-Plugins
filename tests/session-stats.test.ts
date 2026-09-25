import assert from "node:assert/strict";
import test from "node:test";
import {
  StreamSpeedTracker,
  formatCost,
  formatSpeed,
  readSessionCost,
  readSessionTokens,
} from "../src/features/input-frame/session-stats.ts";

test("readSessionCost 累加 usage.cost.total", () => {
  const ctx = {
    sessionManager: {
      getBranch: () => [
        { message: { usage: { cost: { total: 0.12 } } } },
        { message: { usage: { cost: { total: 0.03 } } } },
        { message: {} },
      ],
    },
  };

  const cost = readSessionCost(ctx);
  assert.ok(cost !== undefined);
  assert.ok(Math.abs(cost - 0.15) < 1e-9);
});

test("readSessionCost 全程防御性读取", () => {
  assert.equal(readSessionCost(undefined), undefined);
  assert.equal(readSessionCost({}), undefined);
  assert.equal(readSessionCost({ sessionManager: {} }), undefined);
  assert.equal(readSessionCost({ sessionManager: { getBranch: () => null } }), undefined);
  assert.equal(
    readSessionCost({ sessionManager: { getBranch: () => [] } }),
    undefined,
    "完全没有 cost 字段时不给值（避免显示 $0.00 误导）",
  );
  assert.equal(
    readSessionCost({
      sessionManager: {
        getBranch: () => {
          throw new Error("stale");
        },
      },
    }),
    undefined,
  );
});

test("formatCost 分级精度", () => {
  assert.equal(formatCost(0), "$0.00");
  assert.equal(formatCost(0.0012), "$0.0012", "极小额用 4 位小数，避免一直是 $0.00");
  assert.equal(formatCost(1.234), "$1.23");
  assert.equal(formatCost(-1), undefined);
  assert.equal(formatCost(undefined), undefined);
});

test("formatSpeed", () => {
  assert.equal(formatSpeed(18.44), "18.4 tps");
  assert.equal(formatSpeed(0), undefined);
  assert.equal(formatSpeed(undefined), undefined);
});

test("StreamSpeedTracker 初始无值", () => {
  assert.equal(new StreamSpeedTracker().tokensPerSecond, undefined);
});

test("采样窗口过短时不给值（避免噪声）", () => {
  const tracker = new StreamSpeedTracker();
  tracker.onStream({ output: 100 });

  // 刚启动，耗时远小于 0.5s
  assert.equal(tracker.tokensPerSecond, undefined);
});

test("reset 后回到初始状态", () => {
  const tracker = new StreamSpeedTracker();
  tracker.onStream({ output: 100 });
  tracker.onIdle();
  tracker.reset();

  assert.equal(tracker.tokensPerSecond, undefined);
});

test("onStream 忽略非法 usage", () => {
  const tracker = new StreamSpeedTracker();
  tracker.onStream(undefined);
  tracker.onStream({ output: "not-a-number" });
  tracker.onStream({ output: -5 });

  assert.doesNotThrow(() => tracker.onIdle());
  assert.equal(tracker.tokensPerSecond, undefined);
});

test("readSessionTokens 累加 input 与 output", () => {
  const ctx = {
    sessionManager: {
      getBranch: () => [
        { message: { usage: { input: 1200, output: 340 } } },
        { message: { usage: { input: 800, output: 160 } } },
      ],
    },
  };

  assert.deepEqual(readSessionTokens(ctx), { input: 2000, output: 500 });
});

test("readSessionTokens 忽略 cache 字段（只算 input + output）", () => {
  const ctx = {
    sessionManager: {
      getBranch: () => [{ message: { usage: { input: 100, output: 50, cacheRead: 9999, cacheWrite: 8888 } } }],
    },
  };

  assert.deepEqual(readSessionTokens(ctx), { input: 100, output: 50 });
});

test("readSessionTokens 全程防御性读取", () => {
  assert.equal(readSessionTokens(undefined), undefined);
  assert.equal(readSessionTokens({}), undefined);
  assert.equal(readSessionTokens({ sessionManager: {} }), undefined);
  assert.equal(readSessionTokens({ sessionManager: { getBranch: () => [] } }), undefined);
  assert.equal(
    readSessionTokens({ sessionManager: { getBranch: () => [{ message: {} }] } }),
    undefined,
    "完全没有 usage 时不给值",
  );
  assert.equal(
    readSessionTokens({
      sessionManager: {
        getBranch: () => {
          throw new Error("stale");
        },
      },
    }),
    undefined,
  );
});
