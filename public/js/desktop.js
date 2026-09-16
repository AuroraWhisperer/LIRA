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
          progress: null,
        });
        runDesktopAction(() => desktop.checkForUpdates());
      });
    }
    if (downloadButton) {
      downloadButton.addEventListener('click', () =>
        runDesktopAction(() => desktop.downloadUpdate()),
      );
    }
    if (installButton) {
      installButton.addEventListener('click', async () => {
        if (!(await showRestartConfirmModal())) return;
        runDesktopAction(() => desktop.installUpdate());
      });
    }
    if (dataButton) {
      dataButton.addEventListener('click', () =>
        runDesktopAction(() => desktop.openDataDir(), false),
      );
    }
    if (logButton) {
      logButton.addEventListener('click', () =>
        runDesktopAction(() => desktop.openLogDir(), false),
      );
    }
    if (githubButton) {
      githubButton.addEventListener('click', () =>
        runDesktopAction(() => desktop.openGithub(), false),
      );
    }

    // 自动更新 toggle
    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    const autoUpdateLabel = document.getElementById('autoUpdateLabel');
    if (autoUpdateToggle) {
      autoUpdateToggle.addEventListener('change', async () => {
        const enabled = autoUpdateToggle.checked;
        try {
          await U.api('/api/settings', {
            enableAutoUpdate: enabled ? 'true' : 'false',
          }, { notifyError: false });
          if (autoUpdateLabel) {
            autoUpdateLabel.textContent = enabled ? '已开启' : '已关闭';
          }
          toast(enabled ? '自动更新已开启' : '自动更新已关闭');
          // 通知主进程
          if (desktop.setAutoUpdate) {
            desktop.setAutoUpdate(enabled);
          }
        } catch (error) {
          toast('保存失败：' + (error.message || String(error)), { type: 'error' });
          autoUpdateToggle.checked = !enabled;
          if (autoUpdateLabel) {
            autoUpdateLabel.textContent = autoUpdateToggle.checked
              ? '已开启'
              : '已关闭';
          }
        }
      });
    }

    desktop.onShowUpdatePage(showDesktopUpdatePage);
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

  function showDesktopUpdatePage() {
    const navigation = window.AdminApp.navigation;
    const otherPage = window.AdminApp.other;
    if (!navigation || !otherPage) return;

    navigation.setMainPage('otherAssistantPage');
    otherPage.selectFeatureById('otherDesktopUpdateFeature');
  }

  function handleDesktopUpdateState(state) {
    renderDesktopUpdateState(state);
    maybeShowDesktopUpdateNotice(state);
  }

  function maybeShowDesktopUpdateNotice(state) {
    if (
      !state ||
      (state.status !== 'available' && state.status !== 'downloaded')
    )
      return;

    const updateVersion = state.updateVersion || state.version || '';
    const noticeKey = `${updateVersion}:${state.status}`;
    if (desktopUpdateNoticeKey === noticeKey) return;

    desktopUpdateNoticeKey = noticeKey;
    showDesktopUpdateNotice(updateVersion, state.status);
  }

  function showDesktopUpdateNotice(updateVersion, status) {
    const versionText = updateVersion ? ` v${updateVersion}` : '';
    const title =
      status === 'downloaded'
        ? `更新${versionText}已下载`
        : `发现新版本${versionText}`;
    const body =
      status === 'downloaded'
        ? '点击前往桌面版更新页面，重启后完成安装。'
        : '点击前往桌面版更新页面处理更新。';

    showStackedToast({
      key: `desktop-update:${updateVersion || 'current'}`,
      update: true,
      actionLabel: '前往更新页面',
      title,
      message: body,
      className: 'desktop-update-toast',
      duration: 8000,
      onClick: showDesktopUpdatePage,
    });
  }

  function showDesktopNoUpdateNotice(message) {
    showStackedToast({
      key: 'desktop-update:not-available',
      title: '已经是最新版本',
      message: message || '当前版本不需要更新。',
      className: 'desktop-update-toast desktop-update-toast-good',
      duration: 4200,
      onClick: showDesktopUpdatePage,
    });
  }

  async function runDesktopAction(action, shouldRender = true) {
    try {
      const state = await action();
      if (shouldRender) {
        renderDesktopUpdateState(state);
        if (state && state.status === 'not-available')
          showDesktopNoUpdateNotice(desktopUpdateStatusText(state));
      }
    } catch (error) {
      if (shouldRender) {
        renderDesktopUpdateState({
          status: 'error',
          message: desktopActionErrorMessage(error),
          canDownload: false,
          canInstall: false,
          progress: null,
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
    const showDownload = Boolean(state.canDownload) && !isDownloading && !showInstall;
    const showCheck = !isDownloading && !showInstall && !showDownload;
    const percent =
      state.progress && Number.isFinite(Number(state.progress.percent))
        ? Math.max(0, Math.min(100, Number(state.progress.percent)))
        : 0;

    const transferred = state.progress?.transferred || 0;
    const total = state.progress?.total || 0;
    const speed = state.progress?.speed || 0;

    if (statusNode) {
      statusNode.textContent = isDownloading && state.progress
        ? '正在下载更新'
        : desktopUpdateStatusText(state);
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
      transferredNode.textContent = total > 0
        ? `${(transferred / (1024 * 1024)).toFixed(1)} MB / ${(total / (1024 * 1024)).toFixed(1)} MB`
        : '';
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
        state.status === 'checking' ||
        state.status === 'dev-disabled' ||
        isDownloading ||
        isInstalling;
      checkButton.textContent =
        state.status === 'checking' ? '检查中...' : '检查更新';
    }
    if (downloadButton) {
      downloadButton.hidden = !showDownload;
      downloadButton.disabled = !state.canDownload;
    }
    if (installButton) {
      installButton.hidden = !showInstall;
      installButton.disabled = !state.canInstall || isInstalling;
      installButton.textContent = isInstalling ? '正在重启...' : '重启并更新';
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
    if (state.status === 'downloaded')
      return '建议在直播结束后重启更新。';
    if (state.status === 'dev-disabled')
      return '开发模式不支持更新，请使用安装版。';
    if (state.status === 'error')
      return '可重新检查更新，或打开日志目录查看详情。';
    return '';
  }

  function desktopActionErrorMessage(error) {
    const text = String((error && error.message) || error || '');
    if (
      /\b404\b/.test(text) &&
      /releases\.atom|latest\.yml|github/i.test(text)
    ) {
      return '当前 GitHub Releases 里还没有可用更新包。';
    }
    if (
      /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|timeout/i.test(text)
    ) {
      return '暂时无法连接 GitHub 更新服务，请稍后再试。';
    }
    return '操作失败，详细原因已写入日志。';
  }

  function desktopUpdateStatusText(state) {
    const fallback = '等待检查更新';
    const message = String((state && state.message) || fallback)
      .replace(/\s+/g, ' ')
      .trim();
    if (message.length <= 120) return message;
    return `${message.slice(0, 120)}...`;
  }

  function showRestartConfirmModal() {
    return U.showConfirmationDialog({
      variant: 'caution',
      title: '现在重启并安装更新？',
      description:
        '应用会退出并安装已下载的新版本。建议确认直播间暂时不需要操作后再继续。',
      confirmLabel: '重启并更新',
      initialFocus: 'cancel',
    });
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktop = {
    initDesktopShell,
    renderDesktopUpdateState,
    desktopUpdateStatusText,
    desktopUpdateHintText,
    desktopActionErrorMessage,
  };
})();
