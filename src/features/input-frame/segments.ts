/**
 * 线框顶边的状态段系统。
 *
 * 设计借鉴 pi-powerline-footer（MIT, nicobailon）的核心模式：
 * - 段是纯函数产物：要么给出**已着色的文本**，要么为 null（不可见）
 * - 渲染全程同步，异步数据（如 git）在渲染前已缓存好，渲染时只读
 * - 宽度不足时**整段丢弃**，绝不把一个段截成一半
 *
 * 与 powerline 的差异：这里只支持单行、单侧排列，没有左右分栏与第二行 ——
 * 因为目标是把内容嵌进输入框的顶边框里，宽度极其有限。
 */

import { visibleWidth } from "@earendil-works/pi-tui";

/** 段之间的分隔符。 */
export const SEGMENT_SEPARATOR = " · ";

export type FrameSegmentId = "model" | "thinking" | "path" | "git" | "context";

export type FrameSegment = {
  id: FrameSegmentId;
  /** 已着色的文本。空字符串等同于不可见。 */
  text: string;
};

export type ComposeResult = {
  /** 拼接后的文本（不含分隔符上下文之外的装饰）。 */
  text: string;
  /** 实际占用的显示宽度。 */
  width: number;
  /** 因宽度不足被丢弃的段 id，按丢弃顺序（先丢的在前）。 */
  dropped: FrameSegmentId[];
};

/**
 * 按顺序把段装入预算内。
 *
 * 装不下时从**末尾**开始丢弃（数组顺序即优先级，越靠前越优先保留），
 * 直到能装下为止。空文本的段直接忽略，不产生多余分隔符。
 */
export function composeSegments(segments: readonly FrameSegment[], budget: number): ComposeResult {
  const active = segments.filter((segment) => segment.text.length > 0);
  const dropped: FrameSegmentId[] = [];
  const limit = Number.isFinite(budget) ? Math.max(0, Math.floor(budget)) : 0;

  while (active.length > 0) {
    const text = active.map((segment) => segment.text).join(SEGMENT_SEPARATOR);
    const width = visibleWidth(text);
    if (width <= limit) return { text, width, dropped };

    const removed = active.pop();
    if (removed) dropped.push(removed.id);
  }

  return { text: "", width: 0, dropped };
}
