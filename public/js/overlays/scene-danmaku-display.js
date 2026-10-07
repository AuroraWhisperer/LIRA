import { isFloatingDanmakuStyle, isRandomDanmakuStyle } from '../shared/danmaku-style-options.js';

export function createSceneDanmakuDisplay({ clear, append, status, getStyle, showEntryMessages = () => false }) {
  let epoch = null;
  let session = null;
  let sequence = 0;
  function update(snapshot) {
    if (!snapshot) return;
    const nextSession = snapshot.status === 'connected' && snapshot.state?.liveStatus === 1
      ? snapshot.state.liveSessionId : null;
    if (snapshot.reset || snapshot.epoch !== epoch || nextSession !== session) {
      clear();
      if (nextSession && snapshot.state.confirmationMessage) append({ id: `scene-confirm-${++sequence}`,
        kind: 'system', name: 'LIRA SYSTEM', message: snapshot.state.confirmationMessage, timestamp: Date.now() });
    }
    epoch = snapshot.epoch;
    session = nextSession;
    status(snapshot.gap ? '消息有缺口 · 已从当前直播继续' : session ? '直播中 · 弹幕接收中' : '等待直播数据', Boolean(session));
    if (!session) return;
    for (const event of snapshot.events || []) {
      if (event.liveSessionId !== session || !['danmaku', 'gift', 'superchat', 'entry'].includes(event.type)) continue;
      if (event.type === 'entry' && !showEntryMessages()) continue;
      if (event.type === 'superchat' && (isRandomDanmakuStyle(getStyle()) || isFloatingDanmakuStyle(getStyle()))) continue;
      append({ ...event, id: `scene-event-${++sequence}`, kind: event.type, timestamp: Date.now(),
        message: event.type === 'gift' ? `送出 ${event.giftName} × ${event.giftCount}` : event.type === 'entry' ? '进入了直播间' : event.message });
    }
  }
  return { update };
}
