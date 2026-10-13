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
