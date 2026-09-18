'use strict';

const { hasExactOrigin } = require('../local-media-access');

function registerFanProfileIpc({
  ipcMain,
  controller,
  getMainWindow,
  getDesktopBaseUrl,
}) {
  const channel = 'fan-profiles:invoke';
  ipcMain.handle(channel, (event, request) => {
    const win = getMainWindow();
    if (
      !win ||
      win.isDestroyed() ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !hasExactOrigin(event.senderFrame.url, getDesktopBaseUrl()) ||
      !['/', '/admin', '/settings', '/songs'].includes(
        new URL(event.senderFrame.url).pathname,
      )
    ) {
      return { ok: false, error: 'IPC_SOURCE_INVALID' };
    }
    try {
      return { ok: true, ...controller.invoke(request) };
    } catch (error) {
      return {
        ok: false,
        error: /[\u4e00-\u9fff]/.test(error.message || '')
          ? error.message
          : '档案操作失败，输入尚未保存，请重试。',
        ...(error.existingId ? { existingId: error.existingId } : {}),
      };
    }
  });
  return () => ipcMain.removeHandler(channel);
}

module.exports = { registerFanProfileIpc };
