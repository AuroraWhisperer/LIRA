'use strict';

const { hasExactOrigin } = require('../local-media-access');

function sanitizeState(state = {}) {
  return {
    ok: state.ok !== false,
    values: {
      giftAutoThanksEnabled: state.values?.giftAutoThanksEnabled === true,
      giftStatsQueryEnabled: state.values?.giftStatsQueryEnabled === true,
    },
    status: ['confirmed', 'pending'].includes(state.status) ? state.status : 'unconfirmed',
    error: /^[A-Z][A-Z0-9_]{0,63}$/.test(state.error || '') ? state.error : null,
  };
}

function registerGiftInteractionIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const channels = ['license:get-gift-interaction-state', 'license:set-gift-interaction'];
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, intent) => {
      const window = getMainWindow();
      if (!window || window.isDestroyed() || event?.sender !== window.webContents ||
        event?.senderFrame !== window.webContents.mainFrame ||
        !hasExactOrigin(event?.senderFrame?.url, getDesktopBaseUrl())) {
        return { ok: false, error: 'IPC_SOURCE_INVALID' };
      }
      try {
        return sanitizeState(channel === channels[0]
          ? await controller.refreshGiftInteractionState()
          : await controller.setGiftInteraction(intent));
      } catch (error) {
        return sanitizeState({ ...controller.getGiftInteractionState(), ok: false,
          error: ['INVALID_GIFT_INTERACTION', 'GIFT_INTERACTION_PENDING'].includes(error?.code)
            ? error.code : 'CLOUD_SYNC_FAILED' });
      }
    });
  }
  const unsubscribe = controller.onGiftInteractionStateChanged((state) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed() &&
      hasExactOrigin(window.webContents.mainFrame?.url, getDesktopBaseUrl())) {
      window.webContents.send('license:gift-interaction-state-changed', sanitizeState(state));
    }
  });
  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerGiftInteractionIpc };
