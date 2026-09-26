/**
 * 生成渲染基线样例（用于视觉回归）。
 *
 * 用固定输入渲染各类消息呈现，把结果写成 markdown 入库 ——
 * 之后若渲染逻辑被改动，`git diff docs/render-baseline.md` 就能直接看出视觉变化。
 *
 * 做法参考 pi-cc-extensions 的 `scripts/generate-tool-render-examples.ts`（MIT, minuque）。
 *
 * 用法：npm run docs:baseline
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThemeLike } from "../src/core/theme.ts";
import { renderEditorFrame } from "../src/features/input-frame/frame.ts";
import { composeStatusBar, type StatusBarSegment } from "../src/features/input-frame/status-bar.ts";
import {
  renderAnchoredMessage,
  renderAssistantAnchorLine,
  renderMessageBox,
  renderThinkingBox,
} from "../src/features/message-frame/chrome.ts";
import type { MessageKind } from "../src/features/message-frame/styles.ts";
import { transformEditDiffLines } from "../src/features/diff-highlight.ts";
import { renderBashInline } from "../src/features/message-frame/bash-inline.ts";
import { ZxdlHeader } from "../src/features/startup-header.ts";

/** 纯文本主题：基线只关心结构与文本，不关心具体配色。 */
const PLAIN_THEME: ThemeLike = { fg: (_token, text) => text };

const WIDTH = 72;

type Sample = { heading: string; note?: string; lines: string[] };

const samples: Sample[] = [];

type MessageCase = {
  kind: MessageKind;
  heading: string;
  toolName?: string;
  content: string[];
};

/** 各消息类型共用的样例内容。 */
const messageCases: MessageCase[] = [
  { kind: "user", heading: "用户消息", content: ["帮我把这个函数重构成纯函数"] },
  {
    kind: "assistant",
    heading: "助手回复（含代码块）",
    content: ["可以，我先确认它有没有副作用：", "", "```ts", "const sum = (a: number, b: number) => a + b;", "```"],
  },
  { kind: "thinking", heading: "思考块（展开态）", content: ["先看调用方是否依赖内部状态…", "再看边界条件。"] },
  { kind: "toolPending", heading: "工具调用（进行中）", toolName: "read", content: ["读取 src/index.ts …"] },
  { kind: "toolSuccess", heading: "工具调用（成功）", toolName: "edit", content: ["已修改 3 处"] },
  { kind: "toolError", heading: "工具调用（失败）", toolName: "bash", content: ["Exit code 1"] },
  { kind: "bash", heading: "Bash 执行", content: ["$ pnpm test", "✓ 78 passed"] },
  { kind: "custom", heading: "自定义消息", content: ["来自扩展的消息"] },
  { kind: "compaction", heading: "上下文压缩摘要", content: ["已把前 20 轮对话压缩为要点"] },
];

// ---------------------------------------------------------------------------
// minimal（锚点）风格 —— 当前默认
// ---------------------------------------------------------------------------

samples.push({
  heading: "minimal · 助手回复（裸排）",
  note: "minimal 下 assistant 正文原样输出（Pi 原生渲染），不加锚点、不画框",
  lines: ["可以，我先确认它有没有副作用：", "", "const sum = (a, b) => a + b;"],
});

samples.push({
  heading: "minimal · 用户消息（› 箭头锚点）",
  note: "minimal 下用户消息无框无背景：剥掉原生 userMessageBg 背景条，固定蓝色竖线引用块",
  lines: renderAnchoredMessage("user", ["帮我把这个函数重构成纯函数"], WIDTH, { theme: PLAIN_THEME }),
});

samples.push({
  heading: "minimal · 思考块（展开态）",
  lines: renderAnchoredMessage("thinking", ["先看调用方是否依赖内部状态…", "再看边界条件。"], WIDTH, {
    theme: PLAIN_THEME,
  }),
});

samples.push({
  heading: "minimal · 助手回复（assistantAnchor 开启）",
  lines: renderAssistantAnchorLine(PLAIN_THEME, ["测试全部通过。"]),
});

for (const item of [messageCases[2], messageCases[3], messageCases[4], messageCases[5], messageCases[6], messageCases[7], messageCases[8]]) {
  samples.push({
    heading: `minimal · ${item.heading}`,
    lines: renderAnchoredMessage(item.kind, item.content, WIDTH, {
      theme: PLAIN_THEME,
      toolName: item.toolName,
    }),
  });
}

