/**
 * 可回滚、幂等的 prototype 方法包装模板。
 *
 * 综合两套参考实现的做法：
 * - alps-pi：wrapper 上挂元数据（owner + version + original），据此识别「这是我装的」
 * - pi-cc-extensions：槽位所有权守卫，dispose 时只还原自己装的那一个
 *
 * 三条不变量：
 * 1. 幂等：对同一 owner 重复安装不会形成双层包装（会越过自己的旧 wrapper 取原始方法）。
 * 2. 让位：原型方法已被第三方替换时，dispose 不覆盖它。
 * 3. 降级：目标方法不存在时返回 undefined，由调用方 fail-closed。
 */

import { MARKER_KEYS, WRAPPER_VERSION } from "./patch-keys.ts";
import { patchRegistry } from "./patch-registry.ts";

export type AnyFunction = (...args: any[]) => any;

/** 挂在包装函数上的元数据。 */
type WrapperMeta = {
  owner: symbol;
  version: number;
  original: AnyFunction;
  downstream: AnyFunction;
};

/** 一次方法包装的句柄。 */
export type MethodPatch = {
  readonly slot: symbol;
  readonly target: Record<string, any>;
  readonly method: string;
  readonly installed: AnyFunction;
  readonly original: AnyFunction;
  readonly downstream: AnyFunction;
  active: boolean;
};

export type InstallMethodPatchOptions = {
  /** PatchRegistry 槽位（来自 PATCH_KEYS）。 */
  slot: symbol;
  /** 承载方法的对象，通常是某个组件的 prototype。 */
  target: Record<string, any>;
  /** 方法名。 */
  method: string;
  /** 本次安装的所有者标识。 */
  owner: symbol;
  /** 包装器版本，默认取 WRAPPER_VERSION。 */
  version?: number;
  /**
   * 用原始方法与下游方法构造新实现。
   * - original：首次包装前的方法（供内部逻辑复用/兜底）
   * - downstream：当前应回退到的方法（可能是第三方 wrapper）
   */
  create: (original: AnyFunction, downstream: AnyFunction) => AnyFunction;
};

function readWrapperMeta(value: unknown): WrapperMeta | undefined {
  if (typeof value !== "function") return undefined;
  return (value as Record<PropertyKey, any>)[MARKER_KEYS.wrappedMethod] as WrapperMeta | undefined;
}

function writeWrapperMeta(value: AnyFunction, meta: WrapperMeta): void {
  Object.defineProperty(value, MARKER_KEYS.wrappedMethod, {
    value: meta,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/**
 * 安装方法包装。返回 undefined 表示目标方法不存在（调用方应 fail-closed）。
 */
export function installMethodPatch(options: InstallMethodPatchOptions): MethodPatch | undefined {
  const { slot, target, method, owner } = options;
  const version = options.version ?? WRAPPER_VERSION;

  const current: unknown = target[method];
  if (typeof current !== "function") return undefined;

  const previous = patchRegistry.get<MethodPatch>(slot);

  let original = current as AnyFunction;
  let downstream = current as AnyFunction;

  const currentMeta = readWrapperMeta(current);
  if (currentMeta && currentMeta.owner === owner) {
    // 热重载：当前方法仍是我们上次装的 wrapper，越过它取真正的原始方法，避免双层包装。
    original = currentMeta.original;
    downstream = currentMeta.downstream;
  } else if (previous) {
    // 槽位里有旧补丁，但原型方法已被别人替换：断开旧补丁，以当前方法作为下游。
    previous.active = false;
  }

  const wrapped = options.create(original, downstream);
  writeWrapperMeta(wrapped, { owner, version, original, downstream });

  const patch: MethodPatch = {
    slot,
    target,
    method,
    installed: wrapped,
    original,
    downstream,
    active: true,
  };

  target[method] = wrapped;
  patchRegistry.install(slot, patch);
  return patch;
}

/**
 * 卸载方法包装。
 * 仅当原型方法仍是我们安装的 wrapper 时才还原；否则说明已被第三方替换，跳过还原以保护对方。
 */
export function disposeMethodPatch(patch: MethodPatch): boolean {
  patch.active = false;
  if (patch.target[patch.method] === patch.installed) {
    patch.target[patch.method] = patch.downstream;
  }
  return patchRegistry.dispose(patch.slot, patch);
}

/** 该包装当前是否仍然生效。 */
export function isMethodPatchActive(patch: MethodPatch): boolean {
  return patch.active && patch.target[patch.method] === patch.installed;
}
