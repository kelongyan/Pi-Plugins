# pi-zxdl

Pi coding agent 的 TUI 增强扩展。三件事：

1. **消息对话框外框** — 让助手回复、用户消息、工具调用、Bash 执行在视觉上清晰分隔
2. **思考过程线框** — 思考内容带独立外框（折叠态紧凑三行，展开态完整内容），**静态无动画**
3. **输入框线框** — 底部输入框带线框，内嵌 thinking 级别与上下文进度（模型名可选，默认关）

> 名字取自「扎西德勒」（Tashi Delek）。

## 当前状态

**P4 已完成** — 线框全部接入，并提供了 `/zxdl` 设置面板（改动即时生效、自动持久化）。

> **关于思考动画：本项目不做。** 思考块只有静态线框 —— 不引入帧驱动、计时器或多种动画效果。
> 这是与 alps-pi 的明确差异（它内置 21 种动画）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 项目骨架、补丁注册表、能力探测、配置持久化、生命周期编排 | ✅ 已完成 |
| P1 | 消息对话框外框（含思考过程框） | ✅ 已完成 |
| P2 | 思考过程动画 | ❌ 已取消（本项目不做动画） |
| P3 | 输入框线框（模型 / thinking / 上下文嵌入） | ✅ 已完成 |
| P4 | 设置面板（overlay）+ 自带 Eva 主题 | ✅ 已完成 |
| P5 | 测试补齐 + 渲染基线 | ⏳ 待开始 |

## 安装

```bash
# 从本地路径
pi install ./F:/Pi-Plugins/pi-zxdl

# 或从 git
pi install git:https://github.com/<owner>/pi-zxdl
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
npm run typecheck   # tsc --noEmit
npm test            # node --test tests/**/*.test.ts
```

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
  input-frame/              P3：底部输入框线框（无 patch，全走公开 API）
    frame.ts                  线框绘制 + 标签降级（保护 CURSOR_MARKER）
    status.ts                 模型名 / thinking / 上下文进度
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

线框顶边右侧显示上下文进度（形如 `────────── 21% 200k`），左侧可选显示 thinking 级别。

**模型名默认不显示** —— 它通常已由状态栏 / footer 呈现，避免重复；需要时把 `inputFrame.showModel` 设为 `true` 即可。
取不到的数据段**直接隐藏，不留空占位**；窄终端按「先裁右标签 → 再裁左标签 → 整体省略」降级，保证外框永不破。

实现要点：

- 继承官方 `CustomEditor`，**只覆盖 `render`** —— 输入、补全、历史、粘贴等语义全部保留父类行为
- 内容行截断时**保护 `CURSOR_MARKER`**，否则 IME 候选窗与光标会错位
- 弹出内容（autocomplete / select-list）保持在线框之外
- **完全不用 patch**，只走 `ctx.ui.setEditorComponent` 这一个公开 API
- 切会话递增 generation，过期 factory 返回 `undefined` 主动放弃接管
- 卸载时只在 editor 仍由本插件持有时才清除，绝不覆盖第三方

### 三条设计原则

1. **补丁可回滚且幂等** — 所有 prototype 包装都带 `owner + version` 元数据，卸载时只还原自己装的那一个，绝不复原第三方的 wrapper
2. **能力探测后 fail-closed** — Pi 内部结构一旦不匹配，关闭对应功能但**保留用户偏好设置**
3. **不越官方边界** — 不自建第二套终端渲染器（`docs/tui.md` 明确禁止）；替换输入框继承官方 `CustomEditor`

## 致敬

设计参考了 [alps-pi](https://github.com/MrCKR/alps-pi)（MIT）与 [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions)（MIT）。
详见 [NOTICE.md](./NOTICE.md)。

## 许可

MIT
