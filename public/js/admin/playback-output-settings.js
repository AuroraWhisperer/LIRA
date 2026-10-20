'use strict';

import { getPlaybackOutput } from '../playback/features/output-device.js';

export function initPlaybackOutputSettings({ documentRef = document } = {}) {
  const select = documentRef.getElementById('playbackOutputDevice');
  const refresh = documentRef.getElementById('playbackOutputRefresh');
  const feedback = documentRef.getElementById('playbackOutputFeedback');
  const audio = documentRef.getElementById('music-player');
  if (!select || !audio) return () => {};
  const output = getPlaybackOutput(audio);
  const unsubscribe = output.subscribe((state) => {
    const choices = [{ deviceId: '', name: '系统默认输出' }, ...state.devices];
    if (state.deviceId && !choices.some((device) => device.deviceId === state.deviceId)) {
      choices.push({ deviceId: state.deviceId, name: `${state.name}（未连接）`, disabled: true });
    }
    const signature = JSON.stringify(choices);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...choices.map((device) => {
        const option = documentRef.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.name;
        option.disabled = Boolean(device.disabled);
        return option;
      }));
      select.dataset.options = signature;
    }
    select.value = state.deviceId;
    select.disabled = !state.supported || state.busy || state.processing;
    select.title = state.processing ? state.message : '';
    refresh.disabled = !state.supported || state.busy;
    feedback.textContent = !state.supported ? '请在 LIRA 桌面客户端设置输出通道。'
      : state.busy ? '正在切换输出通道…' : state.message;
  });
  const change = () => { void output.select(select.value); };
  const refreshDevices = () => { void output.refresh(); };
  select.addEventListener('change', change);
  refresh.addEventListener('click', refreshDevices);
  return () => {
    unsubscribe();
    select.removeEventListener('change', change);
    refresh.removeEventListener('click', refreshDevices);
  };
}
