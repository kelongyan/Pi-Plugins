import assert from "node:assert/strict";
import test from "node:test";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  countMcpServers,
  HEADER_LINE_COUNT,
  ZxdlHeader,
  installStartupHeader,
  type StartupHeaderDeps,
} from "../src/features/startup-header.ts";

/** 剥 ANSI 后断言可见文本。 */
const plain = (line: string) => line.replace(/\x1b\[[0-9;:]*m/g, "");

function makeDeps(overrides: Partial<StartupHeaderDeps> = {}): StartupHeaderDeps {
  return {
    theme: { fg: (_token, text) => text },
    isIdle: () => true,
    getResourceCounts: () => ({ tools: 27, commands: 34, skills: 3, mcp: 2 }),
    ...overrides,
  };
}

test("宽屏渲染：logo 5 行 + 空行 + Resources 行，右列信息与 logo 对齐", () => {
  const header = new ZxdlHeader(makeDeps());
  const lines = header.render(80);

  assert.equal(lines.length, HEADER_LINE_COUNT);
  assert.ok(lines[0].includes("██"), "logo 首行应是顶部横杠色块");
  // 右列三行从 logo 第 2 行开始（INFO_OFFSET = 1）
  assert.match(plain(lines[1]), new RegExp(`Pi v${VERSION.replace(/\./g, "\\.")}`));
  assert.match(plain(lines[2]), /\/ commands · ! bash · ctrl\+o more/);
  assert.match(plain(lines[3]), /● ready/);
  assert.ok(lines[4].includes("██"), "logo 最后一行仍应是色块");
  assert.equal(plain(lines[5]).trim(), "", "分隔空行");
  assert.match(plain(lines[6]), /◆ Resources · tools 27 · commands 34 · skills 3 · mcp 2/);
});

test("工作中状态：ready 行变为 working", () => {
  const header = new ZxdlHeader(makeDeps({ isIdle: () => false }));
  const lines = header.render(80);
  assert.match(plain(lines[3]), /● working/);
});

test("窄终端降级（< 40 列）：单行版本号", () => {
  const header = new ZxdlHeader(makeDeps());
  const lines = header.render(30);
  assert.equal(lines.length, 1);
  assert.match(plain(lines[0]), new RegExp(`^Pi v${VERSION.replace(/\./g, "\\.")}$`));
});

test("theme.fg 抛异常时 safeFg 逐段兜底，结构完整、文本无损", () => {
  const header = new ZxdlHeader(
    makeDeps({ theme: { fg: () => { throw new Error("unknown token"); } } }),
  );
  const lines = header.render(80);
  // safeFg 吞掉 token 异常回退原文，异常不会传到 render 顶层——header 保持完整结构。
  assert.equal(lines.length, HEADER_LINE_COUNT);
  assert.match(plain(lines[1]), new RegExp(`Pi v${VERSION.replace(/\./g, "\\.")}`));
  assert.match(plain(lines[6]), /Resources/);
});

test("isIdle / getResourceCounts 抛异常不影响 header 结构", () => {
  const header = new ZxdlHeader(
    makeDeps({
      isIdle: () => { throw new Error("stale ctx"); },
      getResourceCounts: () => { throw new Error("stale ctx"); },
    }),
  );
  const lines = header.render(80);
  assert.equal(lines.length, HEADER_LINE_COUNT);
  assert.match(plain(lines[3]), /● ready/, "isIdle 异常按空闲处理");
  assert.match(plain(lines[6]), /tools 0 · commands 0/, "计数异常按 0 处理");
});

test("installStartupHeader：门面缺 setHeader 时 fail-closed 返回 undefined", () => {
  assert.equal(installStartupHeader({}, makeDeps()), undefined);
  assert.equal(installStartupHeader(undefined, makeDeps()), undefined);
  assert.equal(installStartupHeader({ ui: {} }, makeDeps()), undefined);
  assert.equal(
    installStartupHeader({ ui: { setHeader: "not-a-function" } }, makeDeps()),
    undefined,
  );
});

test("installStartupHeader：正常安装注册 factory，dispose 恢复原生 header", () => {
  const calls: unknown[] = [];
  const ctx = {
    ui: {
      setHeader: (factory: unknown) => {
        calls.push(factory);
      },
    },
  };

  const handle = installStartupHeader(ctx, makeDeps());
  assert.ok(handle, "setHeader 可用时应返回 handle");
  assert.equal(calls.length, 1, "安装时调用一次 setHeader");

  // Pi 侧调用 factory 得到组件实例
  const factory = calls[0] as () => ZxdlHeader;
  const component = factory();
  assert.ok(component instanceof ZxdlHeader);
  assert.equal(component.render(80).length, HEADER_LINE_COUNT);

  handle.dispose();
  assert.equal(calls.length, 2, "dispose 时以 undefined 再次调用 setHeader");
  assert.equal(calls[1], undefined, "恢复参数必须是 undefined（官方回退路径）");
});

test("installStartupHeader：setHeader 自身抛错时 fail-closed", () => {
  const handle = installStartupHeader(
    { ui: { setHeader: () => { throw new Error("stale"); } } },
    makeDeps(),
  );
  assert.equal(handle, undefined);
});

test("dispose 幂等：重复 dispose 不抛错", () => {
  const calls: unknown[] = [];
  const handle = installStartupHeader(
    { ui: { setHeader: (factory: unknown) => { calls.push(factory); } } },
    makeDeps(),
  );
  handle?.dispose();
  handle?.dispose();
  assert.equal(calls.length, 2);
});

test("countMcpServers：并集去重、双键名兼容、缺失文件安全跳过", () => {
  const dir = join(tmpdir(), `zxdl-mcp-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // 项目 .mcp.json（mcpServers 键，Claude Code 风格）
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { github: {}, "file-system": {} } }));
  // 项目 .pi/mcp.json（servers 键，与上面部分重叠 → 并集去重）
  mkdirSync(join(dir, ".pi"), { recursive: true });
  writeFileSync(join(dir, ".pi", "mcp.json"), JSON.stringify({ servers: { github: {}, tavily: {} } }));
  // 损坏的 JSON：跳过不影响其余
  writeFileSync(join(dir, "broken.json"), "{ not json");

  // 统计入口固定扫 <cwd>/.mcp.json 与 <cwd>/.pi/mcp.json（全局路径在测试机上原样存在，但名字不重叠即可）
  const count = countMcpServers(dir);
  assert.ok(count >= 3, `至少应统计到 github/file-system/tavily 的并集，实际 ${count}`);

  rmSync(dir, { recursive: true, force: true });
});

test("countMcpServers：无任何配置目录时返回 0（cwd 无文件）", () => {
  const empty = join(tmpdir(), `zxdl-mcp-empty-${Date.now()}`);
  mkdirSync(empty, { recursive: true });
  assert.equal(typeof countMcpServers(empty), "number");
  rmSync(empty, { recursive: true, force: true });
});
