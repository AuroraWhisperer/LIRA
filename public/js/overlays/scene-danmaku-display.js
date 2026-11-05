import { isFloatingDanmakuStyle, isRandomDanmakuStyle } from '../shared/danmaku-style-options.js';
import { applyRoomGuardState } from '../shared/bilibili-guard-icons.js';

export function createSceneDanmakuDisplay({ clear, append, remove = () => {}, status, getStyle, room = () => {}, showWelcomeMessages = () => true }) {
  let epoch = null;
  let session = null;
  let sequence = 0;
  function update(snapshot) {
    if (!snapshot) return;
    applyRoomGuardState(snapshot.state?.roomGuard);
    room(snapshot.state?.roomGuard?.roomId || '', snapshot.roomProfile ?? null);
    const liveState = snapshot.status === 'connected' && [0, 1].includes(snapshot.state?.liveStatus);
    const nextSession = liveState && snapshot.state.liveStatus === 1
      ? snapshot.state.liveSessionId : null;
    // Cursor resets recover delivery; only owner/session changes clear visible history.
    const changed = snapshot.epoch !== epoch || liveState && nextSession !== session;
    if (changed) {
      clear();
      if (nextSession && snapshot.state.confirmationMessage) append({ id: `scene-confirm-${++sequence}`,
        kind: 'system', name: 'LIRA SYSTEM', message: snapshot.state.confirmationMessage, timestamp: Date.now() });
    }
    epoch = snapshot.epoch;
    if (changed || liveState) session = nextSession;
    const receiving = Boolean(nextSession);
    status(snapshot.gap && receiving ? '消息有缺口 · 已从当前直播继续' : receiving ? '直播中 · 弹幕接收中' : '等待直播数据', receiving);
    if (!receiving) return;
    for (const event of snapshot.events || []) {
      if (event.liveSessionId !== session) continue;
      if (event.type === 'superchat-delete') {
        remove(event.messageIds);
        continue;
      }
      if (!['danmaku', 'gift', 'superchat'].includes(event.type)) continue;
      if (event.type === 'danmaku' && event.isWelcome === true && !showWelcomeMessages()) continue;
      if (event.type === 'superchat' && !['mist', 'comic', 'window', 'sinking'].includes(getStyle()) && (isRandomDanmakuStyle(getStyle()) || isFloatingDanmakuStyle(getStyle()))) continue;
      append({ ...event, id: `scene-event-${++sequence}`, kind: event.type, timestamp: Date.now(),
        message: event.type === 'gift' ? `送出 ${event.giftName} × ${event.giftCount}` : event.message });
    }
  }
  return { update };
}
