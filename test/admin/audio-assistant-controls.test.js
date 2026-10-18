'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant-controls.js');

test('audio device labels explain virtual channels and translate speakers without hiding the device identity', async () => {
  const { formatAudioDeviceName } = await loadModuleExports(entry);
  assert.equal(formatAudioDeviceName('Speaker (Realtek(R) Audio)'), '扬声器 (Realtek(R) Audio)');
  assert.equal(formatAudioDeviceName('扬声器 (OMEN Cam & Voice)'), 'OMEN Cam & Voice · 虚拟音频通道');
  assert.equal(formatAudioDeviceName('CABLE Input (VB-Audio Virtual Cable)'), 'CABLE Input (VB-Audio Virtual Cable) · 虚拟音频通道');
  assert.equal(formatAudioDeviceName('Headphones (WH-1000XM6)'), '耳机 (WH-1000XM6)');
  assert.equal(formatAudioDeviceName('USB DAC'), 'USB DAC');
});

test('music sources use readable names and hide unrecognized background apps without changing source IDs', async () => {
  const { getAudioSourceOptions } = await loadModuleExports(entry);
  const options = getAudioSourceOptions([
    { id: 'pid:1', name: 'msedge · PID 1' },
    { id: 'pid:2', name: 'HP.OMEN.VadRedirectHelper · PID 2' },
    { id: 'pid:3', name: 'QQMusic · 晴天 · 周杰伦' },
    { id: 'pid:4', name: 'WeSing · PID 4' },
  ]);
  assert.deepEqual(Array.from(options, ({ id, name }) => ({ id, name })), [
    { id: 'auto', name: '自动识别正在播放的音乐（推荐）' },
    { id: 'file', name: '本地文件' },
    { id: 'pid:1', name: '微软 Edge 浏览器' },
    { id: 'pid:3', name: 'QQ 音乐 · 晴天 · 周杰伦' },
    { id: 'pid:4', name: '全民 K 歌' },
  ]);
  assert.ok(options.slice(2).every((option) => option.group === '手动指定播放音乐的应用'));
  assert.equal(getAudioSourceOptions().length, 2);
});

test('duplicate browser audio sources remain distinguishable and a previously selected unknown app stays selected', async () => {
  const { getAudioSourceOptions } = await loadModuleExports(entry);
  const apps = [
    { id: 'pid:12', name: 'msedge · PID 12' },
    { id: 'pid:34', name: 'msedge · PID 34' },
    { id: 'pid:56', name: 'unknown · PID 56' },
  ];
  const options = getAudioSourceOptions(apps, 'pid:56');
  assert.equal(options[2].name, '微软 Edge 浏览器（音频 1）');
  assert.equal(options[3].name, '微软 Edge 浏览器（音频 2）');
  assert.equal(options[4].id, 'pid:56');
  assert.equal(options[4].name, '其他应用（建议使用自动识别）');
  assert.ok(options.every((option) => !/PID|进程/.test(option.name)));
});

test('audio parameter writes retain a newer same-value edit while earlier requests complete', async () => {
  const { createAudioParameterQueue } = await loadModuleExports(entry);
  const sends = [];
  const completions = [];
  const queue = createAudioParameterQueue((value) => {
    sends.push(JSON.parse(JSON.stringify(value)));
    return new Promise((resolve) => completions.push(resolve));
  }, () => {});
  queue.change('semitones', 1);
  const first = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  queue.change('semitones', 2);
  const second = queue.flush();
  queue.change('semitones', 1);
  completions[0](true);
  await first;
  assert.equal(queue.pending.semitones, 1, 'The newer edit must not be cleared just because its value matches an older request');
  const third = queue.flush();
  await new Promise((resolve) => setImmediate(resolve));
  completions[1](true);
  await second;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.pending.semitones, 1);
  completions[2](true);
  assert.equal(await third, true);
  assert.deepEqual(sends, [{ semitones: 1 }, { semitones: 2 }, { semitones: 1 }]);
  assert.equal(Object.keys(queue.pending).length, 0);
});

test('audio parameter queue reports failed changes before a caller starts playback and can retry', async () => {
  const { createAudioParameterQueue, formatAudioParameter } = await loadModuleExports(entry);
  let success = false;
  const queue = createAudioParameterQueue(async () => success, () => {});
  queue.change('volume', 0);
  assert.equal(await queue.flush(), false);
  assert.equal(await queue.flush(), true, 'A handled failure must not block later device refresh or file selection');
  success = true;
  queue.change('volume', 0);
  assert.equal(await queue.flush(), true);
  assert.equal(formatAudioParameter('strength', 0), '原唱');
  assert.equal(formatAudioParameter('speedPercent', 150), '1.50×');
  assert.equal(formatAudioParameter('semitones', -12), '-12 Key');
});
