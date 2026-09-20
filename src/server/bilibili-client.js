'use strict';

const { BilibiliDanmakuClient } = require('../bilibili/danmaku-client');
const { isBilibiliCommandText } = require('../bilibili/danmaku/command-text');
const {
  logSongRequest,
  songRequestReason,
} = require('../bilibili/diagnostics');

function createBilibiliClient(roomId, context) {
  const {
    isShuttingDown,
    aiDanmakuDeliveryVerifier,
    domainServices,
    aiAssistant,
    danmakuSender,
    broadcastSnapshot,
    publishDanmaku,
    updateLiveStatus,
    bilibiliDiagnostics,
    bilibiliAuthCache,
    games,
    userInfoService,
  } = context;
  const fanScope = context.getFanScope?.() || null;
  let client = null;
  client = new BilibiliDanmakuClient(
    roomId,
    {
      onRealtimeDanmaku: (event) => {
        if (!isShuttingDown()) context.onRealtimeDanmaku?.(event);
      },
      onRealtimeStatus: () => {
        if (!isShuttingDown()) context.onRealtimeStatus?.();
      },
      onMessage: (danmaku) => {
        if (isShuttingDown()) return false;
        let stage = 'dispatch';
        try {
          if (
            typeof publishDanmaku === 'function' &&
            danmaku.source === 'danmaku'
          ) {
            publishDanmaku(danmaku);
          }
          aiDanmakuDeliveryVerifier.observe(danmaku);
          const gameResult = games?.handleDanmaku?.(danmaku);
          if (
            gameResult?.session?.game === 'draw-guess' &&
            !danmaku.avatarUrl
          ) {
            void client
              .ensureUserInfo(danmaku.uid, { fields: ['name', 'avatarUrl'] })
              .then((snapshot) => {
                if (isShuttingDown() || !snapshot?.avatarUrl) return;
                games?.updateDanmakuAvatar?.({
                  uid: snapshot.uid,
                  userName: snapshot.name || danmaku.userName,
                  avatarUrl: snapshot.avatarUrl,
                });
              })
              .catch((error) => {
                console.warn(
                  `[Bilibili] viewer avatar lookup failed: uid=${danmaku.uid || ''} error=${error.message}`,
                );
              });
          }
          stage = 'request';
          const result = domainServices.messages.handleDanmaku({
            message: danmaku.message,
            userName: danmaku.userName,
            uid: String(danmaku.uid || ''),
            identityType: danmaku.identityType,
            fanScope,
            source: danmaku.source || 'danmaku',
            messageTimestamp: danmaku.messageTimestamp,
            requesterGuardLevel: danmaku.requesterGuardLevel,
            requesterMedalName: danmaku.requesterMedalName,
            requesterMedalLevel: danmaku.requesterMedalLevel,
            isPinned: danmaku.isPinned,
          });
          domainServices.messages.logDanmaku(danmaku, result);
          stage = 'after-request';
          if (result.reason === 'cloud-owned') return;
          aiAssistant.handleDanmaku({
            message: danmaku.message,
            userName: danmaku.userName,
            uid: String(danmaku.uid || ''),
          });
          if (result.autoReply) {
            void danmakuSender
              .send({
                message: result.autoReply.message,
                mentionTarget: result.autoReply.target,
              })
              .catch((error) => {
                console.warn(
                  `[Bilibili] random scope auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`,
                );
              });
          }
          if (result.customReplyReply) {
            void danmakuSender
              .send({
                message: result.customReplyReply.message,
                mentionTarget: result.customReplyReply.target,
              })
              .catch((error) => {
                console.warn(
                  `[Bilibili] custom auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`,
                );
              });
          }
          if (result.accepted) {
            stage = 'queue-broadcast';
            broadcastSnapshot(
              danmaku.source === 'superchat'
                ? 'bilibili:superchat'
                : 'bilibili:danmaku',
            );
            logSongRequest('queue-broadcast', danmaku, {
              queueId: Number(result.queueItem?.id) || 0,
            });
          }
          return gameResult?.session?.game === 'draw-guess';
        } catch (error) {
          logSongRequest('command-result', danmaku, {
            status: 'failed', stage, reason: songRequestReason(error.message),
          });
          console.warn(
            `[Bilibili] danmaku command failed: reason=${songRequestReason(error.message)}`,
          );
          return false;
        }
      },
      onSuperChat: (superChat) => {
        if (isShuttingDown()) return;
        try {
          const item = domainServices.superChats.add({
            platformId: superChat.id,
            message: superChat.message,
            price: superChat.price,
            uid: String(superChat.uid || ''),
            userName: superChat.userName,
            requesterGuardLevel: superChat.requesterGuardLevel,
            requesterMedalName: superChat.requesterMedalName,
            requesterMedalLevel: superChat.requesterMedalLevel,
            messageTimestamp: superChat.messageTimestamp,
          });
          if (item) {
            broadcastSnapshot('bilibili:superchat');
          }
        } catch (error) {
          console.warn(
            `[Bilibili] superchat record failed: user=${superChat.userName || ''} uid=${superChat.uid || ''} price=${superChat.price || 0} message=${JSON.stringify(superChat.message)} error=${error.message}`,
          );
        }
      },
      onStatus: updateLiveStatus,
    },
    {
      diagnostics: bilibiliDiagnostics,
      clientGeneration: context.bilibiliClientGeneration,
      bilibiliAuth: {
        cookieHeader: bilibiliAuthCache.cookieHeader,
        uid: bilibiliAuthCache.uid,
      },
      userInfoService,
      isCommandText: (message) =>
        isBilibiliCommandText(
          message,
          domainServices.customReplies.isCommandText,
        ),
    },
  );
  return client;
}

module.exports = { createBilibiliClient };
