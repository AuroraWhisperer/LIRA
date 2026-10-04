// 编写人：Aurora
// 桌面更新 UI。挂载到 window.AdminApp.desktop
'use strict';

(function () {
  const utils = window.AdminApp.utils;
  const { toast, showStackedToast, showError } = utils;
  let desktopUpdateNoticeKey = '';
  let desktopUpdateAction = '';
  let resourceIntegrityInitialized = false;
  let resourceIntegrityState = null;
  let resourceIntegrityPending = false;
  const integrityReasons = {
    FILE_MISSING: '文件缺失',
    SIZE_MISMATCH: '文件大小不一致',
    HASH_MISMATCH: '文件内容不一致',
    FILE_UNREADABLE: '无法读取文件',
    FILE_CHANGED: '文件在检查期间发生变化',
    MANIFEST_MISSING: '当前安装缺少校验清单',
    MANIFEST_INVALID: '校验清单无效或无法读取',
    MANIFEST_UNSUPPORTED: '不支持此校验清单格式',
    MANIFEST_VERSION_MISMATCH: '校验清单与当前版本、平台或架构不符',
    PATH_INVALID: '校验清单包含不允许的路径',
    PATH_UNSAFE: '检测到链接或不安全的资源路径',
    DEV_MODE: '开发模式不支持此检查',
    PLATFORM_UNSUPPORTED: '当前平台或架构暂不支持此检查',
    UPDATE_INSTALLING: '正在安装更新，暂不能开始检查',
    CHECK_TIMEOUT: '检查超时，部分项目未完成',
    CHECK_CANCELLED: '检查已停止，未完成全部项目',
    CHECK_FAILED: '检查未能完成，请查看日志',
  };

  function initDesktopShell() {
    const desktop = window.songAssistantDesktop;
    if (!desktop) return;
    initResourceIntegrity(desktop);

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
          message: '正在连接 GitHub 检查新版本...',
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
      dataButton.addEventListener('click', () => runDesktopAction(() => desktop.openDataDir(), false));
    }
    if (logButton) {
      logButton.addEventListener('click', () => runDesktopAction(() => desktop.openLogDir(), false));
    }

    // 自动更新 toggle
    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    const autoUpdateLabel = document.getElementById('autoUpdateLabel');
    if (autoUpdateToggle) {
      autoUpdateToggle.addEventListener('change', async () => {
        const enabled = autoUpdateToggle.checked;
        try {
          await utils.api(
            '/api/settings',
            {
              enableAutoUpdate: enabled ? 'true' : 'false',
            },
            { notifyError: false },
          );
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
            autoUpdateLabel.textContent = autoUpdateToggle.checked ? '已开启' : '已关闭';
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

  function initResourceIntegrity(desktop) {
    if (
      resourceIntegrityInitialized ||
      !desktop.getResourceIntegrityState ||
      !desktop.checkResourceIntegrity ||
      !desktop.onResourceIntegrityState
    )
      return;
    const button = document.getElementById('desktopIntegrityCheckBtn');
    if (!button) return;
    resourceIntegrityInitialized = true;
    const unsubscribe = desktop.onResourceIntegrityState(renderResourceIntegrityState);
    window.addEventListener('beforeunload', unsubscribe, { once: true });
    desktop
      .getResourceIntegrityState()
      .then(renderResourceIntegrityState)
      .catch(() => {
        if (!resourceIntegrityState) {
          document.getElementById('desktopIntegrityStatus').textContent =
            '无法读取检查状态，请重新打开页面或查看日志。';
          button.disabled = false;
        }
      });
    button.addEventListener('click', async () => {
      if (resourceIntegrityPending) return;
      resourceIntegrityPending = true;
      button.disabled = true;
      try {
        renderResourceIntegrityState(await desktop.checkResourceIntegrity());
      } catch (_) {
        toast('无法开始资源检查，请查看日志后重试。', { type: 'error' });
      } finally {
        resourceIntegrityPending = false;
        button.disabled = ['checking', 'unavailable'].includes(resourceIntegrityState?.status);
      }
    });
    document
      .getElementById('desktopIntegrityGithubBtn')
      ?.addEventListener('click', () => runDesktopAction(() => desktop.openGithub(), false));
  }

  function renderResourceIntegrityState(state) {
    if (!state || !Number.isSafeInteger(state.revision) || state.revision <= (resourceIntegrityState?.revision ?? -1))
      return;
    resourceIntegrityState = state;
    const button = document.getElementById('desktopIntegrityCheckBtn');
    const status = document.getElementById('desktopIntegrityStatus');
    if (!button || !status) return;
    const checking = state.status === 'checking';
    button.disabled = resourceIntegrityPending || checking || state.status === 'unavailable';
    button.textContent = checking
      ? '检查中…'
      : state.status === 'idle' || state.status === 'unavailable'
        ? '开始检查'
        : state.status === 'passed' || state.status === 'issues'
          ? '重新检查'
          : '重试';
    const reason = integrityReasons[state.reasonCode] || '暂不能确认资源完整性';
    const counts =
      state.totalFiles == null ? '正在读取并验证校验清单' : `已检查 ${state.checkedFiles} / ${state.totalFiles} 个文件`;
    const knownIssues = state.issueCount ? `已发现 ${state.issueCount} 个文件缺失或内容不一致。` : '';
    const messages = {
      idle: '可在内置页面或资源异常时检查当前安装。',
      checking: `正在检查客户端资源，${counts}。`,
      passed: '本次检查范围内的资源与校验清单一致；不代表所有功能正常。',
      issues: `${knownIssues}${state.complete ? '' : '部分项目未完成，无法确认全部检查范围。'}`,
      inconclusive: `无法完成检查：${reason}。`,
      unavailable: reason,
      cancelled: `${knownIssues}检查已停止，未完成全部项目。`,
    };
    status.textContent = messages[state.status] || '无法读取检查状态，请查看日志。';
    const meta = document.getElementById('desktopIntegrityMeta');
    const timestamp = state.finishedAt || state.startedAt;
    meta.textContent = `当前版本：${state.appVersion || '--'}${timestamp ? ` · 检查时间：${new Date(timestamp).toLocaleString()}` : ''}${state.totalFiles == null ? '' : ` · 已检查 ${state.checkedFiles} / ${state.totalFiles} 个文件`}${state.unresolvedCount ? ` · 未确定 ${state.unresolvedCount} 项` : ''}`;
    meta.hidden = false;
    const details = document.getElementById('desktopIntegrityDetails');
    details.replaceChildren();
    for (const detail of (state.details || []).slice(0, 20)) {
      const item = document.createElement('li');
      item.textContent = `${detail.path}：${integrityReasons[detail.reasonCode] || '无法判定'}`;
      details.appendChild(item);
    }
    details.hidden = !details.children.length;
    const hint = document.getElementById('desktopIntegrityHint');
    const totalDetails = state.issueCount + state.unresolvedCount;
    const truncated = totalDetails > 20 ? `异常或未确定共 ${totalDetails} 项，仅展示前 20 项详情。` : '';
    const nextStep = state.issueCount
      ? '建议先备份重要业务数据，关闭客户端后从官方渠道重新安装适用安装包；重装不保证解决所有故障。'
      : state.status === 'passed'
        ? '如果问题仍在，请通过上方日志目录继续排查其他原因。'
        : ['inconclusive', 'cancelled'].includes(state.status)
          ? '可重试或通过上方日志目录查看诊断信息，无法读取不等于资源损坏。'
          : '';
    hint.textContent = `${truncated}${state.reasonCode && state.status === 'issues' ? `${reason}。` : ''}${nextStep}`;
    hint.hidden = !hint.textContent;
    document.getElementById('desktopIntegrityGithubBtn').hidden = !state.issueCount;
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
        onClick: showDesktopUpdatePage,
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
      status === 'downloaded' ? '点击前往桌面版更新页面，重启后完成安装。' : '点击前往桌面版更新页面处理更新。';

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

  async function runDesktopAction(action, shouldRender = true, actionName = '') {
    if (actionName) desktopUpdateAction = actionName;
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
        state.status === 'checking' || state.status === 'dev-disabled' || isDownloading || isInstalling;
      checkButton.textContent = state.status === 'checking' ? '检查中...' : '检查更新';
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
    if (state.status === 'downloaded') return '建议在直播结束后重启更新。';
    if (state.status === 'dev-disabled') return '开发模式不支持更新，请使用安装版。';
    if (state.status === 'error') return '可重新检查更新，或打开日志目录查看详情。';
    return '';
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
    const message = String((state && state.message) || fallback)
      .replace(/\s+/g, ' ')
      .trim();
    if (message.length <= 120) return message;
    return `${message.slice(0, 120)}...`;
  }

  function showRestartConfirmModal() {
    return utils.showConfirmationDialog({
      variant: 'caution',
      title: '现在重启并安装更新？',
      description: '应用会退出并安装已下载的新版本。建议确认直播间暂时不需要操作后再继续。',
      confirmLabel: '重启并更新',
      initialFocus: 'cancel',
    });
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.desktop = {
    initDesktopShell,
    initResourceIntegrity,
    renderResourceIntegrityState,
    renderDesktopUpdateState,
    desktopUpdateStatusText,
    desktopUpdateHintText,
    desktopActionErrorMessage,
  };
})();
