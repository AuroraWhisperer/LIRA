'use strict';

const { app, dialog } = require('electron');

try {
  require('./main');
} catch (error) {
  let diagnosticUnavailable = false;
  try {
    const path = require('node:path');
    const { resolveDesktopUserDataPaths } = require('./desktop-user-data');
    const { createDesktopLogger } = require('./desktop-logger');
    const { logDir } = resolveDesktopUserDataPaths({
      isPackaged: app.isPackaged, appDataPath: app.getPath('appData'),
      exePath: app.getPath('exe'), rootDir: path.resolve(__dirname, '../..'),
    });
    createDesktopLogger({
      getLogFile: () => path.join(logDir, 'desktop.log'),
      loggingState: { runId: 'startup-failed', sequence: 0 },
    }).writeLog('startup-error', error);
  } catch {
    diagnosticUnavailable = true;
  }
  try {
    dialog.showErrorBox(
      'LIRA 启动失败',
      'LIRA 无法完成启动，关闭此提示后程序将退出。\n\n' +
        '请使用完整安装包重新安装到原目录，保留现有数据。\n\n' +
        (diagnosticUnavailable ? '启动日志未能保存。\n\n' : '') +
        (error.message || String(error)),
    );
  } finally {
    app.exit(1);
  }
}
