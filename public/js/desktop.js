// 编写人：Aurora
// 桌面更新 UI。挂载到 window.AdminApp.desktop
'use strict';

(function () {
  const U = window.AdminApp.utils;
  const { toast, showStackedToast, showError } = U;
  let desktopUpdateNoticeKey = '';

function initDesktopShell() {
  const desktop = window.songAssistantDesktop;
  if (!desktop) return;

  document.body.classList.add('desktop-shell');
  document.querySelectorAll('.desktop-only').forEach((node) => {
    node.hidden = false;
  });

  const checkButton = document.getElementById('desktopCheckUpdateBtn');
  const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
  const installButton = document.getElementById('desktopInstallUpdateBtn');
  const dataButton = document.getElementById('desktopOpenDataBtn');
  const logButton = document.getElementById('desktopOpenLogBtn');
  const githubButton = document.getElementById('desktopOpenGithubBtn');

  if (checkButton) {
    checkButton.addEventListener('click', () => {
      renderDesktopUpdateState({
        status: 'checking',
        message: '正在连接 GitHub 检查新版本...',
        canDownload: false,
        canInstall: false,
        progress: null
      });
      runDesktopAction(() => desktop.checkForUpdates());
    });
  }
  if (downloadButton) {
    downloadButton.addEventListener('click', () => runDesktopAction(() => desktop.downloadUpdate()));
  }
  if (installButton) {
    installButton.addEventListener('click', () => {
      if (!confirm('确认重启并更新到新版本？')) return;
      runDesktopAction(() => desktop.installUpdate());
    });
  }
  if (dataButton) {
    dataButton.addEventListener('click', () => runDesktopAction(() => desktop.openDataDir(), false));
  }
  if (logButton) {
    logButton.addEventListener('click', () => runDesktopAction(() => desktop.openLogDir(), false));
  }
  if (githubButton) {
    githubButton.addEventListener('click', () => runDesktopAction(() => desktop.openGithub(), false));
  }

  desktop.onShowUpdatePage(showDesktopUpdatePage);
  desktop.onUpdateState(handleDesktopUpdateState);
  desktop.getInfo()
    .then((info) => {
      const versionNode = document.getElementById('desktopVersionPill');
      if (versionNode) versionNode.textContent = `版本 ${info.version || '--'}`;
      handleDesktopUpdateState(info.updateState);
    })
    .catch(showError);
}

function showDesktopUpdatePage() {
  const button = document.getElementById('desktopUpdateTab');
  const page = document.getElementById('desktopUpdatePage');
  if (!button || !page) return;

  document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  page.classList.add('active');
}

function handleDesktopUpdateState(state) {
  renderDesktopUpdateState(state);
  maybeShowDesktopUpdateNotice(state);
}

function maybeShowDesktopUpdateNotice(state) {
  if (!state || (state.status !== 'available' && state.status !== 'downloaded')) return;

  const updateVersion = state.updateVersion || state.version || '';
  const noticeKey = updateVersion || state.status;
  if (desktopUpdateNoticeKey === noticeKey) return;

  desktopUpdateNoticeKey = noticeKey;
  showDesktopUpdateNotice(updateVersion, state.status);
}

function showDesktopUpdateNotice(updateVersion, status) {
  const versionText = updateVersion ? ` v${updateVersion}` : '';
  const title = status === 'downloaded'
    ? `更新${versionText}已下载`
    : `发现新版本${versionText}`;
  const body = status === 'downloaded'
    ? '点击前往桌面版更新页面，重启后完成安装。'
    : '点击前往桌面版更新页面处理更新。';

  showStackedToast({
    key: `desktop-update:${updateVersion || status}`,
    title,
    message: body,
    className: 'desktop-update-toast',
    duration: 3000,
    onClick: showDesktopUpdatePage
  });
}

function showDesktopNoUpdateNotice(message) {
  showStackedToast({
    key: 'desktop-update:not-available',
    title: '已经是最新版本',
    message: message || '当前版本不需要更新。',
    className: 'desktop-update-toast desktop-update-toast-good',
    duration: 4200,
    onClick: showDesktopUpdatePage
  });
}

async function runDesktopAction(action, shouldRender = true) {
  try {
    const state = await action();
    if (shouldRender) {
      renderDesktopUpdateState(state);
      if (state && state.status === 'not-available') showDesktopNoUpdateNotice(desktopUpdateStatusText(state));
    }
  } catch (error) {
    if (shouldRender) {
      renderDesktopUpdateState({
        status: 'error',
        message: desktopActionErrorMessage(error),
        canDownload: false,
        canInstall: false,
        progress: null
      });
    } else {
      toast(desktopActionErrorMessage(error));
    }
  }
}

function renderDesktopUpdateState(state) {
  if (!state) return;

  const statusNode = document.getElementById('desktopUpdateStatus');
  const hintNode = document.getElementById('desktopUpdateHint');
  const progressBar = document.getElementById('desktopUpdateProgressBar');
  const checkButton = document.getElementById('desktopCheckUpdateBtn');
  const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
  const installButton = document.getElementById('desktopInstallUpdateBtn');
  const percent = state.progress && Number.isFinite(Number(state.progress.percent))
    ? Math.max(0, Math.min(100, Number(state.progress.percent)))
    : 0;

  if (statusNode) {
    statusNode.textContent = desktopUpdateStatusText(state);
    statusNode.dataset.status = state.status || 'idle';
  }
  if (hintNode) {
    hintNode.textContent = desktopUpdateHintText(state);
  }
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
  if (checkButton) {
    checkButton.disabled = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';
    checkButton.textContent = state.status === 'checking' ? '检查中...' : '检查更新';
  }
  if (downloadButton) {
    downloadButton.disabled = !state.canDownload;
    downloadButton.textContent = state.status === 'downloading' ? '下载中...' : '下载更新';
  }
  if (installButton) {
    installButton.disabled = !state.canInstall;
  }
}

function desktopUpdateHintText(state) {
  if (state.status === 'available') return '新版本来自 GitHub Releases。若 blockmap 可用，会优先下载变化的部分。';
  if (state.status === 'downloaded') return '更新已经就绪，建议在直播结束后重启更新。';
  if (state.status === 'dev-disabled') return '当前是开发模式；打包安装后的 exe 会自动检查 GitHub 更新。';
  if (state.status === 'not-available') return '发布新版本时，需要把安装包、blockmap 和 latest.yml 上传到 GitHub Releases。';
  if (state.status === 'error') return '详细错误已写入本机日志；界面只显示可操作的简短状态。';
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

function desktopUpdateStatusText(state) {
  const fallback = '等待检查更新';
  const message = String((state && state.message) || fallback).replace(/\s+/g, ' ').trim();
  if (message.length <= 120) return message;
  return `${message.slice(0, 120)}...`;
}

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktop = {
    initDesktopShell,
    renderDesktopUpdateState,
    desktopUpdateStatusText,
    desktopUpdateHintText,
    desktopActionErrorMessage
  };
})();
