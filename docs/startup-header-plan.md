# pi-zxdl 启动画面改造方案

> 目标：Pi 打开时隐藏原生启动信息流（版本横幅、快捷键、`[Skills]/[Prompts]/[Extensions]/[Themes]` 资源列表），
> 换成「像素 logo + 版本 + 精简提示 + ready 状态」的自定义 header，资源信息以一行计数简洁展示。
> 参考效果：pi-open-tui README 预览图（用户提供的图一）。
>
> 红线：全程只调用 Pi 官方导出 API 与插件自身配置，不改 Pi 源码、不碰 Pi 设置文件。

## 一、现状根因（图二的每一行从哪来）

| 图二内容 | 来源 | 能否官方关闭 |
| --- | --- | --- |
| `pi v0.87.1` + 快捷键行 + `Press ctrl+o ...` + `Pi can explain ...` | Pi 原生 `builtInHeader`（interactive-mode.js 680-720 行） | ✅ `quietStartup` 设置 |
| `[Skills] [Prompts] [Extensions] [Themes]` 列表 | Pi 原生 `showLoadedResources()`（独立容器 `loadedResourcesContainer`） | ✅ 同上（`showListing` 条件） |
| `memory_search requires qmd ...` 大段安装提示 | **pi-memory 扩展**自己输出的，不是 Pi 原生 | 装 qmd 后自然消失，或禁用 pi-memory |

关键结论：**Pi 官方就有 `quietStartup` 设置**（settings-manager.js 693 行，`/settings` 面板可见）。
开启后横幅整个退化为空组件、资源列表不再渲染。这是"屏蔽"的正解——零 patch。

## 二、实现方案（三层）

### 第 1 层：屏蔽原生信息（Pi 官方设置，用户手动开启）

引导开启 `quietStartup`（`/settings` 面板选择 Quiet startup，或在 Pi settings.json 加 `"quietStartup": true`）。
插件**不代改** Pi 的设置文件——官方开关让用户自己拨，符合边界。插件在 `/zxdl status` 里检测不到该设置
（扩展 API 不暴露），因此在方案落地后的 status 输出与 README 中写明前置条件即可。

### 第 2 层：自定义 header（官方 API `ctx.ui.setHeader`）

**这是本方案的核心，且完全在官方扩展契约内**：

- Pi 门面 `createExtensionUIContext()` 直接暴露 `setHeader(factory)`（interactive-mode.js 1995 行），
  内部走 `setExtensionHeader`：用自定义组件**同槽位替换**原生 `builtInHeader`，
  传 `undefined` 恢复原生。pi-open-tui 正是用它（`installHeader`），无需任何内存补丁。
- 能力探测：`typeof ctx.ui.setHeader === "function"`，缺失则 fail-closed 跳过（并入现有 capabilities 机制）。

**ZxdlHeader 组件**（实现 pi-tui `Component` 接口：`render(width)` / `invalidate()` / `dispose()`），
布局对齐图一：

```
█▀▀▀▀▀█   Pi v0.87.1
█ ███ █   / commands · ! bash · ctrl+o more
█▄▄▄▄▄█   ● ready

◆ Resources · tools 19 · commands 12
```

- **logo**：静态像素画（π 字形，与图一同源），用全块字符 `██` 按坐标矩阵定义
  （参考 pi-open-tui 的 `hasCell`/`hasPiece` 坐标法），配色走 Eva 主题 token（accent/muted）。
  二期可加开屏帧动画（pi-open-tui 有现成帧序列实现可借鉴）。
- **版本号**：`VERSION` 常量直接从 `@earendil-works/pi-coding-agent` 官方导出 import。
- **快捷键行**：固定文案 `/ commands · ! bash · ctrl+o more`（Pi 默认键位，dim/muted 色）。
- **ready 行**：`ctx.isIdle()` → 空闲显示 `● ready`（绿），流式工作中显示 `● working`；
  组件每次重渲染时读取，状态自动刷新。
- **Resources 行**：图一中 `system/context/skills/extensions/themes` 计数来自 Pi 内部
  `session.resourceLoader`，**扩展 API 拿不到**；扩展侧可得的是
  `pi.getAllTools()`（工具数）与 `pi.getCommands()`（命令数）。
  首版展示 `◆ Resources · tools N · commands M`，如实、不造数；
  若后续 Pi 把 resourceLoader 开放给扩展再补全。
- **装卸**：`session_start` → `ctx.ui.setHeader(factory)`；`session_shutdown` / 面板关闭 →
  `ctx.ui.setHeader(undefined)`。handle 纳入现有 ResourceStack 统一释放。

### 第 3 层：与现有功能的关系

- 底部状态栏（保留项）不动：header 只承担开屏第一屏，model/path/git/context/tokens/speed 仍在状态栏。
- 设置：`ZxdlSettings` 新增 `startup: { enabled: boolean }`（默认开），`/zxdl` 面板加
  "自定义启动画面" toggle，status 显示一行。
- 非 TUI 模式（rpc/json/print）不装（复用 `isTuiSessionContext` 守卫）。
- 若 quietStartup 未开启：原生横幅会与自定义 header **叠加显示**——因此面板 toggle 的
  label 附注"需开启 Pi Quiet startup"，README 写明步骤。

## 三、风险与边界

| 风险 | 处置 |
| --- | --- |
| quietStartup 未开导致双重横幅 | 文档 + 面板附注引导；不改 Pi 设置文件 |
| pi-open-tui 等其他 header 扩展抢占 | setHeader 后装者赢；本插件与它二选一 |
| 组件异常拖垮渲染 | render 全程 try/catch，异常时回退一行纯文本 `Pi vX` |
| Pi 升级变更 Component 接口 | 探测 + fail-closed，与现有 pi-compat 机制同风格 |
| 图一的 skills/themes 计数拿不到 | 展示扩展可得项（tools/commands），不 hack 内部状态 |

## 四、工作量与验证

- 新增 `src/features/startup-header/`（header 组件 + logo 定义 + 装卸）约 250 行；
  settings 三件套、commands、index 装卸各小改；版本升 0.4.0。
- 验证：单测（render 宽度降级 / isIdle 状态 / setHeader 装卸 / fail-closed）+ 渲染基线样例
  + 实机截图（vision-bridge 精读）对齐图一布局。

## 五、决策记录

1. 屏蔽走 Pi 官方 `quietStartup`，不 patch `loadedResourcesContainer` —— 官方开关存在，patch 是多余风险。
2. header 走官方 `ctx.ui.setHeader`，不 patch `headerContainer` —— 同槽位替换是官方契约行为。
3. Resources 计数只展示扩展 API 可得项 —— 不读 Pi 内部状态，保证升级兼容。
4. logo 首版静态，动画二期 —— 先满足"有 logo"的核心诉求。
