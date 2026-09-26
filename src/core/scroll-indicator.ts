/**
 * 隐藏 Pi fullscreen 模式的「↓ Jump to latest message」滚动提示。
 *
 * 出处：Pi 0.87.1 的 `TuiAltScreen.compositeScrollToEndIndicator` —— 用户向上滚动
 * 离开最新消息时，在滚动区底行合成 ` ↓ Jump to latest message · <快捷键> ` 提示。
 * Pi 没有官方开关；扩展拿到的 `ctx.ui` 是受限门面（createExtensionUIContext），
 * 没有通向 renderer 的通道，写 `ctx.ui.scrollToEndIndicator` 无效（实机验证）。
 *
 * 方案：与消息外框同一套 method-patch 基建，包装 prototype 的
 * `compositeScrollToEndIndicator` 直接透传屏幕内容（并清掉提示矩形缓存）。
 * 可探测、可回滚、幂等；Pi 内部改名/移除时探测失败 → fail-closed（提示照常显示）。
 */

import { TuiAltScreen } from "@earendil-works/pi-tui";
import { disposeMethodPatch, installMethodPatch, type MethodPatch } from "./method-patch.ts";
import { patchSlot } from "./patch-keys.ts";

const OWNER = Symbol("pi-zxdl-scroll-indicator-owner");

export type ScrollIndicatorHandle = {
  dispose(): void;
};

/** 能力探测：TuiAltScreen.prototype.compositeScrollToEndIndicator 可用。 */
export function isScrollIndicatorPatchable(): boolean {
  const prototype = (TuiAltScreen as unknown as Record<string, any> | undefined)?.prototype;
  return Boolean(prototype) && typeof prototype?.compositeScrollToEndIndicator === "function";
}

/**
 * 安装滚动提示隐藏补丁。
 * 返回 undefined 表示 Pi 内部结构不匹配（调用方 fail-closed：不做隐藏，提示照常）。
 */
export function installScrollIndicatorHider(): ScrollIndicatorHandle | undefined {
  const prototype = (TuiAltScreen as unknown as Record<string, any> | undefined)?.prototype as
    | Record<string, any>
    | undefined;
  if (!prototype || typeof prototype?.compositeScrollToEndIndicator !== "function") return undefined;

  const patch: MethodPatch | undefined = installMethodPatch({
    slot: patchSlot("scroll-indicator.TuiAltScreen"),
    target: prototype,
    method: "compositeScrollToEndIndicator",
    owner: OWNER,
    create:
      (original) =>
      function (this: any, screen: unknown, ...rest: unknown[]): unknown {
        // 提示矩形缓存清零（原方法开头同样会清），屏幕内容原样透传 —— 提示不再被合成。
        this.scrollToEndIndicatorRect = undefined;
        void original;
        return screen;
      },
  });

  if (!patch) return undefined;

  return {
    dispose(): void {
      disposeMethodPatch(patch);
    },
  };
}
