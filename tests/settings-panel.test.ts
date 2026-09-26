import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeLike } from "../src/core/theme.ts";
import { SETTINGS_ITEMS, SettingsPanel, renderPanelLines } from "../src/settings/panel.ts";
import type { ToggleItem } from "../src/settings/panel.ts";
import { DEFAULT_SETTINGS, cloneSettings } from "../src/settings/schema.ts";

const PLAIN_THEME: ThemeLike = { fg: (_token, text) => text };
const ANSI_THEME: ThemeLike = {
  fg: (_token, text) => `\x1b[38;2;1;2;3m${text}\x1b[39m`,
};

function assertWidths(lines: readonly string[], width: number, label: string): void {
  for (const [index, line] of lines.entries()) {
    assert.equal(visibleWidth(line), width, `${label} 第 ${index} 行宽度应为 ${width}`);
  }
}

test("面板每行宽度严格等于给定宽度", () => {
  const lines = renderPanelLines(PLAIN_THEME, cloneSettings(DEFAULT_SETTINGS), 0, 60);
  assertWidths(lines, 60, "面板");
});

test("多种宽度下外框都闭合且同宽（含最小宽度）", () => {
  for (const width of [24, 32, 48, 80]) {
    const lines = renderPanelLines(PLAIN_THEME, cloneSettings(DEFAULT_SETTINGS), 0, width);
    assert.ok(lines[0]?.startsWith("╭"), `宽度 ${width} 的顶边应以 ╭ 开头`);
    assert.ok(lines.at(-1)?.endsWith("╯"), `宽度 ${width} 的底边应以 ╯ 结尾`);
    assertWidths(lines, width, `宽度 ${width}`);
  }
});

test("ANSI 着色后宽度依然合规", () => {
  const lines = renderPanelLines(ANSI_THEME, cloneSettings(DEFAULT_SETTINGS), 1, 56);
  assertWidths(lines, 56, "ANSI 面板");
});

test("所有设置项都出现在面板里", () => {
  const text = renderPanelLines(PLAIN_THEME, cloneSettings(DEFAULT_SETTINGS), 0, 60).join("\n");
  for (const item of SETTINGS_ITEMS) {
    assert.ok(text.includes(item.label), `缺少设置项：${item.label}`);
  }
});

test("当前选中项带 > 标记且只有一个", () => {
  const lines = renderPanelLines(PLAIN_THEME, cloneSettings(DEFAULT_SETTINGS), 2, 60);
  const selectedItem = SETTINGS_ITEMS[2];
  assert.ok(selectedItem);

  const marked = lines.filter((line) => line.includes(">"));
  assert.equal(marked.length, 1, "只应有一行被标记为选中");
  assert.ok(marked[0]?.includes(selectedItem.label));
});

test("开关值反映配置状态", () => {
  const settings = cloneSettings(DEFAULT_SETTINGS);

  settings.inputFrame.enabled = false;
  const offText = renderPanelLines(PLAIN_THEME, settings, 0, 60).join("\n");
  assert.ok(offText.includes("关"), "关闭态应显示「关」");

  settings.inputFrame.enabled = true;
  const onText = renderPanelLines(PLAIN_THEME, settings, 0, 60).join("\n");
  assert.ok(onText.includes("开"), "开启态应显示「开」");
});

test("设置项的 get/set 直接对应配置结构", () => {
  const settings = cloneSettings(DEFAULT_SETTINGS);

  const item = SETTINGS_ITEMS.find(
    (candidate): candidate is ToggleItem => candidate.id === "userFrame",
  );
  assert.ok(item, "应存在 userFrame 项");

  assert.equal(item.get(settings), settings.messageFrame.userFrame);
  item.set(settings, false);
  assert.equal(settings.messageFrame.userFrame, false);
  item.set(settings, true);
  assert.equal(settings.messageFrame.userFrame, true);
});

test("风格枚举项在面板中循环切换 minimal → boxed → minimal", () => {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  const panel = new SettingsPanel(PLAIN_THEME, settings, {
    onChange: () => {},
    close: () => {},
  });

  // style 项位于清单第 2 位（index 1）：down 一次后按空格循环。
  panel.handleInput("\x1b[B");
  panel.handleInput(" ");
  assert.equal(settings.style, "boxed", "第一次切换应变为 boxed");
  panel.handleInput(" ");
  assert.equal(settings.style, "minimal", "再切一次应回到 minimal");
});

test("风格枚举项的当前值显示在面板里", () => {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  const text = renderPanelLines(PLAIN_THEME, settings, 1, 60).join("\n");
  assert.ok(text.includes("极简（锚点）"), "minimal 应显示极简标签");

  settings.style = "boxed";
  const boxedText = renderPanelLines(PLAIN_THEME, settings, 1, 60).join("\n");
  assert.ok(boxedText.includes("经典（外框）"), "boxed 应显示经典标签");
});

test("设置面板不包含任何 Patch 相关项（只暴露配置开关）", () => {
  const ids = SETTINGS_ITEMS.map((item) => item.id);
  assert.ok(ids.includes("enabled"));
  assert.ok(ids.includes("inputFrame"));
  assert.ok(!ids.some((id) => id.toLowerCase().includes("patch")));
});

test("缩进层级用于表达从属关系", () => {
  const depths = SETTINGS_ITEMS.map((item) => item.depth);
  assert.equal(depths[0], 0, "第一项为顶层");
  assert.ok(Math.max(...depths) >= 2, "应存在二级子项");
});
