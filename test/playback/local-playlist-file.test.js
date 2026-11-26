'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlaybackApp, flushAsyncWork, track } = require('../helpers/playback-app');

const oldPath = 'X:/fixture/old.ogg';
const newPath = 'X:/fixture/new.ogg';
const remote = track('remote', '在线曲');
const local = { ...track(`local:${oldPath}`, '本地曲'), source: 'local', filePath: oldPath, fileName: 'old.ogg' };
const base = { selectedSource: 'qq', mode: 'sequence', volume: 0.7, displayHistory: [remote, local] };
const selected = { ok: true, files: [{ path: newPath, name: 'new.ogg' }] };

function fileBridge(pick = () => selected) {
  const files = { selections: 0, resolved: [] };
  files.options = {
    homeAction: 'recent',
    async selectLocalFiles() {
      files.selections++;
      return pick();
    },
    async resolveLocalMediaUrls(paths) {
      files.resolved.push(...paths);
      return { results: Object.fromEntries(paths.map(path =>
        [path, path === newPath ? { ok: true, url: 'local-media://media/new' } : { ok: false }])) };
    },
  };
  return files;
}

async function openApp(state, files) {
  const app = await createPlaybackApp(state, files.options);
  await app.init();
  await flushAsyncWork();
  return app;
}

async function playRecent(app) {
  await app.emitHomeAction();
  await app.emit('playbackDrawerActions', 'click', { target: { id: 'playbackDrawerPlayAll' } });
  await flushAsyncWork();
}

async function advance(app, natural = true) {
  if (natural) await app.emit('music-player', 'ended');
  else await app.emit('playbackNext', 'click');
  await flushAsyncWork();
}

test('a reselected recent playlist file survives the next lap and a new playback instance', async () => {
  const files = fileBridge();
  const app = await openApp(base, files);
  await playRecent(app);
  await advance(app);
  const first = app.savedState();
  assert.equal(first.current.filePath, newPath);
  assert.equal(first.normalQueueTracks[1].filePath, newPath);
  assert.equal(first.normalQueueTracks[1].fileName, 'new.ogg');
  assert.equal(first.normalQueueTracks[1].id, local.id);
  await advance(app);
  assert.equal(app.savedState().current.id, remote.id);
  await advance(app);
  assert.equal(app.element('music-player').src, 'local-media://media/new');
  assert.equal(files.selections, 1);

  const fresh = fileBridge();
  const reopened = await openApp(app.savedState(), fresh);
  await reopened.emit('playbackPlayPause', 'click');
  await flushAsyncWork();
  await advance(reopened);
  await advance(reopened);
  assert.equal(reopened.element('music-player').src, 'local-media://media/new');
  assert.equal(reopened.savedState().current.filePath, newPath);
  assert.ok(fresh.resolved.includes(newPath));
  assert.ok(!fresh.resolved.includes(oldPath));
  assert.equal(fresh.selections, 0);
});

test('reselection targets one occurrence among equal local track IDs', async () => {
  const files = fileBridge();
  const duplicate = [0, 1].map(playlistOccurrence => ({ ...local, playlistOccurrence }));
  const app = await openApp({ ...base, current: duplicate[0], currentOrigin: 'normal',
    queueType: 'playlist', playlistIndex: 0, normalQueueTracks: duplicate, normalQueue: [duplicate[1]] }, files);
  await advance(app, false);
  const saved = app.savedState();
  assert.equal(saved.current.playlistOccurrence, 1);
  assert.deepEqual(saved.normalQueueTracks.map(t => [t.playlistOccurrence, t.filePath]), [[0, oldPath], [1, newPath]]);
  assert.equal(files.selections, 1);
});

for (const [name, result] of [['cancelled', { canceled: true }], ['unresolved', { ok: true, files: [{ path: 'X:/fixture/missing.ogg' }] }]]) {
  test(`${name} selection leaves the playlist location available for retry`, async () => {
    const files = fileBridge(() => result);
    const app = await openApp(base, files);
    await playRecent(app);
    await advance(app, false);
    assert.equal(files.selections, 1);
    assert.equal(app.savedState().normalQueueTracks[1].filePath, oldPath);
  });
}

test('a late local picker cannot write into a restarted recent playlist with matching entries', async () => {
  const pending = Promise.withResolvers();
  const files = fileBridge(() => pending.promise);
  const app = await openApp(base, files);
  await playRecent(app);
  const advancing = advance(app, false);
  await flushAsyncWork();
  assert.equal(files.selections, 1);
  await playRecent(app);
  pending.resolve(selected);
  await advancing;
  assert.equal(app.savedState().current.id, remote.id);
  assert.equal(app.savedState().normalQueueTracks[1].filePath, oldPath);
});

test('skipping the first local row while its picker is open preserves that row in the active playlist', async () => {
  const pending = Promise.withResolvers();
  const files = fileBridge(() => pending.promise);
  const app = await openApp({ ...base, displayHistory: [local, remote] }, files);
  await playRecent(app);
  assert.equal(files.selections, 1);
  await advance(app, false);
  pending.resolve(selected);
  await flushAsyncWork();
  const saved = app.savedState();
  assert.equal(saved.current.id, remote.id);
  assert.equal(saved.normalQueueTracks[0].filePath, oldPath);
});
