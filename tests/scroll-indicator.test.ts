import assert from "node:assert/strict";
import test from "node:test";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import {
  installScrollIndicatorHider,
  isScrollIndicatorPatchable,
} from "../src/core/scroll-indicator.ts";

test("能力探测：本机 pi-tui 的 TuiAltScreen 可 patch", () => {
  assert.equal(isScrollIndicatorPatchable(), true);
  const prototype = TuiAltScreen.prototype as unknown as Record<string, any>;
  assert.equal(typeof prototype.compositeScrollToEndIndicator, "function");
});

test("安装后 compositeScrollToEndIndicator 直接透传屏幕（不合成提示）", () => {
  const handle = installScrollIndicatorHider();
  assert.ok(handle, "安装应成功");

  try {
    const prototype = TuiAltScreen.prototype as unknown as Record<string, any>;
    const original = prototype.compositeScrollToEndIndicator;

    const fakeScreen = ["line1", "line2"];
    const fakeThis = { scrollToEndIndicatorRect: { row: 1, column: 1, width: 5 } };
    const result = original.call(fakeThis, fakeScreen, {}, 80);

    assert.deepEqual(result, fakeScreen, "屏幕内容应原样透传");
    assert.equal(fakeThis.scrollToEndIndicatorRect, undefined, "提示矩形缓存应被清掉");
  } finally {
    handle?.dispose();
  }
});

test("dispose 后方法还原，且还原目标只认自己的包装（保护第三方）", () => {
  const handle = installScrollIndicatorHider();
  assert.ok(handle);
  const prototype = TuiAltScreen.prototype as unknown as Record<string, any>;
  const patched = prototype.compositeScrollToEndIndicator;

  handle.dispose();
  assert.notEqual(prototype.compositeScrollToEndIndicator, patched, "dispose 应还原方法");
});
