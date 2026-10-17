'use strict';

const DELAYED_CONNECTION_MESSAGES = new Set([
  '直播弹幕长连失败，历史消息监听中',
  '弹幕长连已断开，历史消息监听中',
  '已开播，但弹幕长连重连失败，历史消息监听中',
  '直播弹幕长连重连失败，历史消息监听中',
]);

export function isLiveStatusDegraded(live = {}) {
  return DELAYED_CONNECTION_MESSAGES.has(live.message);
}

export function projectTopbarStatus(live = {}, connectionState = '') {
  const message = live.message || '弹幕监听未启用';
  let label = '弹幕未启用';
  let tone = '';
  if (live.enabled) {
    if (isLiveStatusDegraded(live)) {
      label = '弹幕延迟';
      tone = 'warn';
    } else if (message.includes('正在') || message.includes('重连')) {
      label = '弹幕重连中';
      tone = 'warn';
    } else if (!live.connected) {
      label = '弹幕未连接';
      tone = 'warn';
    } else if (message.startsWith('未开播')) {
      label = '未开播';
    } else if (message.startsWith('已开播')) {
      label = '已开播';
      tone = 'good';
    } else {
      label = '弹幕已连接';
    }
  }
  const localUnavailable = connectionState === 'disconnected' || connectionState === 'shutdown';
  if (localUnavailable) {
    label = connectionState === 'shutdown' ? '程序已退出' : '本机重连中';
    tone = 'warn';
  }
  return {
    label,
    tone,
    owner: localUnavailable ? '' : live.ownerName || '',
    detail: `${localUnavailable ? '上次状态：' : ''}${isLiveStatusDegraded(live)
      ? '已连接，弹幕可能延迟（正在恢复实时连接）'
      : message === '未开播，历史消息监听中' ? '未开播，正在接收弹幕' : message}`,
    local: connectionState === 'connected' ? '已连接'
      : connectionState === 'shutdown' ? '程序已退出'
        : connectionState === 'disconnected' ? '连接已断开，正在自动重连' : '正在连接',
  };
}
