// 编写人：Aurora
// 桌面更新 UI。挂载到 window.AdminApp.desktop
'use strict';

(function () {
  const U = window.AdminApp.utils;

  function desktopUpdateStatusText(state) {
    const fallback = '等待检查更新';
    const message = String((state && state.message) || fallback).replace(/\s+/g, ' ').trim();
    if (message.length <= 120) return message;
    return `${message.slice(0, 120)}...`;
  }

  function desktopUpdateHintText(state) {
    if (state.status === 'available') return '新版本来自 GitHub Releases。';
    if (state.status === 'downloaded') return '更新已经就绪，建议在直播结束后重启更新。';
    if (state.status === 'dev-disabled') return '当前是开发模式。';
    if (state.status === 'not-available') return '当前已经是最新版本。';
    return '桌面版会保留本地数据目录，更新 exe 不会清空歌库。';
  }

  function desktopActionErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (/\b404\b/.test(text) && /releases\.atom|latest\.yml|github/i.test(text)) {
      return '当前 GitHub Releases 里还没有可用更新包。';
    }
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(text)) {
      return '暂时无法连接 GitHub 更新服务，请稍后再试。';
    }
    return '操作失败，详细原因已写入日志。';
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktop = {
    desktopUpdateStatusText, desktopUpdateHintText, desktopActionErrorMessage
  };
})();
