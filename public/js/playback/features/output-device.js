'use strict';

import { createNativeOutput } from './native-output.js';

export const PLAYBACK_OUTPUT_KEY = 'playbackOutput:v1';
const outputs = new WeakMap();
const DEFAULT_OUTPUT = { deviceId: '', name: '系统默认输出' };
const PROCESSING_HINT = '请先关闭电音助手的「当前歌曲」，停止处理后再切换输出通道。';
const RECOVERY_HINT = '请先在电音助手中点击「恢复原声」，恢复后再切换输出通道。';
const MISSING_HINT = '之前选择的输出通道已断开，播放已暂停。请接回设备，或重新选择输出通道。';

function readPreference(value) {
  try {
    const saved = JSON.parse(value);
    if (typeof saved?.deviceId === 'string' && typeof saved?.name === 'string') return saved;
  } catch { return { ...DEFAULT_OUTPUT }; }
  return { ...DEFAULT_OUTPUT };
}

export function getPlaybackOutput(audio, options = {}) {
  if (outputs.has(audio)) return outputs.get(audio);
  const windowRef = options.windowRef || window;
  const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
  const bridge = options.bridge || windowRef.audioAssistant;
  const nativeBridge = options.nativeBridge || windowRef.playbackOutput;
  let storage = options.storage;
  if (!storage) { try { storage = windowRef.localStorage; } catch { storage = null; } }
  let selected;
  try { selected = readPreference(storage?.getItem(PLAYBACK_OUTPUT_KEY)); } catch { selected = { ...DEFAULT_OUTPUT }; }
  const supported = Boolean(nativeBridge || options.nativeOutput)
    || typeof audio.setSinkId === 'function' && typeof mediaDevices?.enumerateDevices === 'function';
  const listeners = new Set();
  let devices = [];
  let message = '';
  let blocked = false;
  let busy = false;
  let processing = false;
  let startLocks = 0;
  let recoveryPending = false;
  let assistantRevision = 0;
  let deferredPreference = null;
  let disposed = false;
  let revision = 0;
  let pending = Promise.resolve();
  let appliedId = audio.sinkId || '';
  const native = options.nativeOutput || (nativeBridge ? createNativeOutput(audio, { bridge: nativeBridge,
    onFault: (error) => {
      blocked = true;
      appliedId = null;
      message = error;
      audio.pause();
      publish();
    },
  }) : null);

  function snapshot() {
    return { ...selected, devices, supported, busy, processing: processing || startLocks > 0,
      message: recoveryPending ? RECOVERY_HINT : processing || startLocks ? PROCESSING_HINT : message };
  }

  function publish() {
    if (!disposed) for (const listener of listeners) listener(snapshot());
  }

  async function enumerate() {
    const browserDevices = (await mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audiooutput' && device.deviceId && !['default', 'communications'].includes(device.deviceId))
      .map((device, index) => ({ deviceId: device.deviceId,
        name: `${native ? '自动：' : ''}${device.label || `输出设备 ${index + 1}`}` }));
    if (!native) return browserDevices;
    const nativeDevices = await native.enumerate();
    if (selected.deviceId.startsWith('asio:') && !nativeDevices.some(device => device.deviceId === selected.deviceId)
      && nativeDevices.some(device => device.deviceId === selected.deviceId.split('|')[0])) {
      nativeDevices.push({ ...selected, backend: 'asio', name: `${selected.name}（连接待检查）` });
    }
    return [...nativeDevices, ...browserDevices];
  }

  function select(deviceId, { save = true, preference = null } = {}) {
    if (disposed) return Promise.resolve(false);
    if (processing || startLocks) {
      if (!save) {
        deferredPreference = preference || { ...selected, deviceId };
        blocked = true;
        audio.pause();
      }
      publish();
      return Promise.resolve(false);
    }
    const request = ++revision;
    busy = true;
    publish();
    pending = pending.then(async () => {
      if (disposed || request !== revision) return false;
      try {
        if (!supported) {
          if (deviceId) throw new Error('当前环境无法切换输出，请在 LIRA 桌面客户端重新选择。');
          return true;
        }
        const available = await enumerate();
        if (disposed || request !== revision) return false;
        devices = available;
        if (processing) {
          if (!save) deferredPreference = preference || { ...selected, deviceId };
          throw new Error(PROCESSING_HINT);
        }
        const next = deviceId ? devices.find((device) => device.deviceId === deviceId) : DEFAULT_OUTPUT;
        if (!next) throw new Error(MISSING_HINT);
        if (native) {
          appliedId = null;
          if (next.backend) await native.select(deviceId);
          else await native.browser(deviceId);
        } else await audio.setSinkId(deviceId);
        appliedId = deviceId;
        if (disposed || request !== revision) return false;
        selected = { ...next };
        if (next.backend === 'asio') {
          devices = await enumerate();
          selected = { ...(devices.find(device => device.deviceId === deviceId) || next) };
        }
        blocked = Boolean(deferredPreference);
        message = '';
        if (save && !deferredPreference) {
          try {
            storage.setItem(PLAYBACK_OUTPUT_KEY, JSON.stringify(selected));
            message = '输出通道已切换并保存。';
          } catch {
            message = '本次已切换，但未能保存。重新打开 LIRA 后请再次设置。';
          }
        }
        return true;
      } catch (error) {
        if (disposed || request !== revision) return false;
        if (!save) selected = preference || { ...selected, deviceId };
        const missing = selected.deviceId && !devices.some((device) => device.deviceId === selected.deviceId);
        blocked = selected.deviceId !== (native ? appliedId : audio.sinkId || '') || Boolean(missing) || Boolean(deferredPreference);
        if (blocked) audio.pause();
        message = error.name === 'NotAllowedError'
          ? '无法访问这个输出通道，请在 LIRA 桌面客户端重新选择。'
          : error.name === 'NotFoundError' ? MISSING_HINT
            : [MISSING_HINT, PROCESSING_HINT].includes(error.message) ? error.message
              : deviceId.startsWith('asio:') ? 'ASIO 驱动未能启动，请检查声卡连接及驱动设置，或选择其他输出方式。'
              : '输出通道切换失败，请检查设备连接后重试。';
        return false;
      } finally {
        if (!disposed && request === revision) { busy = false; publish(); }
      }
    });
    return pending;
  }

  async function refresh() {
    await pending;
    if (disposed || !supported) return;
    const request = revision;
    try {
      const available = await enumerate();
      if (disposed || busy || request !== revision) return;
      devices = available;
      if (selected.deviceId && !devices.some((device) => device.deviceId === selected.deviceId)) {
        blocked = true;
        audio.pause();
        message = MISSING_HINT;
      } else if (blocked && !processing && !startLocks) {
        await select(selected.deviceId, { save: false });
      }
    } catch {
      message = '未能读取输出设备，请稍后点击「刷新设备」重试。';
    }
    publish();
  }

  function onStorage(event) {
    if (event.key !== PLAYBACK_OUTPUT_KEY || event.storageArea && event.storageArea !== storage) return;
    const preference = readPreference(event.newValue);
    void select(preference.deviceId, { save: false, preference });
  }

  function applyDeferred() {
    if (processing || startLocks || !deferredPreference) return;
    const preference = deferredPreference;
    deferredPreference = null;
    void select(preference.deviceId, { save: false, preference });
  }

  async function waitForOutput() {
    let current;
    do { current = pending; await current; } while (current !== pending);
  }

  const unsubscribe = bridge?.onState((state) => {
    if (state.revision && state.revision < assistantRevision) return;
    assistantRevision = state.revision || assistantRevision;
    recoveryPending = Boolean(state.internalSource && state.pendingRecovery && state.recoveryDeferred !== true);
    processing = Boolean(state.starting || state.internalSource && state.running || recoveryPending);
    applyDeferred();
    publish();
  });
  windowRef.addEventListener?.('storage', onStorage);
  mediaDevices?.addEventListener?.('devicechange', refresh);

  const output = {
    select,
    refresh,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async prepare() {
      await waitForOutput();
      if (blocked) throw new Error('内置播放器输出通道不可用，请到「百宝箱 → 设置」重新选择。');
      try { await native?.prepare(); }
      catch {
        blocked = true;
        audio.pause();
        message = '输出设备无法启动，请重新选择输出通道。';
        publish();
        throw new Error(message);
      }
    },
    async lockWhile(task) {
      startLocks++;
      publish();
      try {
        await waitForOutput();
        return await task();
      } finally {
        startLocks--;
        applyDeferred();
        publish();
      }
    },
    dispose() {
      disposed = true;
      revision++;
      unsubscribe?.();
      native?.dispose();
      windowRef.removeEventListener?.('storage', onStorage);
      mediaDevices?.removeEventListener?.('devicechange', refresh);
      listeners.clear();
      outputs.delete(audio);
    },
  };
  outputs.set(audio, output);
  void select(selected.deviceId, { save: false });
  return output;
}

export function preparePlaybackOutput(audio) {
  return getPlaybackOutput(audio).prepare();
}

export function withPlaybackOutputLocked(audio, task) {
  return audio ? getPlaybackOutput(audio).lockWhile(task) : task();
}
