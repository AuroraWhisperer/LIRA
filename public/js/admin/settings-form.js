'use strict';

import { eventBus, Events } from '../shared/event-bus.js';
import { renderSongCooldownControls, renderSongCooldownValidity } from './song-cooldown-settings.js';
import { createAutosave } from './settings-autosave.js';
import { renderSaveStatus } from '../shared/save-status.js';

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
    const roomInput = documentRef.getElementById('roomId');
    roomInput.addEventListener('input', () => {
      roomInput.dataset.preserveDirty = 'true';
      roomInput.dataset.dirty = 'true';
    });
    documentRef.getElementById('settingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const updates = collectSettings();
      const result = await api('/api/settings', updates);
      if (value('roomId') === updates.roomId) roomInput.dataset.dirty = 'false';
      eventBus.emit(Events.STATE_SAVED, { settings: result.data.settings });
      toast('设置已保存', { type: 'success' });
      await reloadState();
    });
    const songRequestForm = documentRef.getElementById('songRequestSettingsForm');
    const requestSaveButton = documentRef.getElementById('songRequestSettingsSave');
    const requestSaveState = documentRef.getElementById('songRequestSettingsSaveState');
    let requestDirty = false;
    const requestAutosave = createAutosave({ root: songRequestForm, delay: 500,
      canSave: () => requestDirty,
      save: saveRequestSettings,
    });
    const markRequestSettingDirty = ({ target }) => {
      target.dataset.preserveDirty = 'true';
      target.dataset.dirty = 'true';
      requestDirty = true;
      renderSaveStatus(requestSaveState, 'pending');
      if (target.id === 'songCooldownMode') renderSongCooldownControls(documentRef);
      if (target.id === 'songCooldownValue') renderSongCooldownValidity(documentRef);
      requestAutosave.schedule();
    };
    songRequestForm.addEventListener('input', markRequestSettingDirty);
    documentRef.getElementById('songCooldownValue').addEventListener('blur', () => renderSongCooldownValidity(documentRef));
    songRequestForm.addEventListener('change', (event) => {
      if (event.target.tagName === 'SELECT') markRequestSettingDirty(event);
    });
    async function saveRequestSettings() {
      if (!songRequestForm.checkValidity()) {
        renderSaveStatus(requestSaveState, 'pending', '请补全或修正输入，修改后将自动保存');
        return;
      }
      const updates = {
        paused: value('paused'),
        scSongRequestEnabled: value('scSongRequestEnabled'),
        songRequestCancelEnabled: value('songRequestCancelEnabled'),
        songRequestRequireSpace: value('songRequestRequireSpace'),
        songRequestMatchMode: value('songRequestMatchMode'),
        queueRequestRequesterColor: value('queueRequestRequesterColor'),
        queueRequestSongColor: value('queueRequestSongColor'),
        queueLimit: value('queueLimit'),
        userCooldownSeconds: value('userCooldownSeconds'),
        userQueueLimit: value('userQueueLimit'),
        userCooldownCaptainSeconds: value('userCooldownCaptainSeconds'),
        userCooldownAdmiralSeconds: value('userCooldownAdmiralSeconds'),
        userCooldownGovernorSeconds: value('userCooldownGovernorSeconds'),
        userDailyLimit: value('userDailyLimit'),
        userDailyCaptainLimit: value('userDailyCaptainLimit'),
        userDailyAdmiralLimit: value('userDailyAdmiralLimit'),
        userDailyGovernorLimit: value('userDailyGovernorLimit'),
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
      requestDirty = false;
      if (requestSaveButton) {
        requestSaveButton.disabled = true;
        requestSaveButton.hidden = true;
      }
      renderSaveStatus(requestSaveState, 'saving');
      const finishBlacklistSave = userBlacklistEditor?.beginSave();
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
        renderSaveStatus(requestSaveState, requestDirty ? 'pending' : 'saved', requestDirty ? '等待自动保存…' : '已自动保存');
      } catch {
        requestAutosave.cancel();
        requestDirty = true;
        renderSaveStatus(requestSaveState, 'error', '保存失败，修改已保留，请重试');
        if (requestSaveButton) requestSaveButton.hidden = false;
      } finally {
        finishBlacklistSave?.();
        if (requestSaveButton) requestSaveButton.disabled = false;
      }
    }
    songRequestForm.addEventListener('submit', (event) => {
      event.preventDefault();
      requestAutosave.schedule();
      return requestAutosave.flush();
    });
    requestSaveButton?.addEventListener('click', () => {
      requestAutosave.schedule();
      return requestAutosave.flush();
    });
    const sprintForm = documentRef.getElementById('giftSprintForm');
    const sprintTarget = documentRef.getElementById('giftSprintTargetRmb');
    const sprintSave = sprintForm.querySelector('button[type="submit"]');
    const sprintStatus = documentRef.getElementById('giftSprintSaveState');
    sprintTarget.dataset.preserveDirty = 'true';
    let sprintRevision = 0;
    const sprintAutosave = createAutosave({ root: sprintForm,
      canSave: () => Boolean(sprintTarget.value) && sprintForm.checkValidity(),
      save: async () => {
        const revision = sprintRevision, target = value('giftSprintTargetRmb');
        try {
          await api('/api/settings', { giftSprintTargetRmb: target });
          if (revision === sprintRevision) {
            sprintSave.hidden = true;
            sprintStatus.hidden = true;
            await reloadState();
            if (revision === sprintRevision) sprintTarget.dataset.dirty = 'false';
          }
        } catch (error) {
          renderSaveStatus(sprintStatus, 'error', '目标自动保存失败，修改已保留，请重试。');
          sprintStatus.hidden = sprintSave.hidden = false;
        }
      } });
    sprintSave.hidden = true;
    sprintSave.textContent = '重试保存';
    sprintTarget.addEventListener('input', () => {
      sprintTarget.dataset.dirty = 'true';
      sprintRevision++;
      sprintAutosave.schedule();
    });
    sprintForm.addEventListener('submit', event => { event.preventDefault(); sprintAutosave.schedule(); void sprintAutosave.flush(); });

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
    await initLicenseAccountDevice();
  }

  function collectSettings() {
    return {
      roomId: value('roomId'),
    };
  }

  return { init, collectSettings };
}
