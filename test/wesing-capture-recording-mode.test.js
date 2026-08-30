// 测试全民K歌录制模式下的歌词行为
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createWeSingCapture } = require('../src/music/wesing-capture');

test('WeSing capture waits for progress change when starting at 0 seconds', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);

  // 首次采样：进度为 0，应该等待
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 0,
    totalSec: 180,
  });
  let state = capture.getStatus();
  assert.ok(
    state.currentMs <= 200,
    `初始currentMs应该接近0，实际: ${state.currentMs}ms`,
  );
  assert.equal(state.playing, false, '进度为0时应该等待播放');
  assert.equal(state.waitingForPlayback, true);

  // 100ms 后，进度仍然是 0（录制准备状态）
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 0,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.ok(
    state.currentMs <= 200,
    `暂停时currentMs应该接近0，实际: ${state.currentMs}ms`,
  );
  assert.equal(state.playing, false, '进度不变时应该保持等待');

  // 500ms 后，进度变为 1 秒（真正开始播放）
  currentTime = 1500;
  onSample({
    detected: true,
    title: '全民K歌 - 测试歌曲',
    currentSec: 1,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度开始变化时应该启动播放');
  assert.equal(state.waitingForPlayback, false);

  await capture.setActive(false);
});

test('WeSing capture distinguishes an unchanged integer second from a confirmed pause', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);

  // 首次采样：进度为 58 秒（录制模式的静态显示）
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 58,
    totalSec: 207,
  });
  let state = capture.getStatus();
  assert.equal(state.trackTitle, '收集诗句');
  assert.equal(state.durationMs, 207000);
  // 第一次采样到非零进度，会立即启动（兼容正常播放场景）
  assert.equal(state.playing, true);

  // 100ms 后，进度仍然是 58 秒（静态不变）
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 58,
    totalSec: 207,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '300ms内应该还在播放');

  // 400ms 后仍可能只是整数秒显示尚未跳动，不能误判为暂停
  currentTime = 1400;
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 58,
    totalSec: 207,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '同一个整数秒内应该继续播放');

  // 超过 1.5 秒仍不变化，才确认全民已经暂停
  currentTime = 2601;
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 58,
    totalSec: 207,
  });
  state = capture.getStatus();
  assert.equal(state.playing, false, '进度超过1.5秒不变应该暂停');

  // 确认暂停在正确的位置
  const pausedMs = state.currentMs;
  assert.ok(
    pausedMs > 59000 && pausedMs < 60000,
    `应该冻结连续时钟，实际: ${pausedMs}ms`,
  );

  // 继续收到相同进度时，应该保持暂停
  currentTime = 2800;
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 58,
    totalSec: 207,
  });
  state = capture.getStatus();
  assert.equal(state.playing, false, '应该保持暂停状态');
  assert.equal(state.currentMs, pausedMs, '暂停后时间应该不再增长');

  // 用户点击播放，进度变为 59 秒
  currentTime = 2000;
  onSample({
    detected: true,
    title: '全民K歌 - 收集诗句',
    currentSec: 59,
    totalSec: 207,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度变化时应该恢复播放');

  await capture.setActive(false);
});

test('WeSing capture resets lyrics to 0 during loading state', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);

  // 开始播放一首歌
  onSample({
    detected: true,
    title: '全民K歌 - 第一首',
    currentSec: 10,
    totalSec: 180,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 第一首',
    currentSec: 11,
    totalSec: 180,
  });
  let state = capture.getStatus();
  assert.equal(state.playing, true);
  assert.ok(state.currentMs > 10000);

  // 切换到新歌，显示"歌曲加载中"
  currentTime = 2000;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 0,
    totalSec: 200,
    loading: true,
  });
  state = capture.getStatus();
  assert.equal(state.trackTitle, '第二首');
  assert.ok(
    state.currentMs <= 200,
    `加载时currentMs应该接近0，实际: ${state.currentMs}ms`,
  );
  assert.equal(state.playing, false, '加载时应该暂停');

  // 加载中，100ms后仍然显示加载
  currentTime = 2100;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 0,
    totalSec: 200,
    loading: true,
  });
  state = capture.getStatus();
  assert.ok(
    state.currentMs <= 200,
    `加载期间currentMs应该接近0，实际: ${state.currentMs}ms`,
  );
  assert.equal(state.playing, false, '加载期间应该保持暂停');

  // 加载完成，开始播放
  currentTime = 3000;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 0,
    totalSec: 200,
    loading: false,
  });
  state = capture.getStatus();
  assert.ok(
    state.currentMs <= 200,
    `加载完成后currentMs应该接近0，实际: ${state.currentMs}ms`,
  );
  assert.equal(state.playing, false, '加载完成但进度为0时应该等待');

  // 真正开始播放
  currentTime = 3100;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 1,
    totalSec: 200,
    loading: false,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度变化时应该开始播放');

  await capture.setActive(false);
});

test('WeSing capture handles pause and resume with integer-second progress', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);

  // 开始播放
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 30,
    totalSec: 180,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  let state = capture.getStatus();
  assert.equal(state.playing, true);

  // 用户按下暂停，进度停止变化
  currentTime = 1200;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '100ms内应该还在播放');

  // 250ms，还在阈值内
  currentTime = 1350;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '250ms内应该还在播放');

  // 同一个整数秒内不能误判为暂停
  currentTime = 1550;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '不足1.5秒时应该保持播放');

  // 超过 1.5 秒后才确认暂停
  currentTime = 2701;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, false, '超过1.5秒后应该暂停');

  const pausedMs = state.currentMs;

  // 继续暂停
  currentTime = 3000;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 31,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, false);
  assert.equal(state.currentMs, pausedMs, '暂停时时间不应增长');

  // 用户恢复播放
  currentTime = 3100;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 32,
    totalSec: 180,
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度变化应该恢复播放');

  await capture.setActive(false);
});

