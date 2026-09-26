import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
  isFeatureActive,
  normalizeSettings,
} from "../src/settings/schema.ts";

test("非对象输入回退完整默认值", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("nope"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(42), DEFAULT_SETTINGS);
});

test("类型错误的字段被钳制回默认值", () => {
  const result = normalizeSettings({
    enabled: "yes",
    messageFrame: { enabled: 1, assistantFrame: false },
    thinking: { enabled: "nope" },
    inputFrame: { showModel: "true" },
  });

  assert.equal(result.enabled, DEFAULT_SETTINGS.enabled);
  assert.equal(result.messageFrame.enabled, DEFAULT_SETTINGS.messageFrame.enabled);
  assert.equal(result.messageFrame.assistantFrame, false, "合法布尔值应被保留");
  assert.equal(result.thinking.enabled, DEFAULT_SETTINGS.thinking.enabled);
  assert.equal(result.inputFrame.showModel, DEFAULT_SETTINGS.inputFrame.showModel);
});

test("thinking 只保留 enabled 开关，不残留任何动画字段", () => {
  const normalized = normalizeSettings({ thinking: { enabled: false, fps: 30, animation: "matrix" } });

  assert.equal(normalized.thinking.enabled, false);
  assert.deepEqual(
    Object.keys(normalized.thinking),
    ["enabled"],
    "本项目不做思考动画，旧配置里的 fps / animation 必须被丢弃",
  );
});

test("style 字段只接受白名单值，其余回退 minimal", () => {
  assert.equal(normalizeSettings({ style: "boxed" }).style, "boxed");
  assert.equal(normalizeSettings({ style: "minimal" }).style, "minimal");
  assert.equal(normalizeSettings({ style: "fancy" }).style, "minimal");
  assert.equal(normalizeSettings({ style: 42 }).style, "minimal");
  assert.equal(normalizeSettings({}).style, DEFAULT_SETTINGS.style);
});

test("assistantAnchor 与 bashFrame 按布尔钳制", () => {
  const result = normalizeSettings({ assistantAnchor: true, bashFrame: "yes" });
  assert.equal(result.assistantAnchor, true);
  assert.equal(result.bashFrame, DEFAULT_SETTINGS.bashFrame);
});

test("hideScrollToEnd 默认开启（隐藏 Pi 原生滚动提示），布尔钳制", () => {
  assert.equal(DEFAULT_SETTINGS.hideScrollToEnd, true);
  assert.equal(normalizeSettings({ hideScrollToEnd: false }).hideScrollToEnd, false);
  assert.equal(normalizeSettings({ hideScrollToEnd: "no" }).hideScrollToEnd, DEFAULT_SETTINGS.hideScrollToEnd);
});

test("完整合法输入被原样保留", () => {
  const input = {
    enabled: false,
    style: "boxed",
    assistantAnchor: true,
    bashFrame: true,
    hideScrollToEnd: false,
    diffHighlight: false,
    startup: { enabled: false },
    messageFrame: { enabled: false, assistantFrame: false, userFrame: true },
    thinking: { enabled: true },
    inputFrame: {
      enabled: true,
      showModel: false,
      showThinking: false,
      showContext: true,
    },
    statusBar: {
      enabled: false,
      icons: "plain",
      segments: { model: false, path: true, git: false, context: true, tokens: false, speed: true },
    },
  };

  assert.deepEqual(normalizeSettings(input), input);
});

test("cloneSettings 产生独立副本", () => {
  const copy = cloneSettings(DEFAULT_SETTINGS);
  copy.messageFrame.enabled = !DEFAULT_SETTINGS.messageFrame.enabled;
  copy.inputFrame.showModel = !DEFAULT_SETTINGS.inputFrame.showModel;

  assert.notEqual(copy.messageFrame.enabled, DEFAULT_SETTINGS.messageFrame.enabled);
  assert.notEqual(copy.inputFrame.showModel, DEFAULT_SETTINGS.inputFrame.showModel);
});

test("isFeatureActive 受总开关约束", () => {
  const settings = cloneSettings(DEFAULT_SETTINGS);

  assert.equal(isFeatureActive(settings, "messageFrame"), true);

  settings.enabled = false;
  assert.equal(isFeatureActive(settings, "messageFrame"), false, "总开关关闭时子项失效");

  settings.enabled = true;
  settings.messageFrame.enabled = false;
  assert.equal(isFeatureActive(settings, "messageFrame"), false);
});
