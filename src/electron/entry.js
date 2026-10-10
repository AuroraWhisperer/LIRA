'use strict';

const { app, dialog } = require('electron');

try {
  require('./main');
} catch (error) {
  try {
    dialog.showErrorBox(
      'LIRA 启动失败',
      'LIRA 无法完成启动，关闭此提示后程序将退出。\n\n' +
        '请使用完整安装包重新安装到原目录，保留现有数据。\n\n' +
        (error.message || String(error)),
    );
  } finally {
    app.exit(1);
  }
}
