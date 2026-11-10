import { copyText, toast } from '../shared/utils.js';

const QUEUE_BOTTOM_HOLD_MS = 750;
const QUEUE_WHEEL_GESTURE_GAP_MS = 180;

// 将 wheel 事件的 deltaY 归一化为像素值（Windows 普通鼠标报告行模式 deltaMode=1）
function normalizedWheelDelta(event, el) {
  switch (event.deltaMode) {
    case 1:
      return event.deltaY * 40; // 行模式：行高约 40px
    case 2:
      return event.deltaY * el.clientHeight; // 页模式：按容器高度换算
    default:
      return event.deltaY; // 像素模式：直接使用
  }
}

// 触底后缓冲当前滚动；停顿后的新手势可以提前交给页面。
export function bindQueueWheel(list) {
  if (!list) return;
  const panel = list.closest('.queue-panel') || list;
  let bottomReleaseAt = null;
  let lastWheelAt = null;
  const onWheel = (event) => {
    const delta = normalizedWheelDelta(event, list);
    if (delta === 0) return;
    const now = event.timeStamp;
    const newGesture = lastWheelAt !== null && now - lastWheelAt >= QUEUE_WHEEL_GESTURE_GAP_MS;
    lastWheelAt = now;
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    if (delta > 0 && maxScrollTop > 0 && list.scrollTop >= maxScrollTop) {
      if (bottomReleaseAt === null) bottomReleaseAt = now + QUEUE_BOTTOM_HOLD_MS;
      else if (newGesture) bottomReleaseAt = now;
      if (now < bottomReleaseAt) event.preventDefault();
      return;
    }

    bottomReleaseAt = null;
    const canScroll =
      maxScrollTop > 0 && (delta < 0 ? list.scrollTop > 0 : delta > 0 && list.scrollTop < maxScrollTop);
    if (!canScroll) return;

    event.preventDefault();
    list.scrollTop += delta * 0.3;
    if (delta > 0 && list.scrollTop >= maxScrollTop) bottomReleaseAt = now + QUEUE_BOTTOM_HOLD_MS;
  };
  panel.addEventListener('wheel', onWheel, { passive: false });
  return () => panel.removeEventListener('wheel', onWheel);
}

export function bindQueueCopyButtons(list, successMessage) {
  list.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await copyText(button.dataset.copy);
        toast(successMessage);
      } catch (_) {
        toast('复制失败，请重试');
      }
    });
  });
}
