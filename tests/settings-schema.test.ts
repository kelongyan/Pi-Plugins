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

test("完整合法输入被原样保留", () => {
  const input = {
    enabled: false,
    messageFrame: { enabled: false, assistantFrame: false, userFrame: true },
    thinking: { enabled: true },
    inputFrame: {
      enabled: true,
      showModel: false,
      showThinking: false,
      showContext: true,
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
