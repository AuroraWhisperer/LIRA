'use strict';

// Song and keyword replies share admission and per-chunk cancellation.
function createLiveReplySender({ sender, captureReplySession, isShuttingDown }) {
  let session = null;

  return {
    setLive(isLive) {
      if (isLive === true) session ||= {};
      else session = null;
    },

    async send(reply) {
      const original = session;
      if (!original || isShuttingDown()) return;
      const assertReplySession = await captureReplySession?.();
      const assertSessionCurrent = (auth) => {
        if (session !== original || isShuttingDown()) {
          throw Object.assign(new Error('直播已结束，已取消旧回复。'), { code: 'LIVE_REPLY_CANCELLED' });
        }
        assertReplySession?.(auth);
      };
      try {
        assertSessionCurrent();
        await sender.send({
          message: reply.message,
          mentionTarget: reply.target,
          mentionEveryChunk: true,
          assertSessionCurrent,
        });
      } catch (error) {
        if (error.code !== 'LIVE_REPLY_CANCELLED' && error.code !== 'DANMAKU_SESSION_CHANGED') throw error;
      }
    },
  };
}

module.exports = { createLiveReplySender };
