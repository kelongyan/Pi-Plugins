import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyShellLines,
  renderBashInline,
  spinnerFrame,
} from "../src/features/message-frame/bash-inline.ts";

/** 剥 ANSI 后断言可见文本。 */
const plain = (line: string) => line.replace(/\x1b\[[0-9;:]*m/g, "");

const THEME = { fg: (_token: string, text: string) => text } as any;

/** 模拟 Pi 原生 shell render 输出（带提示符/耗时/输出预览的行结构）。 */
function nativePending(): string[] {
  return [
    "\x1b[36m\x1b[1m$ pnpm test\x1b[0m",
    "",
    "\x1b[2m  first output line\x1b[0m",
    "\x1b[2m  second output line\x1b[0m",
    "",
    "\x1b[2mElapsed 3.2s\x1b[0m",
  ];
}

function nativeDone(): string[] {
  return [
    "\x1b[36m\x1b[1m$ pnpm test\x1b[0m",
    "",
    "\x1b[2m  first output line\x1b[0m",
    "\x1b[2m  second output line\x1b[0m",
    "\x1b[2m  ... (12 earlier lines, ctrl+o to expand)\x1b[0m",
    "",
    "\x1b[2mTook 2.3s\x1b[0m",
  ];
}

const BASE = {
  toolName: "bash",
  theme: THEME,
  width: 80,
} as const;

test("spinnerFrame：时间片轮换且同刻稳定", () => {
  const a = spinnerFrame(1_000_000);
  const b = spinnerFrame(1_000_000 + 120);
  const a2 = spinnerFrame(1_000_000);
  assert.notEqual(a, b, "时间片推进应换帧");
  assert.equal(a, a2, "同一时刻取帧稳定（无状态）");
  assert.match(a, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/u);
});

test("classifyShellLines：命令行与耗时被剥离，输出保留", () => {
  const { hasCommandLine, elapsedText, keepLines } = classifyShellLines(nativePending());

  assert.equal(hasCommandLine, true);
  assert.equal(elapsedText, "3.2s");
  assert.equal(keepLines.length, 4, "空行与输出行保留，命令行/耗时行剔除");
  assert.match(plain(keepLines[1] ?? ""), /first output line/);
});

test("classifyShellLines：首个提示符后的 `$` 开头行视为输出，不误删", () => {
  const lines = [
    "\x1b[36m\x1b[1m$ cat script.sh\x1b[0m",
    "",
    "\x1b[2m$ echo hello\x1b[0m",
    "\x1b[2m$ whoami\x1b[0m",
    "",
    "\x1b[2mTook 1m 2s\x1b[0m",
  ];
  const { hasCommandLine, elapsedText, keepLines } = classifyShellLines(lines);
  assert.equal(hasCommandLine, true);
  assert.equal(elapsedText, "1m 2s");
  assert.equal(keepLines.length, 4, "输出里的 $ 行必须保留");
  assert.match(plain(keepLines[1] ?? ""), /\$ echo hello/);
});

test("classifyShellLines：输出中带 Took 文本的行不被误判为耗时", () => {
  const lines = [
    "\x1b[36m\x1b[1m$ vitest run\x1b[0m",
    "",
    "\x1b[2mTests took 3.2s to finish\x1b[0m",
  ];
  const { elapsedText, keepLines } = classifyShellLines(lines);
  assert.equal(elapsedText, undefined, "非纯时长格式的 Took 行应留在输出里");
  assert.equal(keepLines.length, 2);
});

test("classifyShellLines：powershell 的 PS> 提示符同样识别", () => {
  const lines = ["\x1b[36m\x1b[1mPS> Get-ChildItem\x1b[0m", "\x1b[2mElapsed 1.0s\x1b[0m"];
  const { hasCommandLine, elapsedText, keepLines } = classifyShellLines(lines);
  assert.equal(hasCommandLine, true);
  assert.equal(elapsedText, "1.0s");
  assert.deepEqual(keepLines, []);
});

test("运行中：单行呈现（spinner + running + 命令 + 耗时），输出预览丢弃", () => {
  const lines = renderBashInline({
    ...BASE,
    status: "pending",
    command: "pnpm test",
    nativeLines: nativePending(),
  });

  assert.ok(lines);
  assert.equal(lines.length, 1);
  const text = plain(lines[0] ?? "");
  assert.match(text, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] bash · running pnpm test · 3\.2s$/u);
});

