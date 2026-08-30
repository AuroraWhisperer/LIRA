'use strict';

export function createSettingsForm({
  documentRef,
  value,
  api,
  toast,
  showConfirmationDialog,
  getState,
  initLicenseAccountDevice,
  blindboxSettings,
  clearDatabase,
  clearSuperChats,
  clearAll,
  shutdownServer,
  reconnectBilibili,
  desktopRef,
}) {
  async function reloadState() {
    await getState()?.reloadState?.();
  }

  function initDesktopControls() {
    if (!desktopRef) return;
    const minBtn = documentRef.getElementById('winMinBtn');
    const maxBtn = documentRef.getElementById('winMaxBtn');
    const closeBtn = documentRef.getElementById('winCloseBtn');
    minBtn?.addEventListener('click', () => desktopRef.minimizeWindow());
    maxBtn?.addEventListener('click', () => desktopRef.maximizeWindow());
    closeBtn?.addEventListener('click', () => desktopRef.closeWindow());
    if (!maxBtn) return;
    desktopRef.onWindowMaximized((isMaximized) => {
      const maximizeIcon = maxBtn.querySelector('.maximize-icon');
      const restoreIcon = maxBtn.querySelector('.restore-icon');
      if (!maximizeIcon || !restoreIcon) return;
      maximizeIcon.style.display = isMaximized ? 'none' : 'block';
      restoreIcon.style.display = isMaximized ? 'block' : 'none';
    });
  }

  function initImmediateToggle(id, settingKey, enabledText, disabledText) {
    documentRef.getElementById(id).addEventListener('change', async (event) => {
      const enabled = event.target.checked ? 'true' : 'false';
      try {
        await api('/api/settings', { [settingKey]: enabled });
        toast(enabled === 'true' ? enabledText : disabledText);
        await reloadState();
      } catch (error) {
        toast('保存失败：' + (error.message || String(error)));
        const settings = getState()?.getAppState?.()?.settings;
        if (settings) event.target.checked = settings[settingKey] === 'true';
      }
    });
  }

  function initWindowActions() {
    documentRef
      .getElementById('clearDatabaseBtn')
      ?.addEventListener('click', clearDatabase);
    documentRef
      .getElementById('clearSuperChatsBtn')
      ?.addEventListener('click', clearSuperChats);
    documentRef
      .getElementById('clearAllBtn')
      ?.addEventListener('click', clearAll);
    documentRef
      .getElementById('shutdownBtn')
      ?.addEventListener('click', shutdownServer);
    documentRef
      .getElementById('reconnectBtn')
      ?.addEventListener('click', reconnectBilibili);
  }

  async function init() {
    await initLicenseAccountDevice();
    documentRef
      .getElementById('settingsForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        await api('/api/settings', collectSettings());
        toast('设置已保存');
        await reloadState();
      });
    documentRef
      .getElementById('giftSprintForm')
      .addEventListener('submit', async (event) => {
        event.preventDefault();
        await api('/api/settings', {
          giftSprintTargetRmb: value('giftSprintTargetRmb'),
        });
        toast('冲刺目标已保存');
        await reloadState();
      });

    initImmediateToggle(
      'giftDetectToggle',
      'enableGiftSprint',
      '礼物检测已开启',
      '礼物检测已关闭',
    );
    initImmediateToggle(
      'enableGiftNotification',
      'enableGiftNotification',
      '礼物提示已开启',
      '礼物提示已关闭',
    );
    documentRef
      .getElementById('giftSprintResetBtn')
      .addEventListener('click', async () => {
        const confirmed = await showConfirmationDialog({
          variant: 'caution',
          title: '重置本轮礼物进度？',
          description:
            '本轮已收金额会归零，但礼物流水仍会保留，之后可以继续统计。',
          confirmLabel: '重置进度',
          initialFocus: 'cancel',
        });
        if (!confirmed) return;
        await api('/api/gifts/sprint/reset', {});
        toast('本轮冲刺已重置');
        await reloadState();
      });

    blindboxSettings.init();
    initWindowActions();
    initDesktopControls();
  }

  function collectSettings() {
    return {
      roomId: value('roomId'),
      enableBilibili: value('enableBilibili'),
      paused: value('paused'),
      queueLimit: value('queueLimit'),
      userCooldownSeconds: value('userCooldownSeconds'),
      onlyFromLibrary: value('onlyFromLibrary'),
      allowDuplicate: value('allowDuplicate'),
    };
  }

  return { init, collectSettings };
}
