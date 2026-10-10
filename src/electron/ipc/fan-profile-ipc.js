'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerFanProfileIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channel = 'fan-profiles:invoke';
  const success = (result) => ({ ok: true, ...result });
  const failure = (error) => ({
    ok: false,
    error: /[\u4e00-\u9fff]/.test(error.message || '') ? error.message : '档案操作失败，输入尚未保存，请重试。',
    ...(error.existingId ? { existingId: error.existingId } : {}),
  });
  register(channel, (_event, request) => {
    try {
      const result = controller.invoke(request);
      return result instanceof Promise ? result.then(success, failure) : success(result);
    } catch (error) {
      return failure(error);
    }
  });
  return () => ipcMain.removeHandler(channel);
}

module.exports = { registerFanProfileIpc };
