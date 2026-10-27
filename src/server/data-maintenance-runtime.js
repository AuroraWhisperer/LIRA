'use strict';

function runClearAll({ clearAll, pauseGifts, resumeGifts, pauseOvertime, resumeOvertime,
  clearMusicCache, rebuildGiftProjection }) {
  function resumeWriters({ gifts = true, overtime = true } = {}) {
    try {
      // Prepare the settlement consumer before the detector can deliver gifts.
      if (overtime) resumeOvertime();
      if (gifts) resumeGifts();
    } catch (error) {
      pauseGifts();
      pauseOvertime();
      throw error;
    }
  }

  // Keep quiescing, database work and recovery in the same synchronous turn.
  const acquired = { gifts: false, overtime: false };
  let result;
  try {
    acquired.gifts = pauseGifts() !== false;
    acquired.overtime = pauseOvertime() !== false;
    result = clearAll();
  } catch (error) {
    try {
      resumeWriters(acquired);
    } catch (resumeError) {
      error.cause = resumeError;
    }
    throw error;
  }

  try {
    clearMusicCache?.();
  } catch (_) {
    /* cache cleanup is best-effort */
  }

  if (result.cleared && !result.partial) {
    try {
      resumeWriters();
    } catch (error) {
      result = {
        ...result,
        ok: false,
        cleared: false,
        partial: true,
        phase: 'resume',
        failed: [],
        error: `数据已清空，但写入恢复失败：${error.message}`,
      };
    }
  }

  const rebuild = result.partial === true
    ? result.giftProjectionReset && result.committed?.includes('giftDb')
    : result.cleared && result.giftProjectionReset;
  if (rebuild) {
    try {
      const pending = rebuildGiftProjection?.();
      pending?.catch?.(() => false);
    } catch (_) {
      /* projection recovery is best-effort and does not delay the result */
      return result;
    }
  }
  return result;
}

module.exports = { runClearAll };
