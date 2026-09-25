/**
 * 输入框线框 + 底部状态栏功能模块。
 *
 * 对外暴露装配所需的 install / 运行时；绘制与数据读取细节不泄漏。
 */

export {
  MIN_FRAME_WIDTH,
  renderEditorFrame,
  type EditorFrameStatus,
  type RenderEditorFrameInput,
} from "./frame.ts";
export {
  buildFrameStatus,
  formatTokens,
  readContextUsage,
  readCwd,
  readModelName,
  readThinkingLevel,
  shortenModelName,
  shortenPath,
  type ContextUsage,
  type InputFrameSettingsLike,
} from "./status.ts";
export {
  buildStatusBarSegments,
  composeStatusBar,
  segmentIcon,
  STATUS_SEPARATOR,
  type StatusBarIconStyle,
  type StatusBarSegment,
  type StatusBarSegmentId,
  type StatusBarSegmentSettings,
} from "./status-bar.ts";
export { formatCost, formatSpeed, readSessionCost, StreamSpeedTracker } from "./session-stats.ts";
export { readGitBranch, resetGitBranchCache } from "./git-status.ts";
export { createFramedEditor, isNativeEditorRule, splitNativeEditorRender } from "./editor.ts";
export {
  InputFrameRuntime,
  type EditorFactory,
  type InputFrameRuntimeDeps,
  type InputFrameRuntimeSettings,
} from "./runtime.ts";
