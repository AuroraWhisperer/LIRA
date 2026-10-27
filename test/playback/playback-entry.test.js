'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlaybackApp, flushAsyncWork } = require('../helpers/playback-app');

test('entry injects the same fixed response reader into cache and search consumers', async () => {
  const messages = [];
  const replacements = [];
  const app = await createPlaybackApp({ current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75 });
  await app.init({
    async readJsonResponse(response, message) {
      messages.push(message);
      return response.payload;
    },
  });
  await flushAsyncWork();
  assert.ok(messages.includes('读取音乐缓存失败'), 'cache operations must use the injected reader');
  app.element('playbackSearchKeyword').value = '测试歌曲';
  await app.emit('playbackSearchBtn', 'click');
  assert.ok(messages.includes('在线搜索失败'), 'search service must use the same injected reader');

  messages.length = 0;
  await app.init({
    async readJsonResponse(response, message) {
      replacements.push(message);
      return response.payload;
    },
  });
  await app.emit('playbackSearchBtn', 'click');
  assert.deepEqual(replacements, [], 'reinitialization must not replace constructed dependencies');
  assert.deepEqual(messages, ['在线搜索失败']);
});

test('entry retains the initial WeSing getter and reads it on each initialization', async () => {
  const app = await createPlaybackApp({ current: null, selectedSource: 'qq', mode: 'sequence', volume: 0.75 });
  let current = { enabled: false };
  const reads = [];
  await app.init({ getWeSingState: () => { reads.push(current); return current; } });
  await flushAsyncWork();
  current = { enabled: true };
  await app.init({ getWeSingState: () => { throw new Error('replacement getter must not be used'); } });
  assert.equal(reads.length, 2);
  assert.equal(reads[1], current);
});
