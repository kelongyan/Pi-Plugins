import assert from "node:assert/strict";
import test from "node:test";
import { PatchRegistry } from "../src/core/patch-registry.ts";

function createHost(): Record<PropertyKey, unknown> {
  return {};
}

test("install 写入并返回被替换的旧值", () => {
  const host = createHost();
  const registry = new PatchRegistry(host);
  const slot = Symbol.for("pi.zxdl.test.install");
  const first = { id: "first" };
  const second = { id: "second" };

  assert.equal(registry.install(slot, first), undefined);
  assert.equal(registry.install(slot, second), first);
  assert.equal(host[slot], second);
});

test("dispose 有所有权守卫：旧补丁不得删除新补丁", () => {
  const host = createHost();
  const registry = new PatchRegistry(host);
  const slot = Symbol.for("pi.zxdl.test.dispose");
  const oldPatch = { id: "old" };
  const newPatch = { id: "new" };

  registry.install(slot, oldPatch);
  registry.install(slot, newPatch);

  assert.equal(registry.dispose(slot, oldPatch), false);
  assert.equal(host[slot], newPatch);

  assert.equal(registry.dispose(slot, newPatch), true);
  assert.equal(slot in host, false);
});

test("owns 使用恒等比较", () => {
  const host = createHost();
  const registry = new PatchRegistry(host);
  const slot = Symbol.for("pi.zxdl.test.owns");
  const value = { id: "v" };

  registry.install(slot, value);
  assert.equal(registry.owns(slot, value), true);
  assert.equal(registry.owns(slot, { id: "v" }), false);
});

test("ensure 只初始化一次并缓存结果", () => {
  const host = createHost();
  const registry = new PatchRegistry(host);
  const slot = Symbol.for("pi.zxdl.test.ensure");
  let calls = 0;
  const init = () => {
    calls += 1;
    return { calls };
  };

  const first = registry.ensure(slot, init);
  const second = registry.ensure(slot, init);

  assert.equal(calls, 1);
  assert.equal(first, second);
});

test("delete 无条件删除，且对不存在的键返回 false", () => {
  const host = createHost();
  const registry = new PatchRegistry(host);
  const slot = Symbol.for("pi.zxdl.test.delete");

  assert.equal(registry.delete(slot), false);
  registry.install(slot, { id: "x" });
  assert.equal(registry.delete(slot), true);
  assert.equal(slot in host, false);
});
