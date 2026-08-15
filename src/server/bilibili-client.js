'use strict';

const { BilibiliDanmakuClient } = require('../bilibili/danmaku-client');
const { isBilibiliCommandText } = require('../bilibili/danmaku/command-text');

function createBilibiliClient(roomId, context) {
  const {
    isShuttingDown,
    aiDanmakuDeliveryVerifier,
    domainServices,
    xiaomiAi,
    danmakuSender,
    broadcastSnapshot,
    updateLiveStatus,
    bilibiliDiagnostics,
    runtimeGiftCommandPrefixes,
    messageBuffer,
    bilibiliAuthCache,
    logGiftDelivery
  } = context;
  return new BilibiliDanmakuClient(roomId, {
    onMessage: (danmaku) => {
      if (isShuttingDown()) return;
      try {
        aiDanmakuDeliveryVerifier.observe(danmaku);
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
        xiaomiAi.handleDanmaku({
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
      } catch (error) {
        console.warn(`[Bilibili] danmaku command failed: user=${danmaku.userName || ''} uid=${danmaku.uid || ''} message=${JSON.stringify(danmaku.message)} error=${error.message}`);
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
    isCommandText: (message) => isBilibiliCommandText(message, domainServices.customReplies.isCommandText)
  });
}

module.exports = { createBilibiliClient };
