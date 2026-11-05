'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('song request edits autosave independently, serialize newer drafts and retain failed or incomplete edits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = () => new Promise(setImmediate);
  const values = {
    roomId: '123',
    paused: 'true',
    scSongRequestEnabled: 'false',
    songRequestCancelEnabled: 'false',
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
  let valid = true;
  const { createSettingsForm } = await loadModuleExports(path.resolve('public/js/admin/settings-form.js'), {
    setTimeout, clearTimeout,
  });
  const form = createSettingsForm({
    documentRef: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            id,
            dataset: {},
            checkValidity: () => valid,
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
  t.mock.timers.tick(1000);
  assert.equal(requests.length, 0, 'initialization must not save default values');
  await listeners.get('settingsForm:submit')({ preventDefault() {} });
  assert.deepEqual(requests, [{ url: '/api/settings', payload: { roomId: '123' } }]);

  const paused = { id: 'paused', tagName: 'SELECT', dataset: {} };
  elements.set('paused', paused);
  listeners.get('songRequestSettingsForm:input')({ target: paused });
  values.queueLimit = '40';
  listeners.get('songRequestSettingsForm:change')({ target: paused });
  t.mock.timers.tick(499);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].payload.queueLimit, '40');
  assert.equal(requests[1].payload.songRequestCancelEnabled, 'false');
  assert.equal(Object.hasOwn(requests[1].payload, 'roomId'), false);
  assert.equal(reloads, 2);
  assert.deepEqual(notices, ['设置已保存'], 'autosaves do not interrupt editing with success toasts');
  assert.deepEqual(renderedBlacklists, [{ savedValue: '78\n不要唱', dirty: 'false' }]);
  assert.deepEqual(renderedUserBlacklists, [{ savedValue: values.songRequestUserBlacklist, dirty: 'false' }]);
  const savedState = elements.get('songRequestSettingsSaveState').textContent;
  elements.get('queueLimit').tagName = 'INPUT';
  listeners.get('songRequestSettingsForm:change')({ target: elements.get('queueLimit') });
  t.mock.timers.tick(500);
  assert.equal(requests.length, 2, 'leaving an already saved input must not submit it again');

  const blacklist = elements.get('songRequestBlacklist');
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  assert.deepEqual(blacklist.dataset, { preserveDirty: 'true', dirty: 'true' });
  saveOutcome = Promise.withResolvers();
  t.mock.timers.tick(500);
  values.songRequestBlacklist = '78\n保存期间继续编辑';
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  const userBlacklist = elements.get('songRequestUserBlacklist');
  values.songRequestUserBlacklist = '[]';
  listeners.get('songRequestSettingsForm:input')({ target: userBlacklist });
  t.mock.timers.tick(500);
  assert.equal(requests.length, 3, 'an in-flight write must not overlap a newer write');
  saveOutcome.resolve();
  await settle();
  assert.equal(blacklist.dataset.dirty, 'true');
  assert.equal(requests[2].payload.songRequestBlacklist, '78\n不要唱');
  assert.equal(renderedBlacklists.length, 1, 'a late save does not redraw over a newer blacklist draft');
  assert.equal(renderedUserBlacklists.length, 1, 'a late save does not restore removed users');
  assert.equal(userBlacklist.dataset.dirty, 'true');
  t.mock.timers.tick(500);
  await settle();
  assert.equal(requests[3].payload.songRequestBlacklist, values.songRequestBlacklist);
  assert.equal(requests[3].payload.songRequestUserBlacklist, '[]');
  assert.equal(blacklist.dataset.dirty, 'false');
  assert.equal(userBlacklist.dataset.dirty, 'false');

  values.songRequestBlacklist = '失败时的草稿';
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  saveOutcome = Promise.withResolvers();
  t.mock.timers.tick(500);
  saveOutcome.reject(new Error('save failed'));
  await settle();
  assert.notEqual(elements.get('songRequestSettingsSaveState').textContent, savedState);
  assert.equal(elements.get('songRequestSettingsSave').hidden, false);
  assert.equal(blacklist.dataset.dirty, 'true');
  t.mock.timers.tick(5000);
  assert.equal(requests.length, 5, 'a failure must not start an unbounded retry loop');

  saveOutcome = null;
  await listeners.get('songRequestSettingsSave:click')();
  assert.equal(blacklist.dataset.dirty, 'false');
  assert.equal(requests[5].payload.songRequestBlacklist, values.songRequestBlacklist);

  valid = false;
  listeners.get('songRequestSettingsForm:input')({ target: userBlacklist });
  t.mock.timers.tick(500);
  await settle();
  assert.equal(requests.length, 6, 'incomplete user rows must not be saved');
  valid = true;
  listeners.get('songRequestSettingsForm:compositionstart')();
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  t.mock.timers.tick(500);
  assert.equal(requests.length, 6, 'IME input must finish before saving');
  listeners.get('songRequestSettingsForm:compositionend')();
  t.mock.timers.tick(500);
  await settle();
  assert.equal(requests.length, 7);
});
