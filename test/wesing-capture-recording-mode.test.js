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
    }
  });

  await capture.setActive(true);

  // 首次采样：进度为 0，应该等待
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 0, totalSec: 180 });
  let state = capture.getStatus();
  assert.ok(state.currentMs <= 200, `初始currentMs应该接近0，实际: ${state.currentMs}ms`);
  assert.equal(state.playing, false, '进度为0时应该等待播放');
  assert.equal(state.waitingForPlayback, true);

  // 100ms 后，进度仍然是 0（录制准备状态）
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 0, totalSec: 180 });
  state = capture.getStatus();
  assert.ok(state.currentMs <= 200, `暂停时currentMs应该接近0，实际: ${state.currentMs}ms`);
  assert.equal(state.playing, false, '进度不变时应该保持等待');

  // 500ms 后，进度变为 1 秒（真正开始播放）
  currentTime = 1500;
  onSample({ detected: true, title: '全民K歌 - 测试歌曲', currentSec: 1, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度开始变化时应该启动播放');
  assert.equal(state.waitingForPlayback, false);

  await capture.setActive(false);
});

test('WeSing capture pauses quickly when progress stops changing at non-zero position', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    }
  });

  await capture.setActive(true);

  // 首次采样：进度为 58 秒（录制模式的静态显示）
  onSample({ detected: true, title: '全民K歌 - 收集诗句', currentSec: 58, totalSec: 207 });
  let state = capture.getStatus();
  assert.equal(state.trackTitle, '收集诗句');
  assert.equal(state.durationMs, 207000);
  // 第一次采样到非零进度，会立即启动（兼容正常播放场景）
  assert.equal(state.playing, true);

  // 100ms 后，进度仍然是 58 秒（静态不变）
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 收集诗句', currentSec: 58, totalSec: 207 });
  state = capture.getStatus();
  assert.equal(state.playing, true, '300ms内应该还在播放');

  // 400ms 后（超过 PAUSED_AFTER_MS = 300ms），进度仍然是 58 秒
  currentTime = 1400;
  onSample({ detected: true, title: '全民K歌 - 收集诗句', currentSec: 58, totalSec: 207 });
  state = capture.getStatus();
  assert.equal(state.playing, false, '进度超过300ms不变应该暂停');

  // 确认暂停在正确的位置
  const pausedMs = state.currentMs;
  assert.ok(pausedMs > 58000 && pausedMs < 59000, `应该暂停在约58秒，实际: ${pausedMs}ms`);

  // 600ms 后，进度仍然是 58 秒，应该保持暂停
  currentTime = 1600;
  onSample({ detected: true, title: '全民K歌 - 收集诗句', currentSec: 58, totalSec: 207 });
  state = capture.getStatus();
  assert.equal(state.playing, false, '应该保持暂停状态');
  assert.equal(state.currentMs, pausedMs, '暂停后时间应该不再增长');

  // 用户点击播放，进度变为 59 秒
  currentTime = 2000;
  onSample({ detected: true, title: '全民K歌 - 收集诗句', currentSec: 59, totalSec: 207 });
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
    }
  });

  await capture.setActive(true);

  // 开始播放一首歌
  onSample({ detected: true, title: '全民K歌 - 第一首', currentSec: 10, totalSec: 180 });
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 第一首', currentSec: 11, totalSec: 180 });
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
    loading: true
  });
  state = capture.getStatus();
  assert.equal(state.trackTitle, '第二首');
  assert.ok(state.currentMs <= 200, `加载时currentMs应该接近0，实际: ${state.currentMs}ms`);
  assert.equal(state.playing, false, '加载时应该暂停');

  // 加载中，100ms后仍然显示加载
  currentTime = 2100;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 0,
    totalSec: 200,
    loading: true
  });
  state = capture.getStatus();
  assert.ok(state.currentMs <= 200, `加载期间currentMs应该接近0，实际: ${state.currentMs}ms`);
  assert.equal(state.playing, false, '加载期间应该保持暂停');

  // 加载完成，开始播放
  currentTime = 3000;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 0,
    totalSec: 200,
    loading: false
  });
  state = capture.getStatus();
  assert.ok(state.currentMs <= 200, `加载完成后currentMs应该接近0，实际: ${state.currentMs}ms`);
  assert.equal(state.playing, false, '加载完成但进度为0时应该等待');

  // 真正开始播放
  currentTime = 3100;
  onSample({
    detected: true,
    title: '全民K歌 - 第二首',
    currentSec: 1,
    totalSec: 200,
    loading: false
  });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度变化时应该开始播放');

  await capture.setActive(false);
});

test('WeSing capture handles pause and resume correctly with 300ms threshold', async () => {
  let onSample = null;
  let currentTime = 1000;
  const capture = createWeSingCapture({
    platform: 'win32',
    now: () => currentTime,
    monitorFactory(callback) {
      onSample = callback;
      return { start() {}, stop() {} };
    }
  });

  await capture.setActive(true);

  // 开始播放
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 30, totalSec: 180 });
  currentTime = 1100;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 31, totalSec: 180 });
  let state = capture.getStatus();
  assert.equal(state.playing, true);

  // 用户按下暂停，进度停止变化
  currentTime = 1200;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 31, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, true, '100ms内应该还在播放');

  // 250ms，还在阈值内
  currentTime = 1350;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 31, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, true, '250ms内应该还在播放');

  // 超过 300ms 后
  currentTime = 1550;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 31, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, false, '超过300ms后应该暂停');

  const pausedMs = state.currentMs;

  // 继续暂停
  currentTime = 2000;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 31, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, false);
  assert.equal(state.currentMs, pausedMs, '暂停时时间不应增长');

  // 用户恢复播放
  currentTime = 2100;
  onSample({ detected: true, title: '全民K歌 - 测试', currentSec: 32, totalSec: 180 });
  state = capture.getStatus();
  assert.equal(state.playing, true, '进度变化应该恢复播放');

  await capture.setActive(false);
});
