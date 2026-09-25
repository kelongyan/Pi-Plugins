import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDefaultTheme,
  isBuiltinTheme,
  ZXDL_THEME_FALLBACK,
  ZXDL_THEME_SETTING,
} from "../src/settings/theme.ts";

type UiBehavior = "all-ok" | "only-fallback" | "none" | "throws";

function fakeUi(behavior: UiBehavior): { ui: { setTheme(name: string): { success: boolean; error?: string } }; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ui: {
      setTheme(name: string) {
        calls.push(name);
        if (behavior === "throws") throw new Error("boom");
        if (behavior === "all-ok") return { success: true };
        if (behavior === "only-fallback") return { success: name === ZXDL_THEME_FALLBACK };
        return { success: false, error: "not found" };
      },
    },
  };
}

test("isBuiltinTheme 识别 Pi 自带主题与未设置", () => {
  assert.equal(isBuiltinTheme(undefined), true);
  assert.equal(isBuiltinTheme(""), true);
  assert.equal(isBuiltinTheme("   "), true);
  assert.equal(isBuiltinTheme("dark"), true);
  assert.equal(isBuiltinTheme("light"), true);
  assert.equal(isBuiltinTheme("light/dark"), true);
  assert.equal(isBuiltinTheme("dark/light"), true);
  assert.equal(isBuiltinTheme("eva-dark"), false);
  assert.equal(isBuiltinTheme("my-theme"), false);
});

test("默认主题下自动切换，优先使用自动明暗模式", () => {
  const { ui, calls } = fakeUi("all-ok");
  const applied = applyDefaultTheme(ui, "dark");

  assert.equal(applied, ZXDL_THEME_SETTING);
  assert.deepEqual(calls, [ZXDL_THEME_SETTING]);
});

test("自动明暗模式不被接受时退回单一深色主题", () => {
  const { ui, calls } = fakeUi("only-fallback");
  const applied = applyDefaultTheme(ui, "light");

  assert.equal(applied, ZXDL_THEME_FALLBACK);
  assert.deepEqual(calls, [ZXDL_THEME_SETTING, ZXDL_THEME_FALLBACK]);
});

test("用户已自定义主题时完全不干预", () => {
  const { ui, calls } = fakeUi("all-ok");
  const applied = applyDefaultTheme(ui, "my-custom-theme");

  assert.equal(applied, undefined);
  assert.deepEqual(calls, [], "不应调用 setTheme");
});

test("已经是 eva 主题时不重复切换", () => {
  const { ui, calls } = fakeUi("all-ok");

  assert.equal(applyDefaultTheme(ui, "eva-dark"), undefined);
  assert.equal(applyDefaultTheme(ui, "eva-light"), undefined);
  assert.deepEqual(calls, []);
});

test("两个候选都失败时返回 undefined", () => {
  const { ui, calls } = fakeUi("none");

  assert.equal(applyDefaultTheme(ui, "dark"), undefined);
  assert.equal(calls.length, 2);
});

test("setTheme 抛错时不向外冒泡", () => {
  const { ui } = fakeUi("throws");

  assert.doesNotThrow(() => applyDefaultTheme(ui, "dark"));
  assert.equal(applyDefaultTheme(ui, "dark"), undefined);
});

test("ui 或 setTheme 缺失时安全返回", () => {
  assert.equal(applyDefaultTheme(undefined, "dark"), undefined);
  assert.equal(applyDefaultTheme({}, "dark"), undefined);
  assert.equal(applyDefaultTheme({ setTheme: undefined }, "dark"), undefined);
});
