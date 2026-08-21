'use strict';

function registerLocalFontPermissionHandler({
  desktopSession,
  dialog,
  desktopBaseUrl,
  getMainWindow,
  hasExactOrigin
}) {
  desktopSession.setPermissionRequestHandler(async function (webContents, permission, callback, details = {}) {
    const requestingUrl = details.requestingUrl || webContents?.getURL?.() || '';
    if (permission !== 'localFonts' || !hasExactOrigin(requestingUrl, desktopBaseUrl)) {
      callback(false);
      return;
    }

    const options = {
      type: 'question',
      title: 'LIRA 本地字体权限',
      message: '允许 LIRA 读取本机字体列表吗？',
      detail: '只会读取已安装字体的名称，用于点歌板风格 3–6 和桌面歌词的字体选择；不会读取字体文件、文件路径或字体内容。',
      buttons: ['允许', '取消'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };

    try {
      const mainWindow = getMainWindow();
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      callback(result.response === 0);
    } catch (_) {
      callback(false);
    }
  });
}

module.exports = { registerLocalFontPermissionHandler };
