import assert from "node:assert/strict";
import test from "node:test";
import {
  diffLanguageFromArgs,
  renderEditDiffLine,
  transformEditDiffLines,
  type HighlightFn,
} from "../src/features/diff-highlight.ts";

/** 断言友好的主题：fg 调用包装为 [token]text，一眼看出语义色边界。 */
const THEME = { fg: (token: string, text: string) => `[${token}]${text}` } as any;

const FAKE_HL: HighlightFn = (code, lang) => [`HL<${lang}>(${code})`];

test("非 edit 工具原样返回（引用相等，零开销）", () => {
  const lines = ["+12 const x = 1;"];
  const result = transformEditDiffLines("bash", { args: { path: "a.ts" } }, lines, THEME, FAKE_HL);
  assert.equal(result, lines);

  const noName = transformEditDiffLines(undefined, { args: { path: "a.ts" } }, lines, THEME, FAKE_HL);
  assert.equal(noName, lines);
});

test("空行数组原样返回", () => {
  const lines: string[] = [];
  assert.equal(transformEditDiffLines("edit", { args: { path: "a.ts" } }, lines, THEME, FAKE_HL), lines);
});

test("增删行重绘：语义色保留在符号与行号，内容走语法高亮", () => {
  const lines = ["+12 const x = 1;", "-13 let y = 2;"];
  const result = transformEditDiffLines(
    "edit",
    { args: { path: "src/a.ts" } },
    lines,
    THEME,
    FAKE_HL,
  );

  assert.deepEqual(result, [
    "[toolDiffAdded]+12 HL<typescript>(const x = 1;)",
    "[toolDiffRemoved]-13 HL<typescript>(let y = 2;)",
  ]);
});

test("行号带 padStart 前导空格时正确解析，代码缩进保留", () => {
  const result = renderEditDiffLine("+  12   const x = 1;", "typescript", THEME, FAKE_HL);
  // 行号 "  12" 后一个空格是分隔符，剩余两个空格属于代码缩进。
  assert.equal(result, "[toolDiffAdded]+  12 HL<typescript>(  const x = 1;)");
});

test("上下文行 / 标题行 / 省略行原样透传（保持 Pi 原生弱化灰）", () => {
  const lines = [
    "edit src/a.ts",
    " 12 unchanged();",
    "     ...",
    "",
  ];
  const result = transformEditDiffLines(
    "edit",
    { args: { path: "src/a.ts" } },
    lines,
    THEME,
    FAKE_HL,
  );
  assert.equal(result, lines, "全部行都不匹配增删格式，应返回原数组");
});

test("带 ANSI 的输入行（Pi 原生输出）也能正确解析重绘", () => {
  const native = "\x1b[31m-13 let y = 2;\x1b[0m";
  const result = renderEditDiffLine(native, "typescript", THEME, FAKE_HL);
  assert.equal(result, "[toolDiffRemoved]-13 HL<typescript>(let y = 2;)");
});

test("扩展名无法映射到语言时不重绘", () => {
  const lines = ["+12 what is this"];
  const result = transformEditDiffLines("edit", { args: { path: "a.unknownext" } }, lines, THEME, FAKE_HL);
  assert.equal(result, lines);
});

test("args 缺失或无路径时不重绘", () => {
  const lines = ["+12 const x = 1;"];
  assert.equal(transformEditDiffLines("edit", undefined, lines, THEME, FAKE_HL), lines);
  assert.equal(transformEditDiffLines("edit", { args: {} }, lines, THEME, FAKE_HL), lines);
});

test("file_path 兼容键同样生效", () => {
  const result = transformEditDiffLines(
    "edit",
    { args: { file_path: "a.py" } },
    ["+1 print(1)"],
    THEME,
    FAKE_HL,
  );
  assert.deepEqual(result, ["[toolDiffAdded]+1 HL<python>(print(1))"]);
});

test("高亮抛异常时整行回落语义色", () => {
  const boom: HighlightFn = () => {
    throw new Error("hljs exploded");
  };
  // 缓存按 code 全局共享：这里必须用其他用例没用过的 code，否则会命中旧缓存。
  const result = renderEditDiffLine('+12 let boomProbe = "x";', "typescript", THEME, boom);
  assert.equal(result, '[toolDiffAdded]+12 [toolDiffAdded]let boomProbe = "x";');
});

test("同一行内容重复渲染命中缓存，高亮函数只执行一次", () => {
  let calls = 0;
  const counting: HighlightFn = (code, lang) => {
    calls++;
    return [`HL<${lang}>(${code})`];
  };

  const line = '+12 const cacheProbe = "only-once";';
  const first = renderEditDiffLine(line, "typescript", THEME, counting);
  const second = renderEditDiffLine(line, "typescript", THEME, counting);

  assert.equal(calls, 1, "第二次应命中缓存");
  assert.equal(first, second);
});

test("diffLanguageFromArgs：path / file_path / filePath 均可，非法输入安全返回", () => {
  assert.equal(diffLanguageFromArgs({ args: { path: "a.go" } }), "go");
  assert.equal(diffLanguageFromArgs({ args: { file_path: "a.py" } }), "python");
  assert.equal(diffLanguageFromArgs({ args: { filePath: "a.rs" } }), "rust");
  assert.equal(diffLanguageFromArgs({ args: { path: 42 } }), undefined);
  assert.equal(diffLanguageFromArgs({ args: null }), undefined);
  assert.equal(diffLanguageFromArgs(undefined), undefined);
});

test("真实 Pi 高亮链路冒烟：走 Pi 官方 highlightCode 不抛错且内容完整", () => {
  const result = transformEditDiffLines(
    "edit",
    { args: { path: "src/a.ts" } },
    ['+12 const smokeProbe = "real-hljs";', " 13 keep();"],
    { fg: (_t: string, text: string) => text } as any,
  );
  // 真实 hljs：行仍以 +12 开头、代码内容保留。是否带 ANSI 取决于测试进程的
  // 颜色环境（非 TTY 时 Pi 主题降级为纯文本），故这里不假设有转义序列。
  assert.match(result[0], /^\+12 /);
  assert.ok(result[0].includes('const smokeProbe = "real-hljs";'), "代码内容应保留");
  assert.equal(result[1], " 13 keep();", "上下文行透传");
});
