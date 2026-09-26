# bash 运行命令的 ZCode 式单行 UI 方案

> 目标：把 agent 运行 shell 命令（bash / powershell 工具）时的呈现改成 ZCode 对话流风格——
> 运行中一行折叠 + 左侧加载动画，完成后一行摘要 + 输出保持折叠可展开。
> 参考：用户提供的 ZCode 截图（`🔍 查阅 · 正在执行 sed -n '40,130p' ...` 条目形态）。

## 一、现状与"纯蓝"根因

Pi 原生 shell 渲染器（`core/tools/renderers/bash.js`）的命令行是：

```js
theme.fg("toolTitle", theme.bold(`${prompt} ${command}`))   // prompt = "$"
```

整行 **toolTitle 色 + 加粗**，Eva 主题里 `toolTitle = func`（蓝）——这就是整个命令一片蓝的来源。
当前 minimal 锚点模式下的实际呈现：

```
│ ● bash
│ $ pnpm test              ← 整行蓝色加粗（丑点）
│
│   输出预览 5 行...
│   ... (N earlier lines, ctrl+o to expand)
│
│ Elapsed 3.2s             ← 运行中每秒刷新（Pi 自带 1Hz 重绘）
```

命令行、锚点行、耗时行三处重复表达状态，且命令行视觉权重过高。

## 二、目标设计（ZCode 式）

**运行中**（单行，动态）：

```
⠹ bash · 正在执行 pnpm test · 3.2s
```

- 左侧 braille spinner（⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏，accent 色）随时间片轮换
- `正在执行` + 命令第一行（超宽截断，muted 与 text 分色）
- 耗时取自 Pi 原生 `Elapsed` 行（解析后并入，muted）

**成功完成**（命令折叠进摘要行，输出保留折叠预览）：

```
✓ bash · pnpm test · 2.3s

  输出预览 5 行...
  ... (12 earlier lines, ctrl+o to expand)
  [Full output: ...]         ← 有截断警告时保留（warning 色）
```

**失败完成**：

```
× bash · pnpm test · 1m 2s

  错误输出预览...（原样保留）
```

要点：
- 蓝色命令行**整行消失**，命令文本收进摘要行（text 色，提示符语义由 `·` 分隔承担）
- 输出区维持 Pi 原生折叠机制（5 行预览 + ctrl+o 展开）——不牺牲可查性
- 其他工具（read/edit/grep…）保持现有 `●` 锚点呈现，只有 shell 类工具升级

## 三、关键约束（诚实说明）

**spinner 帧率 = 1Hz（每秒跳一格）**。扩展没有主动重绘 API（Tui 实例无全局挂载、
门面无 requestRender），动画驱动只能借 Pi 自身的重绘时机——bash renderer 运行中
恰好每秒 invalidate 一次（刷 Elapsed），我们的 render 跟随被调，spinner 按时间片
`floor(Date.now()/120) % 10` 取帧。1Hz 的 braille 旋转 + 实时 Elapsed 数字，
动态感可辨认但不如 ZCode（GUI 60fps）丝滑。若实测觉得慢，二期可研究用
`ctx.ui.setStatus` 定时调用作为额外重绘驱动（副作用可控后再上）。

## 四、实现路径（纯插件层，零 patch 新增）

1. 新增 `src/features/message-frame/bash-inline.ts`：
   - 输入：Pi 原生 render 输出行 + `instance`（args.command / toolName / status）
   - 原生行分类（剥 ANSI 后匹配）：命令行（`$` 前缀）→ 丢弃重绘；`Elapsed|Took` 行 → 解析时长；
     折叠提示/警告/输出预览 → 保留；识别失败的行 → 整体回退现有锚点呈现（fail-closed）
   - 输出：重组后的行组（见上）
2. `patch.ts` minimal 工具路径加 shell 特例分支：`toolName ∈ {bash, powershell}` 时
   走 `renderBashInline`；`args.command` 缺失或解析异常一律回退现有呈现
3. 用户 `!` 手动命令（BashExecutionComponent）不在本期范围，保持现状
4. 版本 0.5.0，status 文案同步；不加新开关（minimal 下默认生效，"bash 保留外框"开关仍是逃生门）

## 五、决策点（审核时拍板）

| 决策点 | 推荐 | 备选 |
| --- | --- | --- |
| 运行中是否保留实时输出尾行 | **纯一行**（贴 ZCode；卡住的命令看 Pi 顶部 working indicator） | 一行 + 最新输出 1 行（防命令交互卡住时全盲） |
| 完成后输出 | 保留折叠预览 5 行（推荐） | 完全折叠成 `· N 行输出`（更极简，但看输出只能 ctrl+o） |

## 六、验证

单测（行分类解析 / 帧轮换 / args 缺失回退 / 耗时解析）+ 基线样例（运行中/成功/失败三态）
+ 实机跑一条 `pnpm test` 观察动态效果。
