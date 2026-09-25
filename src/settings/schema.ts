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

export type ThinkingSettings = {
  /**
   * 思考过程是否使用独立的 THINK 外框。
   * 关闭后思考内容退回普通 ASSISTANT 外框。
   *
   * ⚠️ 本项目**刻意不做思考动画** —— 思考块只有静态线框，
   * 不引入帧驱动、计时器或多种动画效果。这是与 alps-pi 的明确差异。
   */
  enabled: boolean;
};

export type InputFrameSettings = {
  enabled: boolean;
  /** 顶边是否显示模型名。 */
  showModel: boolean;
  /** 顶边是否显示 thinking 级别。 */
  showThinking: boolean;
  /** 顶边是否显示当前目录（家目录缩写，过长保留尾部两级）。 */
  showPath: boolean;
  /** 顶边是否显示 git 分支。 */
  showGit: boolean;
  /** 顶边是否显示上下文进度。 */
  showContext: boolean;
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
  thinking: { enabled: true },
  inputFrame: {
    enabled: false,
    showModel: true,
    showThinking: true,
    showPath: true,
    showGit: true,
    showContext: true,
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
    },
    inputFrame: {
      enabled: pickBool(input.enabled, DEFAULT_SETTINGS.inputFrame.enabled),
      showModel: pickBool(input.showModel, DEFAULT_SETTINGS.inputFrame.showModel),
      showThinking: pickBool(input.showThinking, DEFAULT_SETTINGS.inputFrame.showThinking),
      showPath: pickBool(input.showPath, DEFAULT_SETTINGS.inputFrame.showPath),
      showGit: pickBool(input.showGit, DEFAULT_SETTINGS.inputFrame.showGit),
      showContext: pickBool(input.showContext, DEFAULT_SETTINGS.inputFrame.showContext),
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
