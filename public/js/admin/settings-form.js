'use strict';

import { eventBus, Events } from '../shared/event-bus.js';

export function createSettingsForm({
  documentRef,
  value,
  api,
  toast,
  showConfirmationDialog,
  getState,
  initLicenseAccountDevice,
  blindboxSettings,
  blacklistEditor,
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
      event.target.disabled = true;
      try {
        await api('/api/settings', { [settingKey]: enabled }, { notifyError: false });
        toast(enabled === 'true' ? enabledText : disabledText, { type: 'success' });
        await reloadState();
      } catch (error) {
        toast('保存失败：' + (error.message || String(error)), { type: 'error' });
        const settings = getState()?.getAppState?.()?.settings;
        if (settings) event.target.checked = settings[settingKey] === 'true';
      } finally {
        event.target.disabled = false;
      }
    });
  }

  function initWindowActions() {
    documentRef.getElementById('clearDatabaseBtn')?.addEventListener('click', clearDatabase);
    documentRef.getElementById('clearSuperChatsBtn')?.addEventListener('click', clearSuperChats);
    documentRef.getElementById('clearAllBtn')?.addEventListener('click', clearAll);
    documentRef.getElementById('shutdownBtn')?.addEventListener('click', shutdownServer);
    documentRef.getElementById('reconnectBtn')?.addEventListener('click', reconnectBilibili);
  }

  async function init() {
    initDesktopControls();
    blacklistEditor?.init();
    await initLicenseAccountDevice();
    documentRef.getElementById('settingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = await api('/api/settings', collectSettings());
      eventBus.emit(Events.STATE_SAVED, { settings: result.data.settings });
      toast('设置已保存', { type: 'success' });
      await reloadState();
    });
    const songRequestForm = documentRef.getElementById('songRequestSettingsForm');
    const markRequestSettingDirty = ({ target }) => {
      target.dataset.preserveDirty = 'true';
      target.dataset.dirty = 'true';
    };
    songRequestForm.addEventListener('input', markRequestSettingDirty);
    songRequestForm.addEventListener('change', markRequestSettingDirty);
    songRequestForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const updates = {
        paused: value('paused'),
        queueLimit: value('queueLimit'),
        userCooldownSeconds: value('userCooldownSeconds'),
        onlyFromLibrary: value('onlyFromLibrary'),
        allowDuplicate: value('allowDuplicate'),
        songRequestBlacklist: value('songRequestBlacklist'),
      };
      const result = await api('/api/settings', updates);
      for (const [key, savedValue] of Object.entries(updates)) {
        if (value(key) === savedValue) documentRef.getElementById(key).dataset.dirty = 'false';
      }
      blacklistEditor?.render(result.data.settings.songRequestBlacklist);
      toast('点歌设置已保存', { type: 'success' });
      await reloadState();
    });
    documentRef.getElementById('giftSprintForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', {
        giftSprintTargetRmb: value('giftSprintTargetRmb'),
      });
      toast('冲刺目标已保存');
      await reloadState();
    });

    initImmediateToggle('danmakuMonitoringEnabled', 'danmakuMonitoringEnabled', '监控设置已保存', '监控设置已保存');
    initImmediateToggle('giftMonitoringEnabled', 'giftMonitoringEnabled', '监控设置已保存', '监控设置已保存');
    initImmediateToggle('giftDetectToggle', 'enableGiftSprint', '礼物统计已开启', '礼物统计已关闭');
    initImmediateToggle('enableGiftNotification', 'enableGiftNotification', '礼物提示已开启', '礼物提示已关闭');
    documentRef.getElementById('giftSprintResetBtn').addEventListener('click', async () => {
      const confirmed = await showConfirmationDialog({
        variant: 'caution',
        title: '重置本轮礼物进度？',
        description: '本轮已收金额会归零，但礼物记录仍会保留，之后可以继续统计。',
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
  }

  function collectSettings() {
    return {
      roomId: value('roomId'),
    };
  }

  return { init, collectSettings };
}
