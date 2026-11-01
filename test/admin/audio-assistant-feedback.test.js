'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant-feedback.js');

const missingChannel = '请先选择已有的独立原声通道；没有可用通道时可使用本地歌曲。';

test('restored deferred recovery stays inline during startup and polling, but an explicit retry gives feedback', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  const feedback = createAudioFeedback((message, options) => notices.push({ message, options }));
  feedback.receive({ ready: false, status: '电音助手尚未启动。' });
  const state = { ready: true, running: false, pendingRecovery: true, status: '音乐来源和设备已刷新。' };
  feedback.begin();
  feedback.receive(state);
  feedback.finish('get', { ok: true });
  for (const op of ['refresh', 'configure']) {
    feedback.begin();
    feedback.receive(state);
    feedback.finish(op, { ok: true });
  }
  state.status = '后台将在播放器下次启动时恢复原声。';
  for (let i = 0; i < 20; i++) feedback.receive({ ...state });
  assert.equal(notices.length, 0, 'A saved recovery task is not a new failure in the current playback');
  feedback.begin();
  feedback.receive(state);
  feedback.finish('recover', { ok: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].options.type, 'warning');
  feedback.receive({ ...state });
  assert.equal(notices.length, 1);
});

test('new deferred recovery still warns after processing, including when old recovery tasks are present', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  for (const inheritedRecovery of [false, true]) {
    const notices = [];
    const feedback = createAudioFeedback((message) => notices.push(message));
    const state = { ready: true, pendingRecovery: inheritedRecovery, status: '音乐来源和设备已刷新。' };
    feedback.receive(state);
    feedback.receive({ ...state, starting: true, status: '正在启动音频处理…' });
    feedback.receive({ ...state, running: true, status: '原声已隔离 · 等待播放器声音' });
    assert.equal(notices.length, 0, 'Existing recovery work must not interrupt the next processing session');
    const stopped = { ...state, pendingRecovery: true, status: '已停止；后台将在播放器下次启动时恢复原声。' };
    feedback.receive(stopped);
    feedback.receive(stopped);
    assert.equal(notices.length, 1, 'Recovery needed after the current session must still be announced');
  }
});

test('a real recovery failure is reported even in the first startup snapshot', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  const feedback = createAudioFeedback((message, options) => notices.push({ message, options }));
  feedback.begin();
  feedback.receive({ ready: true, pendingRecovery: true, status: '原声通道恢复未完成：native error' });
  feedback.finish('get', { ok: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].options.type, 'error');
});

test('a closed player with restored channels needs no warning or manual restart', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  const feedback = createAudioFeedback((message, options) => notices.push({ message, options }));
  const state = { ready: true, pendingRecovery: true, recoveryDeferred: true,
    status: '原声通道已恢复；播放器的输出设置将在下次播放时自动还原。' };
  feedback.receive({ ...state, running: true, status: '正在处理当前歌曲' });
  feedback.begin();
  feedback.receive(state);
  feedback.finish('stop', { ok: true });
  for (let i = 0; i < 20; i++) feedback.receive({ ...state });
  assert.equal(notices.length, 0, 'Normal background cleanup must not be announced as a failure');
  feedback.begin();
  feedback.receive(state);
  feedback.finish('recover', { ok: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].options.type, 'info');
  feedback.receive(state);
  assert.equal(notices.length, 1);

  const failed = { ...state, recoveryDeferred: false, status: '原声通道恢复未完成：test error' };
  feedback.receive(failed);
  assert.equal(notices.at(-1).options.type, 'error');
  feedback.receive({ ...failed, recoveryDeferred: true });
  assert.equal(notices.at(-1).options.type, 'error', 'Actual errors must take precedence over deferred flags');
});

test('command failures and repeated background states produce one toast, while an explicit retry can notify again', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  const feedback = createAudioFeedback((message, options) => notices.push({ message, options }));
  const state = { ready: true, pendingRecovery: true,
    status: `${missingChannel}\n已停止；后台将在播放器下次启动时恢复原声。` };
  feedback.begin();
  feedback.receive(state);
  feedback.receive(state);
  assert.equal(notices.length, 0, 'Wait for the pending operation result instead of announcing its state twice');
  feedback.finish('start', { ok: false, error: missingChannel });
  for (let i = 0; i < 30; i++) feedback.receive(state);
  feedback.receive({ ...state, status: '后台将在播放器下次启动时恢复原声。' });
  assert.equal(notices.length, 1, 'Recovery polling must not replace the failure toast or restart its timer');
  assert.equal(notices[0].options.type, 'error');
  feedback.begin();
  feedback.receive(state);
  feedback.finish('start', { ok: false, error: missingChannel });
  assert.equal(notices.length, 2, 'A fresh attempt must give feedback even after the old toast expires');
});

test('asynchronous failures, safe automatic stops and deferred recovery notify without a failed command', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  let closed = 0;
  const feedback = createAudioFeedback((message, options) => {
    notices.push({ message, options });
    return { close: () => closed++ };
  });
  feedback.receive({ ready: false, status: '电音助手尚未启动。' });
  feedback.receive({ ready: true, status: '音乐来源和设备已刷新。' });
  feedback.receive({ ready: true, running: true, status: '原声已隔离 · 等待播放器声音' });
  assert.equal(notices.length, 0, 'Normal playback and successful refresh stay quiet');
  const disconnected = { ready: false, status: 'Worker exited unexpectedly' };
  feedback.receive(disconnected);
  feedback.receive(disconnected);
  assert.equal(notices.length, 1);
  feedback.receive({ ready: true, status: '当前歌曲处理已关闭' });
  feedback.receive({ ready: true, status: '歌曲或播放器已切换，需要处理时请重新开启。\n当前歌曲处理已关闭' });
  assert.equal(notices.at(-1).options.type, 'info');
  feedback.begin();
  feedback.receive({ ready: true, pendingRecovery: true, status: '原声恢复未完成：native error' });
  feedback.finish('recover', { ok: true });
  assert.equal(notices.at(-1).options.type, 'error', 'The native recovery command can succeed while its state reports a failure');
  feedback.begin();
  feedback.receive({ ready: true, pendingRecovery: true, status: '后台将在播放器下次启动时恢复原声。' });
  feedback.finish('recover', { ok: true });
  assert.equal(notices.at(-1).options.type, 'warning');
  const count = notices.length;
  feedback.dispose();
  feedback.receive(disconnected);
  feedback.fail('file');
  assert.equal(notices.length, count);
  assert.equal(closed, 1);
});
