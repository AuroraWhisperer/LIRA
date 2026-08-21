'use strict';

const { BilibiliDanmakuClient } = require('../bilibili/danmaku-client');
const { isBilibiliCommandText } = require('../bilibili/danmaku/command-text');

function createBilibiliClient(roomId, context) {
  const {
    isShuttingDown,
    aiDanmakuDeliveryVerifier,
    domainServices,
    aiAssistant,
    danmakuSender,
    broadcastSnapshot,
    updateLiveStatus,
    bilibiliDiagnostics,
    runtimeGiftCommandPrefixes,
    messageBuffer,
    bilibiliAuthCache,
    logGiftDelivery,
    games,
    userInfoService
  } = context;
  let client = null;
  client = new BilibiliDanmakuClient(roomId, {
    onMessage: (danmaku) => {
      if (isShuttingDown()) return false;
      try {
        aiDanmakuDeliveryVerifier.observe(danmaku);
        const gameResult = games?.handleDanmaku?.(danmaku);
        if (gameResult?.session?.game === 'draw-guess' && !danmaku.avatarUrl) {
          void client.ensureUserInfo(danmaku.uid, { fields: ['name', 'avatarUrl'] })
            .then((snapshot) => {
              if (isShuttingDown() || !snapshot?.avatarUrl) return;
              games?.updateDanmakuAvatar?.({
                uid: snapshot.uid,
                userName: snapshot.name || danmaku.userName,
                avatarUrl: snapshot.avatarUrl
              });
            })
            .catch((error) => {
              console.warn(`[Bilibili] viewer avatar lookup failed: uid=${danmaku.uid || ''} error=${error.message}`);
            });
        }
        const result = domainServices.messages.handleDanmaku({
          message: danmaku.message,
          userName: danmaku.userName,
          uid: String(danmaku.uid || ''),
          source: danmaku.source || 'danmaku',
          messageTimestamp: danmaku.messageTimestamp,
          requesterGuardLevel: danmaku.requesterGuardLevel,
          requesterMedalName: danmaku.requesterMedalName,
          requesterMedalLevel: danmaku.requesterMedalLevel,
          isPinned: danmaku.isPinned
        });
        domainServices.messages.logDanmaku(danmaku, result);
        aiAssistant.handleDanmaku({
          message: danmaku.message,
          userName: danmaku.userName,
          uid: String(danmaku.uid || '')
        });
        if (result.autoReply) {
          void danmakuSender.send({
            message: result.autoReply.message,
            mentionTarget: result.autoReply.target
          }).catch((error) => {
            console.warn(`[Bilibili] random scope auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`);
          });
        }
        if (result.checkinReply) {
          void danmakuSender.send({
            message: result.checkinReply.message,
            mentionTarget: result.checkinReply.target
          }).catch((error) => {
            console.warn(`[Bilibili] check-in auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`);
          });
        }
        if (result.fortuneReply) {
          void danmakuSender.send({
            message: result.fortuneReply.message,
            mentionTarget: result.fortuneReply.target
          }).catch((error) => {
            console.warn(`[Bilibili] fortune auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`);
          });
        }
        if (result.customReplyReply) {
          void danmakuSender.send({
            message: result.customReplyReply.message,
            mentionTarget: result.customReplyReply.target
          }).catch((error) => {
            console.warn(`[Bilibili] custom auto-reply failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} error=${error.message}`);
          });
        }
        if (result.accepted) {
          broadcastSnapshot(danmaku.source === 'superchat' ? 'bilibili:superchat' : 'bilibili:danmaku');
        }
        return gameResult?.session?.game === 'draw-guess';
      } catch (error) {
        console.warn(`[Bilibili] danmaku command failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(danmaku.message)} error=${error.message}`);
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
          messageTimestamp: superChat.messageTimestamp
        });
        if (item) {
          broadcastSnapshot('bilibili:superchat');
        }
      } catch (error) {
        console.warn(`[Bilibili] superchat record failed: user=${superChat.userName || ''} uid=${superChat.uid || ''} price=${superChat.price || 0} message=${JSON.stringify(superChat.message)} error=${error.message}`);
      }
    },
    onGift: (gift) => {
      if (isShuttingDown()) return;
      try {
        const item = domainServices.gifts.add(gift);
        if (item) logGiftDelivery(item.detection_status || 'detected', item);
      } catch (error) {
        console.warn(`[Bilibili] gift record failed: user=${gift.userName || ''} uid=${gift.uid || ''} gift=${gift.giftName || ''} error=${error.message}`);
      }
    },
    onStatus: updateLiveStatus
  }, {
    diagnostics: bilibiliDiagnostics,
    runtimeGiftCommandPrefixes,
    messageBuffer,
    bilibiliAuth: {
      cookieHeader: bilibiliAuthCache.cookieHeader,
      uid: bilibiliAuthCache.uid
    },
    userInfoService,
    isCommandText: (message) => isBilibiliCommandText(message, domainServices.customReplies.isCommandText)
  });
  return client;
}

module.exports = { createBilibiliClient };