test("运行中：args.command 多行时取第一行", () => {
  const lines = renderBashInline({
    ...BASE,
    status: "pending",
    command: "echo one\necho two",
    nativeLines: nativePending(),
  });
  assert.match(plain(lines?.[0] ?? ""), /running echo one/);
});

test("成功完成：锚点行 + 空行 + 输出预览进 gutter", () => {
  const lines = renderBashInline({
    ...BASE,
    status: "success",
    command: "pnpm test",
    nativeLines: nativeDone(),
  });

  assert.ok(lines);
  assert.equal(lines.length, 5, "锚点 + 空行 + 3 行输出（原生命令行/耗时行/首尾空行均已剔除）");
  assert.match(plain(lines[0] ?? ""), /^✓ bash · pnpm test · 2\.3s$/u);
  assert.equal(plain(lines[1] ?? ""), "");
  assert.match(plain(lines[2] ?? ""), /^│\s+first output line/u);
  assert.match(plain(lines[4] ?? ""), /\.\.\. \(12 earlier lines/);
});

test("成功完成：Pi 容器级 toolSuccessBg 背景被剥掉，前景保留", () => {
  // Pi 的 ToolExecutionComponent 给整个渲染容器 setBgFn(toolSuccessBg)——每行都带绿背景。
  const bg = "\x1b[42m";
  const lines = renderBashInline({
    ...BASE,
    status: "success",
    command: "pnpm test",
    nativeLines: [
      `${bg}\x1b[36m\x1b[1m$ pnpm test\x1b[0m`,
      `${bg}`,
      `${bg}\x1b[2m  passed  78\x1b[0m`,
      `${bg}\x1b[2mTook 2.3s\x1b[0m`,
    ],
  });

  assert.ok(lines);
  for (const line of lines) {
    assert.doesNotMatch(line, /\x1b\[4[0-7]m/, "任何行都不应残留背景色 SGR");
  }
  assert.match(plain(lines[2] ?? ""), /passed\s+78/, "前景文本保留");
});

test("失败完成：× 锚点 + 错误输出保留", () => {
  const lines = renderBashInline({
    ...BASE,
    status: "error",
    command: "pnpm test",
    nativeLines: nativeDone(),
  });
  assert.match(plain(lines?.[0] ?? ""), /^× bash · pnpm test · 2\.3s$/u);
});

test("成功完成：gutter 竖线变绿（success token），失败变红，思考类不受影响", () => {
  const theme = {
    fg: (token: string, text: string) => (token === "success" ? `G<${text}>` : token === "error" ? `R<${text}>` : text),
  } as any;

  const ok = renderBashInline({ ...BASE, status: "success", command: "pnpm test", nativeLines: nativeDone(), theme });
  assert.match(ok?.[2] ?? "", /^G<│ >/u, "成功态竖线应使用 success token");

  const bad = renderBashInline({ ...BASE, status: "error", command: "pnpm test", nativeLines: nativeDone(), theme });
  assert.match(bad?.[2] ?? "", /^R<│ >/u, "失败态竖线应使用 error token");

  // 默认主题（不传 token）仍为 muted 灰：锚点呈现的思考/其他工具行为不变
  const neutral = renderBashInline({ ...BASE, status: "success", command: "pnpm test", nativeLines: nativeDone() });
  assert.match(neutral?.[2] ?? "", /^│/, "默认主题下结构不变");
});

test("args.command 缺失时从原生命令行剥色提取", () => {
  const lines = renderBashInline({
    ...BASE,
    status: "pending",
    command: undefined,
    nativeLines: nativePending(),
  });
  assert.match(plain(lines?.[0] ?? ""), /running pnpm test/);
});

test("命令完全拿不到（无 args 且无命令行）→ undefined 回退", () => {
  const result = renderBashInline({
    ...BASE,
    status: "pending",
    command: undefined,
    nativeLines: ["\x1b[2mElapsed 3.2s\x1b[0m"],
  });
  assert.equal(result, undefined);
});

test("窄宽度（< 最小锚点宽度）→ undefined 回退", () => {
  const result = renderBashInline({
    ...BASE,
    width: 5,
    status: "pending",
    command: "pnpm test",
    nativeLines: nativePending(),
  });
  assert.equal(result, undefined);
});
