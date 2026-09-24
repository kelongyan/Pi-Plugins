/**
 * pi-zxdl 补丁槽位与协调键的单一来源（single source of truth）。
 *
 * 全部使用 Symbol.for（全局注册表）：/reload 后新模块实例拿到的是同一个 symbol，
 * 这是跨 reload 识别与让渡补丁所有权的关键。切勿改成模块局部 Symbol。
 *
 * 所有权模型参考 pi-cc-extensions `extensions/utils/patch-keys.ts`（MIT, minuque）。
 */

/** 本扩展的全局符号命名空间。 */
export const SYMBOL_NAMESPACE = "pi.zxdl";

const key = (name: string): symbol => Symbol.for(`${SYMBOL_NAMESPACE}.${name}`);

/**
 * globalThis 上的补丁槽位：安装补丁时写入，dispose 时按所有权守卫还原。
 */
export const PATCH_KEYS = {
  /** ① 消息对话框外框。 */
  messageFrame: key("patch.message-frame"),
  /** ② 思考过程 UI。 */
  thinking: key("patch.thinking"),
  /** ③ 输入框线框（走公开 API，槽位仅用于记录所有权）。 */
  inputFrame: key("patch.input-frame"),
} as const;

/**
 * 跨模块协调用的状态槽位。
 */
export const STATE_KEYS = {
  /** TUI 渲染资源所有权令牌：只有持有者可以释放全局渲染资源。 */
  tuiOwner: key("state.tui-owner"),
} as const;

/**
 * 挂在实例或包装函数上的标记。
 */
export const MARKER_KEYS = {
  /** 包装函数的元数据（owner / version / original / downstream）。 */
  wrappedMethod: key("marker.wrapped-method"),
  /** 渲染缓存（挂在组件实例上）。 */
  renderCache: key("marker.render-cache"),
} as const;

/**
 * 按名称派生补丁槽位。
 *
 * 用于「同一功能需要包装多个目标」的场景：每个目标一个独立槽位，
 * 由 PatchRegistry 分别管理所有权，避免单个目标失败拖垮整批。
 */
export const patchSlot = (name: string): symbol => key(`patch.${name}`);

/**
 * 包装器元数据版本。每次修改包装语义时递增，
 * 使热重载后旧 wrapper 被识别为过期并重新包装。
 */
export const WRAPPER_VERSION = 1;
