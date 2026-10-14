'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('cooldown controls switch modes without the removed explanatory paragraph', async () => {
  const { renderSongCooldownControls } = await loadModuleExports(path.resolve('public/js/admin/song-cooldown-settings.js'));
  const elements = {
    songCooldownMode: { value: 'off' }, songCooldownAmount: {},
    songCooldownValue: { validity: { valid: true }, setAttribute(name, value) { this[name] = value; } },
  };
  for (const mode of ['off', 'hours', 'days', 'off']) {
    elements.songCooldownMode.value = mode;
    renderSongCooldownControls({ getElementById: (id) => elements[id] });
    assert.equal(elements.songCooldownAmount.hidden, mode === 'off');
    assert.equal(elements.songCooldownValue.disabled, mode === 'off');
    assert.equal(elements.songCooldownValue['aria-label'], mode === 'days' ? '冷却自然日数' : '冷却小时数');
  }
});

test('connection and song request forms save independently and preserve pending or failed drafts', async () => {
  const values = {
    roomId: '123',
    paused: 'true',
    queueLimit: '30',
    userCooldownSeconds: '60',
    userQueueLimit: '2',
    userCooldownCaptainSeconds: '',
    userCooldownAdmiralSeconds: '30',
    userCooldownGovernorSeconds: '0',
    songRequestMinMedalLevel: '5',
    songRequestGuardLevel: '3',
    songRequestGuardMedalBypass: 'false',
    songRequestUserBlacklist: '[{"uid":"123","name":"观众","expiresAt":0}]',
    songCooldownMode: 'hours',
    songCooldownValue: '6',
    onlyFromLibrary: 'false',
    allowDuplicate: 'false',
    guardPriorityEnabled: 'true',
    songRequestBlacklist: '78\n不要唱',
  };
  const listeners = new Map();
  const elements = new Map();
  const requests = [];
  const notices = [];
  const renderedBlacklists = [];
  const renderedUserBlacklists = [];
  let reloads = 0;
  let saveOutcome;
  const { createSettingsForm } = await loadModuleExports(path.resolve('public/js/admin/settings-form.js'));
  const form = createSettingsForm({
    documentRef: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            dataset: {},
            addEventListener(event, handler) {
              const key = `${id}:${event}`;
              assert.equal(listeners.has(key), false);
              listeners.set(key, handler);
            },
          });
        }
        return elements.get(id);
      },
    },
    value: (id) => values[id],
    api: async (url, payload) => {
      requests.push({ url, payload: { ...payload } });
      if (saveOutcome) await saveOutcome.promise;
      return { data: { settings: payload } };
    },
    toast: (message) => notices.push(message),
    getState: () => ({ reloadState: async () => reloads++ }),
    initLicenseAccountDevice: async () => {},
    blindboxSettings: { init() {} },
    blacklistEditor: {
      init() {},
      render(savedValue) {
        renderedBlacklists.push({ savedValue, dirty: elements.get('songRequestBlacklist').dataset.dirty });
      },
    },
    userBlacklistEditor: {
      init() {},
      render(savedValue) {
        renderedUserBlacklists.push({ savedValue, dirty: elements.get('songRequestUserBlacklist').dataset.dirty });
      },
    },
  });
  await form.init();
  await listeners.get('settingsForm:submit')({ preventDefault() {} });
  assert.deepEqual(requests, [{ url: '/api/settings', payload: { roomId: '123' } }]);
  assert.equal(typeof listeners.get('songRequestSettingsForm:submit'), 'function');
  await listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  const { roomId, ...requestSettings } = values;
  assert.deepEqual(requests[1], { url: '/api/settings', payload: requestSettings });
  assert.equal(requests.length, 2);
  assert.equal(reloads, 2);
  assert.deepEqual(notices, ['设置已保存', '点歌设置已保存']);
  assert.deepEqual(renderedBlacklists, [{ savedValue: '78\n不要唱', dirty: 'false' }]);
  assert.deepEqual(renderedUserBlacklists, [{ savedValue: values.songRequestUserBlacklist, dirty: 'false' }]);
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '已保存');

  const blacklist = elements.get('songRequestBlacklist');
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  assert.deepEqual(blacklist.dataset, { preserveDirty: 'true', dirty: 'true' });
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '有未保存修改');
  saveOutcome = Promise.withResolvers();
  const pending = listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  assert.equal(elements.get('songRequestSettingsSave').disabled, true);
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '保存中…');
  values.songRequestBlacklist = '78\n保存期间继续编辑';
  listeners.get('songRequestSettingsForm:change')({ target: blacklist });
  const userBlacklist = elements.get('songRequestUserBlacklist');
  values.songRequestUserBlacklist = '[]';
  listeners.get('songRequestSettingsForm:input')({ target: userBlacklist });
  saveOutcome.resolve();
  await pending;
  assert.equal(blacklist.dataset.dirty, 'true');
  assert.equal(requests[2].payload.songRequestBlacklist, '78\n不要唱');
  assert.equal(renderedBlacklists.length, 1, 'a late save does not redraw over a newer blacklist draft');
  assert.equal(renderedUserBlacklists.length, 1, 'a late save does not restore removed users');
  assert.equal(userBlacklist.dataset.dirty, 'true');
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '有未保存修改');

  saveOutcome = Promise.withResolvers();
  const failed = listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  saveOutcome.reject(new Error('save failed'));
  await assert.rejects(failed, /save failed/);
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '保存失败，修改已保留，请重试');
  assert.equal(elements.get('songRequestSettingsSave').disabled, false);
  assert.equal(blacklist.dataset.dirty, 'true');
  assert.equal(userBlacklist.dataset.dirty, 'true');
  assert.equal(reloads, 3);
  assert.equal(notices.length, 3);

  saveOutcome = null;
  await listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  assert.equal(blacklist.dataset.dirty, 'false');
  assert.equal(elements.get('songRequestSettingsSaveState').textContent, '已保存');
  assert.equal(requests[4].payload.songRequestBlacklist, values.songRequestBlacklist);
  assert.equal(requests[4].payload.songRequestUserBlacklist, '[]');
  assert.equal(userBlacklist.dataset.dirty, 'false');
  assert.equal(renderedUserBlacklists.at(-1).savedValue, '[]');
});
