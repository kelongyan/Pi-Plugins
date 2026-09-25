# 致敬与许可说明

本项目在设计与算法层面参考了以下开源项目，均为 **MIT** 许可，在此致谢。

本项目对这些项目的参考属于**思路与算法的独立重写**，未整体复制其源码；个别工具函数若与参考实现高度一致，已在对应源文件头部注明出处。

---

## alps-pi

- 仓库：https://github.com/MrCKR/alps-pi
- 作者：MrCKR
- 许可：MIT
- 参考内容：
  - 消息对话框外框的边框拼装方式与**宽度降级链**（右标签截断 → 左标签截断 → 整体省略）
  - 思考过程动画的定义组织形式与帧驱动策略（单例计时器 + 活跃组件集合 + 空闲停表）
  - 输入框线框的信息嵌入方式（模型 / thinking 级别 / 上下文进度条）
  - "固定输入框"与"美化输入框"**必须完全独立**的分层原则
  - 终端控制序列净化（剥离 OSC / DCS / APC / PM 与非 SGR CSI）
  - 设置持久化的原子写与字段级合并策略

## pi-cc-extensions

- 仓库：https://github.com/minuque/pi-cc-extensions
- 作者：minuque
- 许可：MIT
- 参考内容：
  - `PatchRegistry` 的补丁所有权模型（`Symbol.for` + globalThis 槽位 + 所有权守卫删除）
  - "**只还原自己安装的补丁**"的回滚策略，保护第三方 wrapper 不被覆盖
  - 跨 `/reload` 的补丁接力语义（downstream 链接与旧补丁失效）
  - 配置单例的防御式规范化写法

## Eva-Theme

- 仓库：https://github.com/fisheva/Eva-Theme
- 作者：Justin Lu（fisheva）
- 许可：MIT
- 用途：本项目自带的 `eva-dark` / `eva-light` 主题，是把 Eva-Theme 的调色板
  **重新映射**到 Pi 的主题 roles 得到的。原主题面向 JetBrains / VSCode / Visual Studio。
- 映射范围：背景层次、前景、强调色、语法高亮色（关键字 / 函数 / 字符串 / 数字 / 类型 / 注释）、
  终端 ANSI 色，以及 diff 增删色。

---

## 未采纳的部分

参考项目中以下做法**未被采纳**，原因记录于此以便后续回溯：

- **包装 `tui.doRender` 做帧捕获以实现鼠标点击区域识别**（pi-cc-extensions）：
  超出 Pi 官方文档划定的边界（"Do not create a second terminal renderer inside an extension"），
  属于对内部渲染管线的侵入式依赖，在 Pi 升级时易碎。若日后确需鼠标交互，
  优先评估官方 `MouseRegion` 组件。
- **逐帧调用 `setHiddenThinkingLabel` 驱动动画**（已由 alps-pi 自身标记为禁忌）：
  Pi 会因此重建整段历史的 `AssistantMessage`，长对话下会造成严重卡顿。
