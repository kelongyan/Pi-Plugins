# pi-zxdl

Pi coding agent 的 TUI 增强扩展。三件事：

1. **消息对话框外框** — 让助手回复、用户消息、工具调用、Bash 执行在视觉上清晰分隔
2. **思考过程线框** — 思考内容带独立外框（折叠态紧凑三行，展开态完整内容），**静态无动画**
3. **输入框线框** — 底部输入框带线框（顶边可选显示 thinking 与上下文）
4. **底部状态栏** — 输入框下方一行：模型 / 目录 / 分支 / 上下文 / 费用 / 速度

> 名字取自「扎西德勒」（Tashi Delek）。

## 当前状态

**P5 已完成** — 线框、设置面板、自带 Eva 主题、渲染基线全部就绪（尚未发布到 npm）。

> **关于思考动画：本项目不做。** 思考块只有静态线框 —— 不引入帧驱动、计时器或多种动画效果。
> 这是与 alps-pi 的明确差异（它内置 21 种动画）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 项目骨架、补丁注册表、能力探测、配置持久化、生命周期编排 | ✅ 已完成 |
| P1 | 消息对话框外框（含思考过程框） | ✅ 已完成 |
| P2 | 思考过程动画 | ❌ 已取消（本项目不做动画） |
| P3 | 输入框线框（模型 / thinking / 上下文嵌入） | ✅ 已完成 |
| P4 | 设置面板（overlay）+ 自带 Eva 主题 | ✅ 已完成 |
| P5 | 测试补齐 + 渲染基线 + 发布说明 | ✅ 已完成 |

## 安装

```bash
# 从本地路径
pi install ./F:/Pi-Plugins/pi-zxdl

# 或从 git
pi install git:https://github.com/kelongyan/Pi-Plugins
```

安装后 `/reload` 生效。命令：

```
/zxdl           打开设置面板（↑↓ 选择 · Enter/空格 切换 · Esc 关闭）
/zxdl status    查看当前状态与能力探测
/zxdl help      显示帮助
```

设置面板的改动**即时生效并自动持久化**，不需要重启。

## 自带 Eva 主题

