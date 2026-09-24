import assert from "node:assert/strict";
import test from "node:test";
import { disposeMethodPatch, installMethodPatch, isMethodPatchActive } from "../src/core/method-patch.ts";

function createTarget(): Record<string, any> {
  return {
    render(this: unknown, width: number): string[] {
      return [`base:${width}`];
    },
  };
}

test("包装后调用进入 wrapper，且可通过 original 复用原始实现", () => {
  const target = createTarget();
  const patch = installMethodPatch({
    slot: Symbol.for("pi.zxdl.test.method.basic"),
    target,
    method: "render",
    owner: Symbol("owner-basic"),
    create: (original) =>
      function (this: unknown, width: number): string[] {
        return [...(original.call(this, width) as string[]), "wrapped"];
      },
  });

  assert.ok(patch);
  assert.deepEqual(target.render(10), ["base:10", "wrapped"]);
  assert.equal(isMethodPatchActive(patch), true);

  disposeMethodPatch(patch);
  assert.deepEqual(target.render(10), ["base:10"]);
  assert.equal(isMethodPatchActive(patch), false);
});

test("对同一 owner 重复安装不会形成双层包装（热重载幂等）", () => {
  const target = createTarget();
  const owner = Symbol("owner-reload");
  const slot = Symbol.for("pi.zxdl.test.method.reload");
  const create = (original: (...args: any[]) => any) =>
    function (this: unknown, width: number): string[] {
      return [...(original.call(this, width) as string[]), "wrap"];
    };

  const first = installMethodPatch({ slot, target, method: "render", owner, create });
  const second = installMethodPatch({ slot, target, method: "render", owner, create });

  assert.ok(first);
  assert.ok(second);
  // 关键：只应出现一层 wrap，而不是两层
  assert.deepEqual(target.render(5), ["base:5", "wrap"]);
});

test("原型方法被第三方替换后，dispose 不覆盖对方", () => {
  const target = createTarget();
  const slot = Symbol.for("pi.zxdl.test.method.third-party");
  const patch = installMethodPatch({
    slot,
    target,
    method: "render",
    owner: Symbol("owner-third-party"),
    create: (original: (...args: any[]) => any) => original,
  });
  assert.ok(patch);

  const thirdParty = function (): string[] {
    return ["third"];
  };
  target.render = thirdParty;

  disposeMethodPatch(patch);
  assert.equal(target.render, thirdParty, "不得覆盖第三方安装的 wrapper");
});

test("目标方法不存在时返回 undefined（fail-closed）", () => {
  const patch = installMethodPatch({
    slot: Symbol.for("pi.zxdl.test.method.missing"),
    target: {},
    method: "render",
    owner: Symbol("owner-missing"),
    create: () => () => [],
  });

  assert.equal(patch, undefined);
});

test("热重载场景下保留最初的 original 方法", () => {
  const target = createTarget();
  const owner = Symbol("owner-chain");
  const slot = Symbol.for("pi.zxdl.test.method.chain");
  const create = (original: (...args: any[]) => any) =>
    function (this: unknown, width: number): string[] {
      return [...(original.call(this, width) as string[]), "layer"];
    };

  installMethodPatch({ slot, target, method: "render", owner, create });
  installMethodPatch({ slot, target, method: "render", owner, create });
  const third = installMethodPatch({ slot, target, method: "render", owner, create });

  assert.ok(third);
  // original 必须回溯到未被包装的原始实现，否则层数会随 reload 累积
  assert.deepEqual(target.render(1), ["base:1", "layer"]);
  assert.equal(third.original === third.downstream, true);
});
