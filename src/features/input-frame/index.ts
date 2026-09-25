/**
 * 输入框线框功能模块。
 *
 * 对外暴露装配所需的 install / 运行时；绘制与状态读取细节不泄漏。
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
export { createFramedEditor, isNativeEditorRule, splitNativeEditorRender } from "./editor.ts";
export { InputFrameRuntime, type EditorFactory } from "./runtime.ts";
export {
  composeSegments,
  SEGMENT_SEPARATOR,
  type ComposeResult,
  type FrameSegment,
  type FrameSegmentId,
} from "./segments.ts";
export { readGitBranch, resetGitBranchCache } from "./git-status.ts";
