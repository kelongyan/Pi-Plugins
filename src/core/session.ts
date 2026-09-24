/**
 * 会话作用域的资源管理与 TUI 渲染资源所有权。
 *
 * 官方契约（docs/extensions.md）要求：
 * - 不要在 factory 里启动定时器或长驻资源
 * - 从 session_start 启动会话级资源
 * - session_shutdown 里的清理必须幂等
 */

import { STATE_KEYS } from "./patch-keys.ts";

export type Disposable = { dispose(): void };

/**
 * 逆序释放的资源栈。dispose 幂等：重复调用不会重复释放；
 * 单个资源释放失败不影响其余资源。
 */
export class ResourceStack {
  private items: Disposable[] = [];
  private disposed = false;

  add(item: Disposable): void {
    if (this.disposed) {
      safeDispose(item);
      return;
    }
    this.items.push(item);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      safeDispose(this.items[i]);
    }
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

function safeDispose(item: Disposable | undefined): void {
  if (!item || typeof item.dispose !== "function") return;
  try {
    item.dispose();
  } catch {
    // 清理失败不能阻断其余资源的释放。
  }
}

/**
 * TUI 渲染资源的所有权令牌。
 *
 * 无 UI 的子代理与主会话同进程；若不加约束，子代理的 session_shutdown
 * 会误释放主会话的渲染资源。只有真正取得令牌的实例才有资格释放。
 */
export class TuiOwnership {
  private readonly token = Symbol("pi-zxdl-tui-owner");
  private held = false;

  acquire(): void {
    (globalThis as unknown as Record<PropertyKey, unknown>)[STATE_KEYS.tuiOwner] = this.token;
    this.held = true;
  }

  isOwner(): boolean {
    if (!this.held) return false;
    const current = (globalThis as unknown as Record<PropertyKey, unknown>)[STATE_KEYS.tuiOwner];
    return current === this.token;
  }

  release(): boolean {
    if (!this.isOwner()) return false;
    this.held = false;
    delete (globalThis as unknown as Record<PropertyKey, unknown>)[STATE_KEYS.tuiOwner];
    return true;
  }
}
