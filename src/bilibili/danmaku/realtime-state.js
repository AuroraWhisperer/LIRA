'use strict';

// A socket open or history-poller status is not authentication evidence.
function getRealtimeState(client) {
  const ready =
    !client.stopped &&
    client.wsConnection.ws?.readyState === 1 &&
    client.wsConnection.connectionTrace?.authStatus === 'accepted' &&
    /^[1-9]\d*$/.test(String(client.resolvedRoomId || '')) &&
    /^[1-9]\d*$/.test(client.ownerUid) &&
    Boolean(client.apiClient.uid);
  return {
    ready,
    roomId: String(client.resolvedRoomId || ''),
    ownerUid: client.ownerUid,
    accountUid: String(client.apiClient.uid || ''),
    connectionKey: `${client.options.clientGeneration || 0}:${client.connectionGeneration}:${client.connectionAttempt}`,
    reason: ready ? '' : '请登录账号并等待实时弹幕鉴权成功',
  };
}

module.exports = { getRealtimeState };
