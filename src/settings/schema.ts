/**
 * 配置结构、默认值与防御式规范化。
 *
 * 规范化策略：残缺或类型错误的字段一律回退默认值（不做部分保留），
 * 保证下游拿到的永远是完整且类型正确的对象。
 */

export type MessageFrameSettings = {
  /** 消息外框总开关。 */
  enabled: boolean;
  /** 助手回复是否加框。 */
  assistantFrame: boolean;
  /** 用户消息是否加框。 */
  userFrame: boolean;
};

/** 可选的动画帧率。 */
export const FPS_OPTIONS = [8, 12, 16, 24, 30] as const;
export type FpsOption = (typeof FPS_OPTIONS)[number];

export type ThinkingSettings = {
  enabled: boolean;
  fps: FpsOption;
  /** 动画名称；null 表示随机挑选。 */
  animation: string | null;
};

export type InputFrameSettings = {
  enabled: boolean;
  /** 顶边左侧是否嵌入模型名。 */
  showModel: boolean;
  /** 顶边左侧是否嵌入 thinking 级别。 */
  showThinking: boolean;
  /** 顶边右侧是否嵌入上下文进度。 */
  showContext: boolean;
  /** 底边是否嵌入 token / 耗时指标。 */
  showMetrics: boolean;
};

export type ZxdlSettings = {
  /** 总开关。关闭后所有功能失效，但保留各子项偏好。 */
  enabled: boolean;
  messageFrame: MessageFrameSettings;
  thinking: ThinkingSettings;
  inputFrame: InputFrameSettings;
};

export const DEFAULT_SETTINGS: ZxdlSettings = {
  enabled: true,
  messageFrame: { enabled: true, assistantFrame: true, userFrame: true },
  thinking: { enabled: true, fps: 16, animation: null },
  inputFrame: {
    enabled: false,
    showModel: true,
    showThinking: true,
    showContext: true,
    showMetrics: true,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickFps(value: unknown, fallback: FpsOption): FpsOption {
  return typeof value === "number" && (FPS_OPTIONS as readonly number[]).includes(value)
    ? (value as FpsOption)
    : fallback;
}

function pickAnimationName(value: unknown, fallback: string | null): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 把任意输入规范化为完整、类型正确的配置。 */
export function normalizeSettings(value: unknown): ZxdlSettings {
  const root = asRecord(value);
  const frame = asRecord(root.messageFrame);
  const thinking = asRecord(root.thinking);
  const input = asRecord(root.inputFrame);

  return {
    enabled: pickBool(root.enabled, DEFAULT_SETTINGS.enabled),
    messageFrame: {
      enabled: pickBool(frame.enabled, DEFAULT_SETTINGS.messageFrame.enabled),
      assistantFrame: pickBool(frame.assistantFrame, DEFAULT_SETTINGS.messageFrame.assistantFrame),
      userFrame: pickBool(frame.userFrame, DEFAULT_SETTINGS.messageFrame.userFrame),
    },
    thinking: {
      enabled: pickBool(thinking.enabled, DEFAULT_SETTINGS.thinking.enabled),
      fps: pickFps(thinking.fps, DEFAULT_SETTINGS.thinking.fps),
      animation: pickAnimationName(thinking.animation, DEFAULT_SETTINGS.thinking.animation),
    },
    inputFrame: {
      enabled: pickBool(input.enabled, DEFAULT_SETTINGS.inputFrame.enabled),
      showModel: pickBool(input.showModel, DEFAULT_SETTINGS.inputFrame.showModel),
      showThinking: pickBool(input.showThinking, DEFAULT_SETTINGS.inputFrame.showThinking),
      showContext: pickBool(input.showContext, DEFAULT_SETTINGS.inputFrame.showContext),
      showMetrics: pickBool(input.showMetrics, DEFAULT_SETTINGS.inputFrame.showMetrics),
    },
  };
}

/** 深拷贝，避免调用方拿到内部共享引用。 */
export function cloneSettings(settings: ZxdlSettings): ZxdlSettings {
  return {
    enabled: settings.enabled,
    messageFrame: { ...settings.messageFrame },
    thinking: { ...settings.thinking },
    inputFrame: { ...settings.inputFrame },
  };
}

/** 总开关与子开关的合成判定。 */
export function isFeatureActive(
  settings: ZxdlSettings,
  feature: "messageFrame" | "thinking" | "inputFrame",
): boolean {
  return settings.enabled && settings[feature].enabled;
}
