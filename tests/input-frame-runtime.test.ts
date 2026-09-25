import assert from "node:assert/strict";
import test from "node:test";
import { InputFrameRuntime } from "../src/features/input-frame/runtime.ts";

const SEGMENTS = { model: true, path: true, git: true, context: true, tokens: true, speed: true };

const SETTINGS = {
  enabled: true,
  showModel: true,
  showThinking: true,
  showContext: true,
  statusBarEnabled: false,
  statusBarIcons: "emoji" as const,
  statusBarSegments: SEGMENTS,
};

/** 伪造 Pi 的 ui.editor / ui.footer 槽位，分别记录操作。 */
function createFakeUi(): {
  ui: any;
  calls: string[];
  footerCalls: string[];
  current(): unknown;
  footer(): unknown;
} {
  const calls: string[] = [];
  const footerCalls: string[] = [];
  let installed: unknown;
  let footerInstalled: unknown;
  const ui = {
    setEditorComponent(factory: unknown): void {
      calls.push(factory === undefined ? "clear" : "set");
      installed = factory;
    },
    getEditorComponent(): unknown {
      return installed;
    },
    setFooter(factory: unknown): void {
      footerCalls.push(factory === undefined ? "clear" : "set");
      footerInstalled = factory;
    },
  };
  return { ui, calls, footerCalls, current: () => installed, footer: () => footerInstalled };
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

test("状态栏开启时接管 footer（用于覆盖 Pi 原生 footer）", () => {
  const { ui, footerCalls, footer } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: false, statusBarEnabled: true });

  assert.equal(footerCalls.at(-1), "set");
  assert.equal(typeof footer(), "function");
});

test("状态栏关闭时恢复默认 footer", () => {
  const { ui, footerCalls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: false, statusBarEnabled: true });
  runtime.configure({ ...SETTINGS, enabled: false, statusBarEnabled: false });

  assert.equal(footerCalls.at(-1), "clear");
});

test("只开状态栏时不接管 editor（线框由独立开关控制）", () => {
  const { ui, calls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: false, statusBarEnabled: true });

  assert.ok(!calls.includes("set"), "不应替换 editor");
});

test("只开线框时不接管 footer", () => {
  const { ui, footerCalls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: false });

  assert.ok(!footerCalls.includes("set"), "不应替换 footer");
});

test("两者都开时分别接管 editor 与 footer", () => {
  const { ui, calls, footerCalls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: true });

  assert.equal(calls.at(-1), "set");
  assert.equal(footerCalls.at(-1), "set");
});

test("dispose 同时释放 editor 与 footer", () => {
  const { ui, calls, footerCalls } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: true });
  runtime.dispose();

  assert.equal(calls.at(-1), "clear");
  assert.equal(footerCalls.at(-1), "clear");
});

test("footer 组件在会话切换后渲染为空", () => {
  const { ui, footer } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: true });

  const component = (footer() as (a: unknown, b: unknown, c: unknown) => any)(
    undefined,
    undefined,
    undefined,
  );
  assert.ok(Array.isArray(component.render(80)));

  runtime.bindSession({ ui });
  assert.deepEqual(component.render(80), [], "过期 generation 应渲染为空");
});

test("footer 关闭后组件渲染为空", () => {
  const { ui, footer } = createFakeUi();
  const runtime = new InputFrameRuntime();

  runtime.bindSession({ ui });
  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: true });
  const component = (footer() as any)(undefined, undefined, undefined);

  runtime.configure({ ...SETTINGS, enabled: true, statusBarEnabled: false });
  assert.deepEqual(component.render(80), []);
});
