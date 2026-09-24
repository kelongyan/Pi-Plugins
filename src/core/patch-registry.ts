/**
 * 补丁槽位的所有权生命周期。
 *
 * host 默认是 globalThis：跨 /reload 与 jiti 重载保持稳定。
 * 所有权守卫删除（dispose）保证 /reload 后旧模块不会误删新模块安装的补丁。
 *
 * 设计参考 pi-cc-extensions `extensions/utils/patch-keys.ts` 的 PatchRegistry（MIT, minuque）。
 */

/** 可写入 symbol 键的宿主对象。 */
export type PatchHost = Record<PropertyKey, unknown>;

export class PatchRegistry {
  readonly host: PatchHost;

  constructor(host: PatchHost = globalThis as unknown as PatchHost) {
    this.host = host;
  }

  /** 读取槽位当前值。 */
  get<T = unknown>(key: symbol): T | undefined {
    return this.host[key] as T | undefined;
  }

  /** 槽位是否仍由 value 持有（恒等比较）。 */
  owns(key: symbol, value: unknown): boolean {
    return this.host[key] === value;
  }

  /** 覆盖写入并返回被替换的旧值；不自动让旧值失效。 */
  install<T = unknown>(key: symbol, value: T): T | undefined {
    const previous = this.host[key] as T | undefined;
    this.host[key] = value;
    return previous;
  }

  /** 所有权守卫删除：仅当槽位仍 === value 时删除。返回是否实际删除。 */
  dispose(key: symbol, value: unknown): boolean {
    if (!this.owns(key, value)) return false;
    delete this.host[key];
    return true;
  }

  /** 惰性槽位（??= 语义），用于无所有权的跨模块共享状态。 */
  ensure<T>(key: symbol, init: () => T): T {
    const current = this.host[key];
    if (current !== null && current !== undefined) return current as T;
    const value = init();
    this.host[key] = value;
    return value;
  }

  /** 无条件删除槽位（不判断所有权）。返回是否实际删除了键。 */
  delete(key: symbol): boolean {
    if (!(key in this.host)) return false;
    delete this.host[key];
    return true;
  }
}

/** 全局单例：host 固定为 globalThis，跨 /reload 与 jiti 重载稳定。 */
export const patchRegistry = new PatchRegistry();