打包了两套主题：`eva-dark` 与 `eva-light` —— 由 [Eva-Theme](https://github.com/fisheva/Eva-Theme)（MIT）的调色板映射到 Pi 的主题 roles。

**安装即启用**：首次启动时，如果当前主题仍是 Pi 自带的 `dark` / `light`，会自动切到 `eva-light/eva-dark`（跟随终端明暗）；自动模式不被接受时退回 `eva-dark`。

如果你手动选过任何其它主题，插件**不再干预** —— 避免「改完又被改回去」。想换回来用 `/settings` → Theme。

## 要求

- Pi `>= 0.84.4`
- Node `>= 22.19.0`
- 输入框线框需要 Pi 的 `TUI mode: fullscreen`（在 `/settings` 中设置）

## 开发

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # 单元测试
npm run docs:baseline # 重新生成渲染视觉回归基线
```

渲染基线在 `docs/render-baseline.md`：由固定输入渲染而成。改动渲染逻辑后重跑脚本，`git diff` 就是视觉变化。

## 发布

当前**仅供本地安装**（`pi install <本地路径>`），**尚未发布到 npm**。

发布前需要：

1. 去掉 `package.json` 里的 `"private": true`
2. 递增 `version`
3. `npm run typecheck && npm test` 全绿
4. `npm publish --access public`

## 架构

```
index.ts                    入口，只做装配
src/core/
  theme.ts                  主题读取与安全取色的统一入口
  patch-keys.ts             Symbol 槽位单一来源（跨 reload 稳定）
  patch-registry.ts         补丁槽位的所有权生命周期
  method-patch.ts           可回滚、幂等的 prototype 方法包装
  pi-compat.ts              Pi 内部依赖的唯一集中点 + 能力探测（fail-closed）
  session.ts                会话资源栈 + TUI 资源所有权令牌
src/settings/
  schema.ts                 配置结构、默认值、防御式规范化
  store.ts                  原子写 + 只动自身命名空间
src/commands.ts             /zxdl 状态命令
src/utils/
  terminal-sanitizer.ts     剥离非 SGR 控制序列（安全边界）
  width.ts                  宽度安全工具（visibleWidth / padToWidth）
  image-escape.ts           Kitty / iTerm 图片协议行识别
src/features/
  message-frame/            P1：消息外框（唯一使用 patch 的功能）
    chrome.ts                 纯绘制：边框拼装、前景状态跟踪、宽度降级
    styles.ts                 kind → 主题 token 映射与标签
    patch.ts                  组件 render 包装（8 类消息组件）
  input-frame/              P3/P6：输入框线框 + 底部状态栏（无 patch，全走公开 API）
    frame.ts                  线框绘制 + 标签降级（保护 CURSOR_MARKER）
    status.ts                 线框顶边数据：thinking / 上下文
    status-bar.ts             底部状态栏：段定义 + 组装 + 宽度降级
    session-stats.ts          费用累计 + 流式速度跟踪
    git-status.ts             git 分支的同步读取 + 后台刷新
    editor.ts                 继承官方 CustomEditor，只覆盖 render
    runtime.ts                setEditorComponent 挂载 + generation 隔离
```

### P1 覆盖的消息类型

| 类型 | 标签 | 边框 token |
|---|---|---|
| 用户消息 | `USER` | borderAccent |
| 助手回复 | `ASSISTANT` | borderMuted |
| 思考过程 | `THINK` | borderMuted |
| 工具调用 | `TOOL <名字> ✓/✗` | success / error / borderAccent |
| Bash 执行 | `BASH` | success / error / borderAccent |
| 自定义 / 技能 / 压缩 / 分支 | `CUSTOM` / `SKILL` / `COMPACT` / `BRANCH` | 见 styles.ts |

思考过程有两种呈现：**折叠时**用紧凑三行框（只有一行摘要），**展开时**用完整内容框。两者都是**静态**的，不含任何动画。

### P3 输入框线框

线框顶边**默认不显示任何状态** —— 状态信息统一由底部状态栏承担，避免同一信息在两处重复。

需要时可用 `inputFrame.showModel` / `showThinking` / `showContext` 单独打开（例如关掉状态栏、只想要线框自带状态）。
取不到的数据段**直接隐藏，不留空占位**；窄终端按「先裁右标签 → 再裁左标签 → 整体省略」降级，保证外框永不破。

实现要点：

- 继承官方 `CustomEditor`，**只覆盖 `render`** —— 输入、补全、历史、粘贴等语义全部保留父类行为
- 内容行截断时**保护 `CURSOR_MARKER`**，否则 IME 候选窗与光标会错位
- 弹出内容（autocomplete / select-list）保持在线框之外
- **完全不用 patch**，只走 `ctx.ui.setEditorComponent` 这一个公开 API
- 切会话递增 generation，过期 factory 返回 `undefined` 主动放弃接管
- 卸载时只在 editor 仍由本插件持有时才清除，绝不覆盖第三方

### 底部状态栏

输入框**下方**独占一行，显示 6 个信息段：

    ╭──────────────────────────────────────╮
    │ > 输入内容                           │
    ╰──────────────────────────────────────╯
     🎨 claude-sonnet(high) │ 📘 proj │ ᛘ main │ 💾 18.8% (48k/256k) │ $0.32 │ ⚡ 18.4 tps

- **位置**：接管 Pi 的 **footer**（`ctx.ui.setFooter`）—— Pi 原生 footer 同样渲染 cwd / 上下文 / 模型 / thinking，不接管就会在同一位置重复显示
- **段顺序即优先级**：宽度不足时从右往左整段丢弃（先丢速度、再丢费用……），**永不截断段内文字**
- **图标**：默认 emoji，可切 `plain`（emoji 宽 2 列，某些终端会影响对齐）
- **数据来源**：模型 / thinking / 上下文来自 `ctx`；目录来自 `ctx.cwd`；git 由子进程异步查询（超时 300ms、失败保留旧值不闪烁）；费用从 session 累计；速度由流式事件统计（空闲时保留上一次的值）
- **与线框独立**：线框走 editor、状态栏走 footer，两者互不影响（关掉线框，状态栏照常显示）

### 三条设计原则

1. **补丁可回滚且幂等** — 所有 prototype 包装都带 `owner + version` 元数据，卸载时只还原自己装的那一个，绝不复原第三方的 wrapper
2. **能力探测后 fail-closed** — Pi 内部结构一旦不匹配，关闭对应功能但**保留用户偏好设置**
3. **不越官方边界** — 不自建第二套终端渲染器（`docs/tui.md` 明确禁止）；替换输入框继承官方 `CustomEditor`

## 致敬

设计参考了 [alps-pi](https://github.com/MrCKR/alps-pi)（MIT）与 [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions)（MIT）。
详见 [NOTICE.md](./NOTICE.md)。

## 许可

MIT
