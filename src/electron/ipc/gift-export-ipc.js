'use strict';

const { hasExactOrigin } = require('../local-media-access');

function registerGiftExportIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  let owner = null;
  const cancel = () => controller.cancel();
  const navigation = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) cancel(); };
  function unbind() {
    owner?.removeListener('did-start-navigation', navigation);
    owner?.removeListener('destroyed', cancel);
    owner = null;
  }
  const methods = { prepare: 'prepare', configure: 'configure', save: 'save', cancel: 'cancel', 'open-folder': 'openFolder' };
  for (const [channel, method] of Object.entries(methods)) {
    ipcMain.handle(`gift-export:${channel}`, async (event, input) => {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !hasExactOrigin(event.senderFrame.url, getDesktopBaseUrl()) ||
        !['/', '/admin', '/settings', '/songs'].includes(new URL(event.senderFrame.url).pathname)) {
        return { ok: false, error: 'IPC_SOURCE_INVALID' };
      }
      try {
        if (owner !== win.webContents) {
          unbind();
          owner = win.webContents;
          owner.on('did-start-navigation', navigation);
          owner.on('destroyed', cancel);
        }
        const data = await controller[method](input, (progress) => {
          if (!win.isDestroyed()) win.webContents.send('gift-export:progress', progress);
        });
        return channel === 'save' ? data : { ok: true, data };
      } catch (error) {
        return { ok: false, error: /[\u4e00-\u9fff]/.test(error.message || '') ? error.message : '礼物导出失败，请重新打开预览。' };
      }
    });
  }
  return () => {
    unbind();
    controller.dispose();
    for (const channel of Object.keys(methods)) ipcMain.removeHandler(`gift-export:${channel}`);
  };
}

module.exports = { registerGiftExportIpc };
