/**
 * 消息外框功能模块。
 *
 * 对外只暴露 install / 类型，内部的绘制与包装细节不泄漏给装配层。
 */

export { renderMessageBox, renderThinkingBox, isEmptyMessage, MIN_BOX_WIDTH } from "./chrome.ts";
export {
  applyZoneMarkers,
  expectedSegmentKinds,
  groupContentChildren,
  renderAssistantSegments,
  type SegmentGroup,
  type SegmentKind,
} from "./segments.ts";
export {
  FRAME_STYLES,
  frameLabel,
  frameStyle,
  resolveStyleKind,
  type FrameStyle,
  type MessageKind,
  type ThemeLike,
  type ToolStatus,
} from "./styles.ts";
export { installMessageFrame, type MessageFrameHandle } from "./patch.ts";
