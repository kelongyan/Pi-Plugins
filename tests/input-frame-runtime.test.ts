import assert from "node:assert/strict";
import test from "node:test";
import { InputFrameRuntime } from "../src/features/input-frame/runtime.ts";

const SETTINGS = { enabled: true, showModel: true, showThinking: true, showContext: true };

/** 伪造 Pi 的 ui.editor 槽位，记录每次操作。 */
function createFakeUi(): { ui: any; calls: string[]; current(): unknown } {
  const calls: string[] = [];
  let installed: unknown;
  const ui = {
    setEditorComponent(factory: unknown): void {
      calls.push(factory === undefined ? "clear" : "set");
      installed = factory;
    },
    getEditorComponent(): unknown {
      return installed;
    },
  };
  return { ui, calls, current: () => installed };
}

test("启用时挂载 factory，关闭时清除", () => {
  const { ui, calls, current } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure(SETTINGS);
  assert.equal(calls.at(-1), "set");
  assert.equal(typeof current(), "function");
  assert.equal(runtime.isActive, true);

  runtime.configure({ ...SETTINGS, enabled: false });
  assert.equal(calls.at(-1), "clear");
  assert.equal(runtime.isActive, false);
});

test("切换会话后旧 factory 放弃接管", () => {
  const { ui, current } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure(SETTINGS);

  const previous = current() as (tui: unknown, theme: unknown, keys: unknown) => unknown;
  assert.notEqual(previous(undefined, undefined, undefined), undefined, "当前会话应正常接管");

  runtime.bindSession({ ui });
  assert.equal(
    previous(undefined, undefined, undefined),
    undefined,
    "过期 generation 的 factory 必须返回 undefined",
  );
});

test("不覆盖第三方安装的 editor", () => {
  const { ui, calls, current } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure(SETTINGS);

  const thirdParty = (): undefined => undefined;
  ui.setEditorComponent(thirdParty);

  runtime.dispose();
  assert.equal(calls.at(-1), "set", "不得对第三方 editor 执行清除");
  assert.equal(current(), thirdParty, "第三方 editor 必须保持不动");
});

test("dispose 幂等", () => {
  const { ui, calls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure(SETTINGS);

  runtime.dispose();
  const afterFirst = calls.length;
  runtime.dispose();
  assert.equal(calls.length, afterFirst, "重复 dispose 不应再次操作 ui");
});

test("ui 缺失或 stale 时不崩溃", () => {
  const runtime = new InputFrameRuntime();

  runtime.bindSession(undefined);
  runtime.configure(SETTINGS);
  runtime.dispose();

  const hostile = {
    get ui(): never {
      throw new Error("extension ctx is stale");
    },
  };
  runtime.bindSession(hostile);
  runtime.configure(SETTINGS);
  runtime.dispose();

  assert.equal(runtime.isActive, false);
});

test("ui 缺少 setEditorComponent 时静默跳过", () => {
  const runtime = new InputFrameRuntime();
  runtime.bindSession({ ui: {} });
  runtime.configure(SETTINGS);

  assert.equal(runtime.isActive, false, "没有可用槽位时不应声称已接管");
});
