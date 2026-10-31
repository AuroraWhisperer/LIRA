'use strict';

const { hasExactOrigin } = require('../local-media-access');
const { normalizeGiftThanksTemplates } = require('../../../public/js/shared/gift-thanks-templates.js');

function sanitizeState(state = {}) {
  let templates = null;
  let invalidTemplates = false;
  try {
    if (state.templates) templates = normalizeGiftThanksTemplates(state.templates);
  } catch {
    invalidTemplates = true;
  }
  return {
    ok: state.ok !== false && !invalidTemplates,
    values: {
      giftAutoThanksEnabled: state.values?.giftAutoThanksEnabled === true,
      giftStatsQueryEnabled: state.values?.giftStatsQueryEnabled === true,
    },
    templates,
    status: invalidTemplates ? 'unconfirmed' : ['confirmed', 'pending'].includes(state.status) ? state.status : 'unconfirmed',
    error: invalidTemplates ? 'INVALID_RESPONSE' : /^[A-Z][A-Z0-9_]{0,63}$/.test(state.error || '') ? state.error : null,
  };
}

function registerGiftInteractionIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const channels = ['license:get-gift-interaction-state', 'license:set-gift-interaction', 'license:set-gift-thanks-templates'];
  for (const channel of channels) {
    ipcMain.handle(channel, async (event, intent) => {
      const window = getMainWindow();
      if (
        !window ||
        window.isDestroyed() ||
        event?.sender !== window.webContents ||
        event?.senderFrame !== window.webContents.mainFrame ||
        !hasExactOrigin(event?.senderFrame?.url, getDesktopBaseUrl())
      ) {
        return { ok: false, error: 'IPC_SOURCE_INVALID' };
      }
      try {
        return sanitizeState(
          channel === channels[2]
            ? await controller.setGiftThanksTemplates(normalizeGiftThanksTemplates(intent))
            : channel === channels[0]
            ? await controller.refreshGiftInteractionState()
            : await controller.setGiftInteraction(intent),
        );
      } catch (error) {
        return sanitizeState({
          ...controller.getGiftInteractionState(),
          ok: false,
          error: ['INVALID_GIFT_INTERACTION', 'GIFT_INTERACTION_PENDING', 'INVALID_GIFT_THANKS_TEMPLATES', 'GIFT_THANKS_UNSUPPORTED'].includes(error?.code)
            ? error.code
            : 'CLOUD_SYNC_FAILED',
        });
      }
    });
  }
  const unsubscribe = controller.onGiftInteractionStateChanged((state) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed() && hasExactOrigin(window.webContents.mainFrame?.url, getDesktopBaseUrl())) {
      window.webContents.send('license:gift-interaction-state-changed', sanitizeState(state));
    }
  });
  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerGiftInteractionIpc };
