'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('connection and song request forms save independently and preserve pending or failed drafts', async () => {
  const values = {
    roomId: '123',
    paused: 'true',
    queueLimit: '30',
    userCooldownSeconds: '60',
    onlyFromLibrary: 'false',
    allowDuplicate: 'false',
    songRequestBlacklist: '78\n不要唱',
  };
  const listeners = new Map();
  const elements = new Map();
  const requests = [];
  const notices = [];
  const renderedBlacklists = [];
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

  const blacklist = elements.get('songRequestBlacklist');
  listeners.get('songRequestSettingsForm:input')({ target: blacklist });
  assert.deepEqual(blacklist.dataset, { preserveDirty: 'true', dirty: 'true' });
  saveOutcome = Promise.withResolvers();
  const pending = listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  values.songRequestBlacklist = '78\n保存期间继续编辑';
  listeners.get('songRequestSettingsForm:change')({ target: blacklist });
  saveOutcome.resolve();
  await pending;
  assert.equal(blacklist.dataset.dirty, 'true');
  assert.equal(requests[2].payload.songRequestBlacklist, '78\n不要唱');
  assert.deepEqual(renderedBlacklists.at(-1), { savedValue: '78\n不要唱', dirty: 'true' });

  saveOutcome = Promise.withResolvers();
  const failed = listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  saveOutcome.reject(new Error('save failed'));
  await assert.rejects(failed, /save failed/);
  assert.equal(blacklist.dataset.dirty, 'true');
  assert.equal(reloads, 3);
  assert.equal(notices.length, 3);

  saveOutcome = null;
  await listeners.get('songRequestSettingsForm:submit')({ preventDefault() {} });
  assert.equal(blacklist.dataset.dirty, 'false');
  assert.equal(requests[4].payload.songRequestBlacklist, values.songRequestBlacklist);
});