test('WeSing capture freezes immediately when recording removes the progress text', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 10,
    totalSec: 180,
  });
  currentTime = 1100;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 11,
    totalSec: 180,
  });
  assert.equal(capture.getStatus().playing, true);

  currentTime = 1200;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: -1,
    totalSec: -1,
  });
  const stoppedAt = capture.getStatus().currentMs;
  assert.equal(stoppedAt, 11230);
  assert.equal(capture.getStatus().playing, false);
  assert.equal(capture.getStatus().lyricState.playing, false);

  currentTime = 5000;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: -1,
    totalSec: -1,
  });
  assert.equal(capture.getStatus().currentMs, stoppedAt);
  assert.equal(capture.getStatus().playing, false);

  await capture.setActive(false);
});

test('WeSing capture uses audio activity when current WeSing exposes no progress text', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);

  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    loading: true,
    audioActive: true,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, false, '加载优先于音频活动状态');

  currentTime = 1500;
  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    loading: false,
    audioActive: true,
  });
  assert.equal(capture.getStatus().currentMs, 0);
  assert.equal(capture.getStatus().playing, true, '真实音频开始时应启动歌词');
  assert.equal(capture.getStatus().waitingForPlayback, false);

  currentTime = 2500;
  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: true,
  });
  assert.equal(capture.getStatus().currentMs, 1000);
  assert.equal(capture.getStatus().playing, true);

  currentTime = 2750;
  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: false,
  });
  const stoppedAt = capture.getStatus().currentMs;
  assert.equal(stoppedAt, 1250);
  assert.equal(capture.getStatus().playing, false, '停止录制时应立即冻结');
  assert.equal(capture.getStatus().lyricState.playing, false);

  currentTime = 5000;
  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: false,
  });
  assert.equal(capture.getStatus().currentMs, stoppedAt);

  currentTime = 5200;
  onSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: true,
  });
  assert.equal(capture.getStatus().playing, true, '恢复播放时应继续歌词时钟');
  assert.equal(capture.getStatus().currentMs, stoppedAt);

  await capture.setActive(false);
});

test('WeSing capture lets explicit audio inactivity override stale UI progress', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 10,
    totalSec: 180,
    audioActive: true,
  });
  assert.equal(capture.getStatus().playing, true);

  currentTime = 1200;
  onSample({
    detected: true,
    title: '全民K歌 - 测试',
    currentSec: 10,
    totalSec: 180,
    audioActive: false,
  });
  assert.equal(capture.getStatus().playing, false);
  assert.equal(
    capture.getStatus().currentMs,
    10130,
    '暂停时应锚定全民报告的真实进度',
  );

  await capture.setActive(false);
});

test('WeSing capture keeps a measured pause frozen even when the audio session stays active', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  const sample = (currentSec) =>
    onSample({
      detected: true,
      title: '全民K歌 - 失眠飞行',
      currentSec,
      totalSec: 207,
      audioActive: true,
      audioPeak: 0,
    });

  sample(30);
  currentTime = 2000;
  sample(31);
  currentTime = 3600;
  sample(31);
  const pausedMs = capture.getStatus().currentMs;
  assert.equal(capture.getStatus().playing, false);

  currentTime = 5000;
  sample(31);
  assert.equal(
    capture.getStatus().playing,
    false,
    'Active 不能推翻不变的真实进度',
  );
  assert.equal(capture.getStatus().currentMs, pausedMs);

  currentTime = 5200;
  sample(32);
  assert.equal(capture.getStatus().playing, true, '真实进度重新变化后才恢复');
  assert.ok(capture.getStatus().currentMs >= 32130);

  await capture.setActive(false);
});

test('WeSing capture resets a same-title replay when measured progress returns to zero', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    },
  });

  await capture.setActive(true);
  const sample = (currentSec, audioActive = true) =>
    onSample({
      detected: true,
      title: '全民K歌 - 失眠飞行',
      currentSec,
      totalSec: 207,
      audioActive,
    });

  sample(121);
  currentTime = 2000;
  sample(122);
  assert.equal(capture.getStatus().playing, true);

  currentTime = 3000;
  sample(122, false);
  assert.equal(capture.getStatus().playing, false);

  currentTime = 10000;
  sample(122, false);
  currentTime = 11000;
  sample(122, true);
  assert.equal(
    capture.getStatus().playing,
    false,
    '同歌重进时的陈旧进度不能恢复旧时钟',
  );

  currentTime = 11200;
  sample(0, true);
  assert.equal(capture.getStatus().currentMs, 130);
  assert.equal(
    capture.getStatus().playing,
    false,
    '归零后应等待全民真实进度开始走',
  );

  currentTime = 12200;
  sample(1, true);
  assert.equal(capture.getStatus().playing, true);
  assert.ok(
    capture.getStatus().currentMs >= 1130 &&
      capture.getStatus().currentMs < 1200,
  );

  await capture.setActive(false);
});
