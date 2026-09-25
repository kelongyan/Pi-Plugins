/**
 * 生成渲染基线样例（用于视觉回归）。
 *
 * 用固定输入渲染各类外框，把结果写成 markdown 入库 ——
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
import { renderMessageBox, renderThinkingBox } from "../src/features/message-frame/chrome.ts";
import type { MessageKind } from "../src/features/message-frame/styles.ts";

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

for (const item of messageCases) {
  samples.push({
    heading: item.heading,
    lines: renderMessageBox(item.kind, item.content, WIDTH, {
      theme: PLAIN_THEME,
      toolName: item.toolName,
    }),
  });
}

samples.push({
  heading: "思考块（折叠态：紧凑三行）",
  note: "hideThinkingBlock 为 true 时使用",
  lines: renderThinkingBox(["正在分析调用链…"], WIDTH, { theme: PLAIN_THEME }),
});

samples.push({
  heading: "输入框线框（默认：不显示模型名）",
  lines: renderEditorFrame({
    editorLines: ["> 帮我把这个函数重构成纯函数"],
    width: WIDTH,
    theme: PLAIN_THEME,
    status: {},
  }),
});

samples.push({
  heading: "输入框线框（显示模型名 + thinking + 上下文）",
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
  heading: "底部状态栏（全段）",
  note: "位于输入框下方；宽度不足时从右往左整段丢弃，永不截断段内文字",
  lines: [composeStatusBar(BAR_SAMPLE, 110)],
});

samples.push({
  heading: "底部状态栏（窄宽度降级）",
  note: "宽度 70：先丢速度与 token，再丢上下文，保留模型 / 目录 / 分支",
  lines: [composeStatusBar(BAR_SAMPLE, 70)],
});

samples.push({
  heading: "窄终端降级（宽度 30）",
  note: "外框必须保持闭合，内容按可用宽度折行",
  lines: renderMessageBox("assistant", ["这一行比较长，用来观察折行与外框闭合是否正确"], 30, {
    theme: PLAIN_THEME,
  }),
});

samples.push({
  heading: "极窄终端回退（宽度 6）",
  note: "低于最小宽度时放弃画框，只做截断",
  lines: renderMessageBox("assistant", ["abcdefghij"], 6, { theme: PLAIN_THEME }),
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