samples.push({
  heading: "minimal · edit diff 语法高亮（diffHighlight 开启）",
  note: "增删行的 +/- 符号与行号保留语义色，代码内容经 Pi 官方 highlightCode 重新着色；上下文行透传保持弱化灰",
  lines: renderAnchoredMessage(
    "toolSuccess",
    transformEditDiffLines(
      "edit",
      { args: { path: "src/utils/diff.ts" } },
      [
        "edit src/utils/diff.ts",
        " 41 export function parseDiff(line: string) {",
        '-42   const parts = line.split(" ");',
        "+42   const parts = line.split(/\\s+/);",
        " 43   return { prefix: parts[0], rest: parts.slice(1) };",
        " 44 }",
      ],
      PLAIN_THEME,
    ),
    WIDTH,
    { theme: PLAIN_THEME, toolName: "edit" },
  ),
});

samples.push({
  heading: "minimal · 思考块（折叠态）",
  note: "hideThinkingBlock 为 true 时内容只有一行，自然只剩锚点行",
  lines: renderAnchoredMessage("thinking", ["正在分析调用链…"], WIDTH, { theme: PLAIN_THEME }),
});

samples.push({
  heading: "minimal · 窄终端降级（宽度 30）",
  note: "锚点行与 gutter 行都不超过给定宽度",
  lines: renderAnchoredMessage("toolSuccess", ["这一行比较长，用来观察折行与降级是否正确"], 30, {
    theme: PLAIN_THEME,
    toolName: "edit",
  }),
});

samples.push({
  heading: "minimal · 极窄终端回退（宽度 6）",
  note: "低于最小宽度时放弃锚点排版，只做截断",
  lines: renderAnchoredMessage("assistant", ["abcdefghij"], 6, { theme: PLAIN_THEME }),
});

// ---------------------------------------------------------------------------
// boxed（经典外框）风格 —— 兼容模式（/zxdl 面板可切回）
// ---------------------------------------------------------------------------

samples.push({
  heading: "boxed · 用户消息",
  note: "以下为 boxed 兼容风格；用户消息在任何风格下都用经典外框（与输入框线框呼应）",
  lines: renderMessageBox("user", ["帮我把这个函数重构成纯函数"], WIDTH, { theme: PLAIN_THEME }),
});

for (const item of messageCases.slice(1)) {
  samples.push({
    heading: `boxed · ${item.heading}`,
    lines: renderMessageBox(item.kind, item.content, WIDTH, {
      theme: PLAIN_THEME,
      toolName: item.toolName,
    }),
  });
}

samples.push({
  heading: "boxed · 思考块（折叠态：紧凑三行）",
  note: "hideThinkingBlock 为 true 时使用",
  lines: renderThinkingBox(["正在分析调用链…"], WIDTH, { theme: PLAIN_THEME }),
});

samples.push({
  heading: "boxed · 窄终端降级（宽度 30）",
  note: "外框必须保持闭合，内容按可用宽度折行",
  lines: renderMessageBox("assistant", ["这一行比较长，用来观察折行与外框闭合是否正确"], 30, {
    theme: PLAIN_THEME,
  }),
});

samples.push({
  heading: "boxed · 极窄终端回退（宽度 6）",
  note: "低于最小宽度时放弃画框，只做截断",
  lines: renderMessageBox("assistant", ["abcdefghij"], 6, { theme: PLAIN_THEME }),
});

// ---------------------------------------------------------------------------
// 保留项：输入框线框与底部状态栏（用户明确保留，基线守护其行为不变）
// ---------------------------------------------------------------------------

samples.push({
  heading: "输入框线框（默认：不显示模型名）【保留项】",
  lines: renderEditorFrame({
    editorLines: ["> 帮我把这个函数重构成纯函数"],
    width: WIDTH,
    theme: PLAIN_THEME,
    status: {},
  }),
});

samples.push({
  heading: "输入框线框（显示模型名 + thinking + 上下文）【保留项】",
  lines: renderEditorFrame({
    editorLines: ["> 继续"],
    width: WIDTH,
    theme: PLAIN_THEME,
    status: {
      model: "Atria-Dawn-Preview",
      thinking: "high",
      context: "━━━━━━────── 42% 256k",
    },
  }),
});

/** 状态栏样例：手动构造满段，用于固定「拼接 + 降级」的结构基线。 */
const BAR_SAMPLE: StatusBarSegment[] = [
  { id: "model", text: "model Atria-Dawn-Preview(high)" },
  { id: "path", text: "dir project" },
  { id: "git", text: "git main" },
  { id: "context", text: "ctx 18.8% (48k/256k)" },
  { id: "tokens", text: "tok 4.6k" },
  { id: "speed", text: "tps 18.4 tps" },
];

