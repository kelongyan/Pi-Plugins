# pi-zxdl

Pi coding agent 的 TUI 增强扩展。三件事：

1. **消息对话框外框** — 让助手回复、用户消息、工具调用、Bash 执行在视觉上清晰分隔
2. **思考过程 UI** — 思考时播放动画，结束时给出明确的完成态
3. **输入框线框** — 输入框固定在底部并带线框，线框内嵌模型名 / thinking 级别 / 上下文进度

> 名字取自「扎西德勒」（Tashi Delek）。

## 当前状态

**P1 已完成** — 消息对话框外框（含思考过程框）已接入。底部输入框线框在 P3。

> **关于思考动画：本项目不做。** 思考块只有静态线框 —— 不引入帧驱动、计时器或多种动画效果。
> 这是与 alps-pi 的明确差异（它内置 21 种动画）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 项目骨架、补丁注册表、能力探测、配置持久化、生命周期编排 | ✅ 已完成 |
| P1 | 消息对话框外框（含思考过程框） | ✅ 已完成 |
| P2 | 思考过程动画 | ❌ 已取消（见下方说明） |
| P3 | 输入框线框（固定底部 + 指标嵌入） | ⏳ 待开始 |
| P4 | 设置面板 + 主题 | ⏳ 待开始 |
| P5 | 测试补齐 + 渲染基线 | ⏳ 待开始 |

## 安装

```bash
# 从本地路径
pi install ./F:/Pi-Plugins/pi-zxdl

# 或从 git
pi install git:https://github.com/<owner>/pi-zxdl
```

安装后 `/reload` 生效，用 `/zxdl` 查看状态。

## 要求

- Pi `>= 0.84.4`
- Node `>= 22.19.0`
- 输入框线框功能需要 Pi 的 `TUI mode: fullscreen`（在 `/settings` 中设置）

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
  message-frame/            P1：消息外框
    chrome.ts                 纯绘制：边框拼装、前景状态跟踪、宽度降级
    styles.ts                 kind → 主题 token 映射与标签
    patch.ts                  组件 render 包装（8 类消息组件）
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

### 三条设计原则

1. **补丁可回滚且幂等** — 所有 prototype 包装都带 `owner + version` 元数据，卸载时只还原自己装的那一个，绝不复原第三方的 wrapper
2. **能力探测后 fail-closed** — Pi 内部结构一旦不匹配，关闭对应功能但**保留用户偏好设置**
3. **不越官方边界** — 不自建第二套终端渲染器（`docs/tui.md` 明确禁止）；替换输入框继承官方 `CustomEditor`

## 致敬

设计参考了 [alps-pi](https://github.com/MrCKR/alps-pi)（MIT）与 [pi-cc-extensions](https://github.com/minuque/pi-cc-extensions)（MIT）。
详见 [NOTICE.md](./NOTICE.md)。

## 许可

MIT
