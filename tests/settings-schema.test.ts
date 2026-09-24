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
    thinking: { fps: 999 },
    inputFrame: { showMetrics: "true" },
  });

  assert.equal(result.enabled, DEFAULT_SETTINGS.enabled);
  assert.equal(result.messageFrame.enabled, DEFAULT_SETTINGS.messageFrame.enabled);
  assert.equal(result.messageFrame.assistantFrame, false, "合法布尔值应被保留");
  assert.equal(result.thinking.fps, DEFAULT_SETTINGS.thinking.fps);
  assert.equal(result.inputFrame.showMetrics, DEFAULT_SETTINGS.inputFrame.showMetrics);
});

test("fps 只接受白名单取值", () => {
  assert.equal(normalizeSettings({ thinking: { fps: 24 } }).thinking.fps, 24);
  assert.equal(normalizeSettings({ thinking: { fps: 99 } }).thinking.fps, DEFAULT_SETTINGS.thinking.fps);
  assert.equal(normalizeSettings({ thinking: { fps: "16" } }).thinking.fps, DEFAULT_SETTINGS.thinking.fps);
});

test("animation 空白字符串归一为 null", () => {
  assert.equal(normalizeSettings({ thinking: { animation: "   " } }).thinking.animation, null);
  assert.equal(normalizeSettings({ thinking: { animation: "" } }).thinking.animation, null);
  assert.equal(normalizeSettings({ thinking: { animation: "matrix" } }).thinking.animation, "matrix");
});

test("完整合法输入被原样保留", () => {
  const input = {
    enabled: false,
    messageFrame: { enabled: false, assistantFrame: false, userFrame: true },
    thinking: { enabled: true, fps: 30, animation: "aurora" },
    inputFrame: {
      enabled: true,
      showModel: false,
      showThinking: false,
      showContext: true,
      showMetrics: false,
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
