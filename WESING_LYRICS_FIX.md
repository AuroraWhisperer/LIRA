# 全民K歌桌面歌词同步修复

## 问题描述

用户报告了两个关键问题：

1. **全民K歌暂停时，桌面歌词继续播放** - 原先需要等待 1.5 秒才检测到暂停
2. **全民K歌加载时，桌面歌词就开始播放** - 应该等加载完成并真正开始播放后才同步歌词

### 具体场景

- 全民K歌在"继续录制"状态下，会显示静态的进度条（如 `00:58 | 03:27`），但实际并未播放
- 全民K歌加载新歌时，显示"歌曲加载中"，桌面歌词应该保持在起点等待

## 修复内容

### 修改的文件

1. `src/music/wesing-capture.js` - 核心逻辑修复
2. `test/wesing-capture-recording-mode.test.js` - 新增测试用例

### 关键修改

#### 1. 缩短暂停检测延迟（第14行）

```javascript
// 之前：const PAUSED_AFTER_MS = 1500;
// 现在：const PAUSED_AFTER_MS = 300;
```

**效果**：全民K歌暂停后，桌面歌词在 300ms 内也会暂停（而不是 1.5 秒）

#### 2. 加载状态强制重置（第403-411行）

```javascript
if (sample.loading === true) {
  resetPlaybackClock(timestamp);
  state.currentMs = 0;  // 强制归零
  state.playing = false;
  state.message = `全民 K 歌正在加载《${title}》，歌词将在播放后开始。`;
  updateLyricState();
  emit();
  return;
}
```

**效果**：检测到"歌曲加载中"时，歌词重置到 0 并暂停播放

#### 3. 智能首次进度检测（第413-446行）

```javascript
if (hasSampledProgress) {
  const progressChanged = lastProgressMs >= 0 && sampledCurrentMs !== lastProgressMs;
  const isFirstProgress = lastProgressMs < 0;

  if (progressChanged) {
    // 进度变化了，立即启动播放
    startPlaybackClock(timestamp);
    state.playing = true;
  } else if (isFirstProgress) {
    // 首次采样到进度
    if (sampledCurrentMs > 0) {
      // 进度 > 0，假设正在播放（兼容正常场景）
      startPlaybackClock(timestamp);
      state.playing = true;
    } else {
      // 进度 = 0，等待确认播放
      pausePlaybackClock(timestamp);
      state.playing = false;
      state.waitingForPlayback = true;
    }
  } else if (timestamp - lastProgressChangeAt > PAUSED_AFTER_MS) {
    // 进度超过 300ms 不变，判定为暂停
    pausePlaybackClock(timestamp);
    state.playing = false;
  }
}
```

**效果**：
- 首次采样到进度为 0：等待进度变化才开始播放
- 首次采样到进度 > 0：立即播放（兼容正常播放场景）
- 进度停止变化超过 300ms：判定为暂停

## 测试验证

### 新增测试用例（全部通过 ✅）

1. **等待进度变化再播放** - 验证从 0 秒开始时会等待
2. **静态进度快速暂停** - 验证录制模式下的静态进度会在 300ms 内暂停
3. **加载状态重置** - 验证加载时歌词保持在起点
4. **暂停与恢复** - 验证 300ms 暂停阈值的准确性

### 原有测试（全部通过 ✅）

所有 11 个原有测试用例保持通过，确保没有破坏现有功能。

**总计：15 个测试全部通过**

## 工作原理

### 场景 1：全民K歌录制准备状态

```
时间线：
00:00 - 检测到窗口标题"全民K歌 - 收集诗句"，进度 58 秒
00:00 - 桌面歌词启动播放时钟（因为进度 > 0）
00:100 - 进度仍然是 58 秒（静态）
00:300 - 进度仍然是 58 秒，超过阈值 → 暂停歌词 ✅
00:500 - 用户点击播放，进度变为 59 秒
00:500 - 检测到进度变化 → 恢复播放 ✅
```

### 场景 2：全民K歌加载新歌

```
时间线：
00:00 - 检测到"歌曲加载中"，loading: true
00:00 - 桌面歌词重置为 0，playing: false ✅
00:500 - 仍然在加载
00:500 - 桌面歌词保持在 0 ✅
01:000 - 加载完成，进度显示 0 秒
01:000 - 桌面歌词等待，不播放 ✅
01:100 - 进度变为 1 秒（真正开始播放）
01:100 - 桌面歌词开始播放 ✅
```

### 场景 3：正常播放与暂停

```
时间线：
00:00 - 进度 30 秒，正在播放
00:100 - 进度 31 秒 → 继续播放 ✅
00:200 - 用户暂停，进度停在 31 秒
00:200 - 桌面歌词继续播放（阈值内）
00:550 - 进度仍是 31 秒，超过 300ms → 暂停歌词 ✅
```

## 兼容性

- ✅ 保持了原有的 fallback clock 机制（当进度文本不可用时使用本地时钟）
- ✅ 保持了对正常播放场景的兼容（进度 > 0 时立即播放）
- ✅ 改进了暂停检测的响应速度（1500ms → 300ms）
- ✅ 新增了对加载状态的正确处理

## 结论

修复已完成并通过所有测试。现在桌面歌词能够：

1. ✅ 在全民K歌暂停时快速暂停（300ms 内）
2. ✅ 在全民K歌加载时保持在起点等待
3. ✅ 在全民K歌录制准备状态下不会误判为播放
4. ✅ 在进度真正开始变化时才启动播放

请重启软件测试实际效果。
