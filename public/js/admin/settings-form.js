'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { renderSongCooldownControls } from './song-cooldown-settings.js';

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
  userBlacklistEditor,
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

  function initImmediateToggle(id, settingKey, disabledText) {
    documentRef.getElementById(id).addEventListener('change', async (event) => {
      const enabled = event.target.checked ? 'true' : 'false';
      event.target.disabled = true;
      try {
        await api('/api/settings', { [settingKey]: enabled }, { notifyError: false });
        if (enabled === 'false' && disabledText) toast(disabledText, { type: 'success' });
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
    userBlacklistEditor?.init();
    await initLicenseAccountDevice();
    documentRef.getElementById('settingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = await api('/api/settings', collectSettings());
      eventBus.emit(Events.STATE_SAVED, { settings: result.data.settings });
      toast('设置已保存', { type: 'success' });
      await reloadState();
    });
    const songRequestForm = documentRef.getElementById('songRequestSettingsForm');
    const requestSaveButton = documentRef.getElementById('songRequestSettingsSave');
    const requestSaveState = documentRef.getElementById('songRequestSettingsSaveState');
    let savingRequest = false;
    let requestDirty = false;
    let requestSaveTimer;
    let composingRequest = false;
    const scheduleRequestSave = () => {
      clearTimeout(requestSaveTimer);
      if (!composingRequest) requestSaveTimer = setTimeout(() => void saveRequestSettings(), 500);
    };
    const markRequestSettingDirty = ({ target }) => {
      target.dataset.preserveDirty = 'true';
      target.dataset.dirty = 'true';
      requestDirty = true;
      if (requestSaveState) requestSaveState.textContent = '等待自动保存…';
      if (target.id === 'songCooldownMode') renderSongCooldownControls(documentRef);
      scheduleRequestSave();
    };
    songRequestForm.addEventListener('input', markRequestSettingDirty);
    songRequestForm.addEventListener('change', (event) => {
      if (event.target.tagName === 'SELECT') markRequestSettingDirty(event);
    });
    songRequestForm.addEventListener('compositionstart', () => {
      composingRequest = true;
      clearTimeout(requestSaveTimer);
    });
    songRequestForm.addEventListener('compositionend', () => {
      composingRequest = false;
      if (requestDirty) scheduleRequestSave();
    });
    async function saveRequestSettings() {
      clearTimeout(requestSaveTimer);
      if (savingRequest || !requestDirty || composingRequest) return;
      if (!songRequestForm.checkValidity()) {
        if (requestSaveState) requestSaveState.textContent = '请补全或修正输入，修改后将自动保存';
        return;
      }
      const updates = {
        paused: value('paused'),
        scSongRequestEnabled: value('scSongRequestEnabled'),
        songRequestCancelEnabled: value('songRequestCancelEnabled'),
        songRequestMatchMode: value('songRequestMatchMode'),
        queueLimit: value('queueLimit'),
        userCooldownSeconds: value('userCooldownSeconds'),
        userQueueLimit: value('userQueueLimit'),
        userCooldownCaptainSeconds: value('userCooldownCaptainSeconds'),
        userCooldownAdmiralSeconds: value('userCooldownAdmiralSeconds'),
        userCooldownGovernorSeconds: value('userCooldownGovernorSeconds'),
        songRequestMinMedalLevel: value('songRequestMinMedalLevel'),
        songRequestGuardLevel: value('songRequestGuardLevel'),
        songRequestGuardMedalBypass: value('songRequestGuardMedalBypass'),
        songRequestUserBlacklist: value('songRequestUserBlacklist'),
        songCooldownMode: value('songCooldownMode'),
        songCooldownValue: value('songCooldownValue'),
        onlyFromLibrary: value('onlyFromLibrary'),
        allowDuplicate: value('allowDuplicate'),
        guardPriorityEnabled: value('guardPriorityEnabled'),
        songRequestBlacklist: value('songRequestBlacklist'),
      };
      savingRequest = true;
      requestDirty = false;
      let saved = false;
      if (requestSaveButton) {
        requestSaveButton.disabled = true;
        requestSaveButton.hidden = true;
      }
      if (requestSaveState) requestSaveState.textContent = '保存中…';
      try {
        const result = await api('/api/settings', updates);
        for (const [key, savedValue] of Object.entries(updates)) {
          if (value(key) === savedValue) documentRef.getElementById(key).dataset.dirty = 'false';
        }
        if (value('songRequestBlacklist') === updates.songRequestBlacklist) {
          blacklistEditor?.render(result.data.settings.songRequestBlacklist);
        }
        if (value('songRequestUserBlacklist') === updates.songRequestUserBlacklist) {
          userBlacklistEditor?.render(result.data.settings.songRequestUserBlacklist);
        }
        await reloadState();
        saved = true;
        if (requestSaveState) requestSaveState.textContent = requestDirty ? '等待自动保存…' : '已自动保存';
      } catch {
        clearTimeout(requestSaveTimer);
        requestDirty = true;
        if (requestSaveState) requestSaveState.textContent = '保存失败，修改已保留，请重试';
        if (requestSaveButton) requestSaveButton.hidden = false;
      } finally {
        savingRequest = false;
        if (requestSaveButton) requestSaveButton.disabled = false;
        if (saved && requestDirty) scheduleRequestSave();
      }
    }
    songRequestForm.addEventListener('submit', (event) => {
      event.preventDefault();
      return saveRequestSettings();
    });
    requestSaveButton?.addEventListener('click', saveRequestSettings);
    documentRef.getElementById('giftSprintForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/settings', {
        giftSprintTargetRmb: value('giftSprintTargetRmb'),
      });
      toast('冲刺目标已保存');
      await reloadState();
    });

    initImmediateToggle('danmakuMonitoringEnabled', 'danmakuMonitoringEnabled', '已关闭弹幕监控，观众点歌、进场欢迎和自动回复已暂停');
    initImmediateToggle('giftMonitoringEnabled', 'giftMonitoringEnabled');
    initImmediateToggle('giftDetectToggle', 'enableGiftSprint');
    initImmediateToggle('enableGiftNotification', 'enableGiftNotification');
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
