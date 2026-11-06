// 编写人：Aurora
// 桌面更新 UI。由管理页显式创建和初始化。
'use strict';

import { createResourceIntegrity } from './desktop-resource-integrity.js';

export function createDesktopShell({ toast, showStackedToast, showError, api, showConfirmationDialog, openUpdatePage = () => {} } = {}) {
  const resourceIntegrity = createResourceIntegrity({ toast, describeError: desktopActionErrorMessage });
  let desktopUpdateNoticeKey = '';
  let desktopUpdateAction = '';
  function initDesktopShell() {
    const desktop = window.songAssistantDesktop;
    if (!desktop) return;
    resourceIntegrity.init(desktop);

    document.body.classList.add('desktop-shell');
    document.querySelectorAll('.desktop-only').forEach((node) => {
      node.hidden = false;
    });

    const checkButton = document.getElementById('desktopCheckUpdateBtn');
    const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
    const installButton = document.getElementById('desktopInstallUpdateBtn');
    const dataButton = document.getElementById('desktopOpenDataBtn');
    const logButton = document.getElementById('desktopOpenLogBtn');

    if (checkButton) {
      checkButton.addEventListener('click', () => {
        renderDesktopUpdateState({
          status: 'checking',
          message: '正在连接更新服务检查新版本...',
          canDownload: false,
          canInstall: false,
          progress: null,
        });
        runDesktopAction(() => desktop.checkForUpdates(), true, 'check');
      });
    }
    if (downloadButton) {
      downloadButton.addEventListener('click', () => runDesktopAction(() => desktop.downloadUpdate(), true, 'download'));
    }
    if (installButton) {
      installButton.addEventListener('click', async () => {
        if (!(await showRestartConfirmModal())) return;
        runDesktopAction(() => desktop.installUpdate(), true, 'install');
      });
    }
    if (dataButton) {
      dataButton.addEventListener('click', () => runDesktopAction(() => desktop.openDataDir(), false, 'open-data'));
    }
    if (logButton) {
      logButton.addEventListener('click', () => runDesktopAction(() => desktop.openLogDir(), false, 'open-log'));
    }

    // 自动更新 toggle
    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    const autoUpdateLabel = document.getElementById('autoUpdateLabel');
    if (autoUpdateToggle) {
      autoUpdateToggle.addEventListener('change', async () => {
        const enabled = autoUpdateToggle.checked;
        try {
          await api(
            '/api/settings',
            {
              enableAutoUpdate: enabled ? 'true' : 'false',
            },
            { notifyError: false },
          );
          if (autoUpdateLabel) {
            autoUpdateLabel.textContent = enabled ? '已开启' : '已关闭';
          }
          // 通知主进程
          if (desktop.setAutoUpdate) {
            desktop.setAutoUpdate(enabled);
          }
        } catch (error) {
          toast('保存失败：' + (error.message || String(error)), { type: 'error' });
          autoUpdateToggle.checked = !enabled;
          if (autoUpdateLabel) {
            autoUpdateLabel.textContent = autoUpdateToggle.checked ? '已开启' : '已关闭';
          }
        }
      });
    }

    desktop.onShowUpdatePage(openUpdatePage);
    desktop.onUpdateState(handleDesktopUpdateState);
    desktop
      .getInfo()
      .then((info) => {
        const versionNode = document.getElementById('desktopVersionPill');
        if (versionNode) versionNode.textContent = info.version || '--';
        handleDesktopUpdateState(info.updateState);
      })
      .catch(showError);
  }

  function handleDesktopUpdateState(state) {
    renderDesktopUpdateState(state);
    maybeShowDesktopUpdateNotice(state);
  }

  function maybeShowDesktopUpdateNotice(state) {
    if (state?.status === 'downloading') desktopUpdateAction = 'download';
    if (state?.status === 'error' && desktopUpdateAction) {
      const titles = { check: '暂时查不了新版本', download: '更新没下载成功', install: '更新没能安装' };
      showStackedToast({
        key: `desktop-update:${state.updateVersion || state.version || 'current'}`,
        update: true,
        type: 'error',
        title: titles[desktopUpdateAction],
        message: desktopUpdateAction === 'install' ? '请到更新页查看原因，再试一次。' : '请检查网络，再到更新页重试。',
        actionLabel: '打开更新页',
        onClick: openUpdatePage,
      });
      desktopUpdateAction = '';
    }
    if (['not-available', 'downloaded', 'dev-disabled'].includes(state?.status)) desktopUpdateAction = '';
    if (state?.status === 'available' && desktopUpdateAction === 'check') desktopUpdateAction = '';
    if (!state || (state.status !== 'available' && state.status !== 'downloaded')) return;

    const updateVersion = state.updateVersion || state.version || '';
    const noticeKey = `${updateVersion}:${state.status}`;
    if (desktopUpdateNoticeKey === noticeKey) return;

    desktopUpdateNoticeKey = noticeKey;
    showDesktopUpdateNotice(updateVersion, state.status);
  }

  function showDesktopUpdateNotice(updateVersion, status) {
    const versionText = updateVersion ? ` v${updateVersion}` : '';
    const title = status === 'downloaded' ? `更新${versionText}已下载` : `发现新版本${versionText}`;
    const body =
      status === 'downloaded' ? '退出程序时会安装；点击前往更新页，可在直播结束后重启。' : '即将自动下载；点击前往更新页查看进度。';

    showStackedToast({
      key: `desktop-update:${updateVersion || 'current'}`,
      update: true,
      actionLabel: '前往更新页面',
      title,
      message: body,
      className: 'desktop-update-toast',
      duration: 8000,
      onClick: openUpdatePage,
    });
  }

  function showDesktopNoUpdateNotice(message) {
    showStackedToast({
      key: 'desktop-update:not-available',
      title: '已经是最新版本',
      message: message || '当前版本不需要更新。',
      className: 'desktop-update-toast desktop-update-toast-good',
      duration: 4200,
      onClick: openUpdatePage,
    });
  }

  async function runDesktopAction(action, shouldRender = true, actionName = '') {
    if (['check', 'download', 'install'].includes(actionName)) desktopUpdateAction = actionName;
    try {
      const state = await action();
      if (shouldRender) {
        handleDesktopUpdateState(state);
        if (state && state.status === 'not-available') showDesktopNoUpdateNotice(desktopUpdateStatusText(state));
      }
    } catch (error) {
      if (shouldRender) {
        handleDesktopUpdateState({
          status: 'error',
          message: desktopActionErrorMessage(error),
          canDownload: false,
          canInstall: false,
          progress: null,
        });
      } else {
        const message = actionName === 'open-log' ? '无法打开日志目录，请检查目录权限后重试。'
          : actionName === 'open-data' ? '无法打开数据目录，请检查目录权限后重试。'
            : desktopActionErrorMessage(error);
        toast(message, { type: 'error' });
      }
    }
  }

  function renderDesktopUpdateState(state) {
    if (!state) return;

    const statusNode = document.getElementById('desktopUpdateStatus');
    const hintNode = document.getElementById('desktopUpdateHint');
    const downloadNode = document.getElementById('desktopUpdateDownload');
    const percentNode = document.getElementById('desktopUpdatePercent');
    const progressNode = document.getElementById('desktopUpdateProgress');
    const progressBar = document.getElementById('desktopUpdateProgressBar');
    const detailsNode = document.getElementById('desktopUpdateDownloadDetails');
    const transferredNode = document.getElementById('desktopUpdateTransferred');
    const speedNode = document.getElementById('desktopUpdateSpeed');
    const actionsNode = document.getElementById('desktopUpdateActions');
    const checkButton = document.getElementById('desktopCheckUpdateBtn');
    const downloadButton = document.getElementById('desktopDownloadUpdateBtn');
    const installButton = document.getElementById('desktopInstallUpdateBtn');
    const isDownloading = state.status === 'downloading';
    const isInstalling = state.status === 'installing';
    const showInstall = Boolean(state.canInstall) || isInstalling;
    const showDownload = Boolean(state.canDownload) && state.status !== 'available' && !isDownloading && !showInstall;
    const showCheck = !isDownloading && !showInstall && !showDownload;
    const percent =
      state.progress && Number.isFinite(Number(state.progress.percent))
        ? Math.max(0, Math.min(100, Number(state.progress.percent)))
        : 0;

    const transferred = state.progress?.transferred || 0;
    const total = state.progress?.total || 0;
    const speed = state.progress?.speed || 0;

    if (statusNode) {
      statusNode.textContent = isDownloading && state.progress ? '正在下载更新' : desktopUpdateStatusText(state);
      statusNode.dataset.status = state.status || 'idle';
    }
    if (hintNode) {
      hintNode.textContent = desktopUpdateHintText(state);
      hintNode.hidden = !hintNode.textContent;
    }
    if (downloadNode) {
      downloadNode.hidden = !isDownloading;
    }
    if (percentNode) {
      percentNode.hidden = !isDownloading || !state.progress;
      percentNode.textContent = `${percent.toFixed(1)}%`;
    }
    if (progressNode) {
      if (state.progress) {
        progressNode.setAttribute('aria-valuenow', String(percent));
      } else {
        progressNode.removeAttribute('aria-valuenow');
      }
    }
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }
    if (detailsNode) {
      detailsNode.hidden = !isDownloading || (total <= 0 && speed <= 0);
    }
    if (transferredNode) {
      transferredNode.textContent =
        total > 0 ? `${(transferred / (1024 * 1024)).toFixed(1)} MB / ${(total / (1024 * 1024)).toFixed(1)} MB` : '';
    }
    if (speedNode) {
      speedNode.textContent = speed > 0 ? formatDownloadSpeed(speed) : '';
    }
    if (actionsNode) {
      actionsNode.hidden = !showCheck && !showDownload && !showInstall;
    }
    if (checkButton) {
      checkButton.hidden = !showCheck;
      checkButton.disabled =
        state.status === 'checking' || state.status === 'available' || state.status === 'dev-disabled' || isDownloading || isInstalling;
      checkButton.textContent = state.status === 'checking' ? '检查中...' : state.status === 'available' ? '准备下载…' : '检查并下载更新';
    }
    if (downloadButton) {
      downloadButton.hidden = !showDownload;
      downloadButton.disabled = !state.canDownload;
    }
    if (installButton) {
      installButton.hidden = !showInstall;
      installButton.disabled = !state.canInstall || isInstalling;
      installButton.textContent = isInstalling ? '正在重启并安装更新…' : '重启并安装更新';
    }
  }

  function formatDownloadSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) {
      return `${bytesPerSecond.toFixed(0)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else {
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
    }
  }

  function desktopUpdateHintText(state) {
    if (state.status === 'downloaded') return '退出程序时会安装更新，建议在直播结束后重启。';
    if (state.status === 'dev-disabled') return '开发模式不支持更新，请使用安装版。';
    if (state.status === 'error') return '可重新检查更新；在「本地数据与支持」打开日志目录查看 errors/desktop.log。';
    return '';
  }

  function desktopActionErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (/\b404\b/.test(text) && /latest\.yml|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(text)) {
      return '更新清单暂不可用，请稍后再试。';
    }
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(text)) {
      return '暂时无法连接更新服务，请稍后再试。';
    }
    return '操作失败，详细原因已写入日志。';
  }

  function desktopUpdateStatusText(state) {
    if (state?.status === 'available') return `发现新版本 ${state.updateVersion || ''}，即将自动下载。`;
    const fallback = '等待检查更新';
    const message = String((state && state.message) || fallback)
      .replace(/\s+/g, ' ')
      .trim();
    if (message.length <= 120) return message;
    return `${message.slice(0, 120)}...`;
  }

  function showRestartConfirmModal() {
    return showConfirmationDialog({
      variant: 'caution',
      title: '现在重启并安装更新？',
      description: '应用会退出并显示更新安装进度，完成后自动关闭进度窗口并重新启动 LIRA。建议确认直播间暂时不需要操作后再继续。',
      confirmLabel: '重启并安装更新',
      initialFocus: 'cancel',
    });
  }

  return {
    initDesktopShell,
    initResourceIntegrity: resourceIntegrity.init,
    renderResourceIntegrityState: resourceIntegrity.render,
    renderDesktopUpdateState,
    desktopUpdateStatusText,
    desktopUpdateHintText,
    desktopActionErrorMessage,
  };
}
