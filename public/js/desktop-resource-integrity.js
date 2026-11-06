export function createResourceIntegrity({ toast, describeError }) {
  let resourceIntegrityInitialized = false;
  let resourceIntegrityState = null;
  let resourceIntegrityPending = false;
  let disposed = false;
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
    window.addEventListener('beforeunload', () => {
      disposed = true;
      unsubscribe();
    }, { once: true });
    desktop
      .getResourceIntegrityState()
      .then(renderResourceIntegrityState)
      .catch(() => {
        if (!disposed && !resourceIntegrityState) {
          document.getElementById('desktopIntegrityStatus').textContent =
            '无法读取检查状态，请重新打开页面或查看日志。';
          button.disabled = false;
        }
      });
    button.addEventListener('click', async () => {
      if (disposed || resourceIntegrityPending) return;
      resourceIntegrityPending = true;
      button.disabled = true;
      try {
        renderResourceIntegrityState(await desktop.checkResourceIntegrity());
      } catch (_) {
        if (!disposed) toast('无法开始资源检查，请查看日志后重试。', { type: 'error' });
      } finally {
        resourceIntegrityPending = false;
        if (!disposed) button.disabled = ['checking', 'unavailable'].includes(resourceIntegrityState?.status);
      }
    });
    document
      .getElementById('desktopIntegrityGithubBtn')
      ?.addEventListener('click', async () => {
        try { await desktop.openGithub(); }
        catch (error) { toast(describeError(error), { type: 'error' }); }
      });
  }

  function renderResourceIntegrityState(state) {
    if (disposed || !state || !Number.isSafeInteger(state.revision) || state.revision <= (resourceIntegrityState?.revision ?? -1))
      return;
    resourceIntegrityState = state;
    const button = document.getElementById('desktopIntegrityCheckBtn');
    const status = document.getElementById('desktopIntegrityStatus');
    if (!button || !status) return;
    const checking = state.status === 'checking';
    const tone = state.issueCount || state.status === 'issues'
      ? 'danger'
      : { passed: 'success', inconclusive: 'warning', cancelled: 'warning' }[state.status] || 'neutral';
    const result = document.getElementById('desktopIntegrityResult');
    result.dataset.tone = tone;
    result.hidden = state.status === 'idle';
    document.getElementById('desktopIntegrityIcon').setAttribute('d', {
      success: 'M8 12l3 3 5-6',
      danger: 'M9 9l6 6 M15 9l-6 6',
      warning: 'M12 7v6 M12 16h.01',
      neutral: 'M12 11v5 M12 8h.01',
    }[tone]);
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
      state.totalFiles == null ? '正在读取校验清单' : `已检查 ${state.checkedFiles} / ${state.totalFiles} 个文件`;
    const knownIssues = state.issueCount ? `发现 ${state.issueCount} 项资源异常` : '';
    const messages = {
      idle: '等待检查',
      checking: `检查中 · ${counts}`,
      passed: '检查通过，未发现资源异常',
      issues: `${knownIssues}${state.complete ? '' : '（部分项目未完成）'}`,
      inconclusive: `检查未完成：${reason}`,
      unavailable: reason,
      cancelled: `检查已停止${knownIssues ? `，${knownIssues}` : '，未完成全部项目'}`,
    };
    status.textContent = messages[state.status] || '无法读取检查状态，请查看日志。';
    const meta = document.getElementById('desktopIntegrityMeta');
    const timestamp = state.finishedAt || state.startedAt;
    meta.textContent = [
      state.totalFiles == null ? '' : counts,
      state.unresolvedCount ? `${state.unresolvedCount} 项未确定` : '',
      timestamp ? new Date(timestamp).toLocaleString() : '',
    ].filter(Boolean).join(' · ');
    meta.hidden = checking || !meta.textContent;
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
    const truncated = totalDetails > 20 ? `共 ${totalDetails} 项异常或未确定，仅显示前 20 项。` : '';
    const nextStep = state.issueCount
      ? '请备份重要数据，关闭客户端后从官方渠道重新安装。'
      : ['inconclusive', 'cancelled'].includes(state.status)
        ? '请重试，或打开日志目录排查。'
        : '';
    hint.textContent = `${truncated}${state.reasonCode && state.status === 'issues' ? `${reason}。` : ''}${nextStep}`;
    hint.hidden = !hint.textContent;
    document.getElementById('desktopIntegrityGithubBtn').hidden = !state.issueCount;
  }

  return { init: initResourceIntegrity, render: renderResourceIntegrityState };
}