samples.push({
  heading: "底部状态栏（全段）【保留项】",
  note: "位于输入框下方；宽度不足时从右往左整段丢弃，永不截断段内文字",
  lines: [composeStatusBar(BAR_SAMPLE, 110)],
});

samples.push({
  heading: "底部状态栏（窄宽度降级）【保留项】",
  note: "宽度 70：先丢速度与 token，再丢上下文，保留模型 / 目录 / 分支",
  lines: [composeStatusBar(BAR_SAMPLE, 70)],
});

samples.push({
  heading: "启动画面 · 自定义 logo header【startup】",
  note: "ctx.ui.setHeader 接管后的开屏第一屏（前置：Pi quietStartup 已开启）；右列三行与 logo 第 2 行起对齐",
  lines: new ZxdlHeader({
    theme: PLAIN_THEME,
    isIdle: () => true,
    getResourceCounts: () => ({ tools: 27, commands: 34, skills: 3, mcp: 2 }),
  }).render(WIDTH),
});

samples.push({
  heading: "启动画面 · 窄终端降级（宽度 30）【startup】",
  lines: new ZxdlHeader({
    theme: PLAIN_THEME,
    isIdle: () => true,
    getResourceCounts: () => ({ tools: 27, commands: 34, skills: 3, mcp: 2 }),
  }).render(30),
});

// ---------------------------------------------------------------------------
// bash 单行呈现（ZCode 式）：运行中 spinner / 完成 / 失败 三态
// ---------------------------------------------------------------------------

const BASH_NATIVE_DONE = [
  "\x1b[36m\x1b[1m$ pnpm test\x1b[0m",
  "",
  "\x1b[2m  passed  78\x1b[0m",
  "\x1b[2m  failed  0\x1b[0m",
  "\x1b[2m  ... (9 earlier lines, ctrl+o to expand)\x1b[0m",
  "",
  "\x1b[2mTook 2.3s\x1b[0m",
];

samples.push({
  heading: "bash 单行 · 运行中（spinner 动态帧）【bash-inline】",
  note: "单行折叠：spinner 按时间片轮换（实机 1Hz 借力 Pi 的 Elapsed 重绘），输出预览运行中不显示",
  lines: renderBashInline({
    toolName: "bash",
    status: "pending",
    command: "pnpm test",
    nativeLines: [
      "\x1b[36m\x1b[1m$ pnpm test\x1b[0m",
      "",
      "\x1b[2m  running...\x1b[0m",
      "\x1b[2mElapsed 3.2s\x1b[0m",
    ],
    theme: PLAIN_THEME,
    width: WIDTH,
  }) ?? [],
});

samples.push({
  heading: "bash 单行 · 成功完成【bash-inline】",
  note: "命令收进摘要行（原生 toolTitle 蓝色整行被丢弃），耗时并入锚点；输出保留折叠预览并进 gutter",
  lines: renderBashInline({
    toolName: "bash",
    status: "success",
    command: "pnpm test",
    nativeLines: BASH_NATIVE_DONE,
    theme: PLAIN_THEME,
    width: WIDTH,
  }) ?? [],
});

samples.push({
  heading: "bash 单行 · 失败完成【bash-inline】",
  note: "× 锚点（error 色），错误输出原样保留",
  lines: renderBashInline({
    toolName: "bash",
    status: "error",
    command: "pnpm test",
    nativeLines: [
      "\x1b[36m\x1b[1m$ pnpm test\x1b[0m",
      "",
      "\x1b[2m  ✗ should merge cells (2ms)\x1b[0m",
      "\x1b[2m  exit code 1\x1b[0m",
      "",
      "\x1b[2mTook 2.3s\x1b[0m",
    ],
    theme: PLAIN_THEME,
    width: WIDTH,
  }) ?? [],
});

const parts: string[] = [
  "# 渲染基线",
  "",
  "> 本文件由 `npm run docs:baseline` 生成，**请勿手工编辑**。",
  "> 渲染逻辑改动后重跑脚本，`git diff` 即为视觉变化。",
  "> 基线使用纯文本主题，只反映结构与文本，不含配色。",
  "",
  `共 ${samples.length} 个样例，宽度基准 ${WIDTH} 列。`,
  "",
];

for (const sample of samples) {
  parts.push(`## ${sample.heading}`, "");
  if (sample.note) parts.push(`_${sample.note}_`, "");
  parts.push("```text", ...sample.lines, "```", "");
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "docs", "render-baseline.md");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${parts.join("\n")}\n`, "utf8");

console.log(`已生成 ${outPath}`);
console.log(`样例数：${samples.length}`);
