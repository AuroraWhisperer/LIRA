'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');
const { createNavigationCancellation } = require('./navigation-cancellation');

function registerGiftExportIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const cancellation = createNavigationCancellation(() => controller.cancel());
  const methods = {
    settings: 'settings',
    prepare: 'prepare',
    configure: 'configure',
    save: 'save',
    cancel: 'cancel',
    'open-folder': 'openFolder',
  };
  for (const [channel, method] of Object.entries(methods)) {
    register(`gift-export:${channel}`, async (_event, input) => {
      const win = getMainWindow();
      try {
        cancellation.bind(win.webContents);
        const data = await controller[method](input, (progress) => {
          if (!win.isDestroyed()) win.webContents.send('gift-export:progress', progress);
        });
        return channel === 'save' ? data : { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: typeof error.publicMessage === 'string' && error.publicMessage ? error.publicMessage : '礼物导出失败，请重新打开预览。',
        };
      }
    });
  }
  return () => {
    cancellation.unbind();
    controller.dispose();
    for (const channel of Object.keys(methods)) ipcMain.removeHandler(`gift-export:${channel}`);
  };
}

module.exports = { registerGiftExportIpc };
