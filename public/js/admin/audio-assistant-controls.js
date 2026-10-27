'use strict';

import { createAudioFeedback, formatAudioStatus } from './audio-assistant-feedback.js';
import { withPlaybackOutputLocked } from '../playback/features/output-device.js';

const FIELDS = [
  { key: 'strength', label: '人声 / 伴奏比例', min: -100, max: 100, value: 80, presets: [[-100, '人声'], [0, '原唱'], [100, '伴奏']], help: '调整歌声与伴奏的比例，去人声后仍可能残留少量歌声。如果全民 K 歌播放的已经是伴奏，无需再去人声，选择「原唱」即可；仍可单独升降调。' },
  { key: 'speedPercent', label: '变速', min: 50, max: 200, value: 100, unit: '%', presets: [[50, '0.5×'], [100, '正常'], [150, '1.5×'], [200, '2.0×']], help: '100% 为正常速度。LIRA 内置播放和本地歌曲可调 0.5–2 倍，保持调性；开启「当前歌曲」后生效。实时采集外部播放器时固定为原速。' },
  { key: 'semitones', label: '升降调', min: -12, max: 12, value: 0, presets: [[-12, '−12'], [-6, '−6'], [0, '原调'], [6, '+6'], [12, '+12']], help: '每调整 1 格就改变 1 个半音；只改变音高，不影响速度。' },
  { key: 'volume', label: '输出音量', min: 0, max: 200, value: 70, presets: [], help: '0% 为静音，100% 为原音量，最高 200%。超过 100% 会放大，较响的歌曲可能失真。' },
];

export function formatAudioParameter(key, value) {
  if (key === 'strength') return value === 0 ? '原唱' : `${value < 0 ? '人声' : '伴奏'} ${Math.abs(value)}%`;
  if (key === 'speedPercent') return `${(value / 100).toFixed(2)}×`;
  if (key === 'semitones') return `${value > 0 ? '+' : ''}${value} 半音`;
  return `${value}%`;
}

export function formatAudioDeviceName(name) {
  if (/OMEN Cam & Voice/i.test(name) || (/VB-Audio/i.test(name) && /CABLE/i.test(name))) {
    return `${name.replace(/^(?:Speakers?|扬声器)\s*\((.+)\)$/i, '$1')} · 虚拟音频通道`;
  }
  return name.replace(/^Speakers?\b/i, '扬声器').replace(/^Headphones?\b/i, '耳机');
}

function createControls(root) {
  const compact = root.dataset.audioControls === 'compact';
  for (const field of FIELDS.filter((item) => !compact || item.key !== 'volume')) {
    const group = document.createElement('div');
    group.className = 'audio-assistant-slider';
    group.dataset.audioGroup = field.key;
    const id = `audio-${compact ? 'quick' : 'full'}-${field.key}`;
    // Only fixed, application-owned field metadata is used in this template.
    group.innerHTML = `<div class="audio-assistant-slider-heading"><div class="audio-assistant-label"><label for="${id}">${field.label}</label></div><output data-audio-value="${field.key}" for="${id}"></output></div>
      <div class="audio-assistant-slider-track"><input id="${id}" type="range" min="${field.min}" max="${field.max}" step="1" value="${field.value}" data-audio-setting="${field.key}" /></div>
      <div class="audio-assistant-presets"></div>`;
    if (!compact && field.help) {
      const help = document.createElement('lira-help');
      help.setAttribute('label', `${field.label}说明`);
      help.textContent = field.help;
      group.querySelector('.audio-assistant-label').append(help);
    }
    if (!compact) {
      const numeric = document.createElement('input');
      Object.assign(numeric, { type: 'number', min: String(field.min), max: String(field.max), step: '1', value: String(field.value) });
      numeric.setAttribute('aria-label', `${field.label}数值${field.unit || ''}`);
      numeric.dataset.audioSetting = field.key;
      group.querySelector('.audio-assistant-slider-track').append(numeric);
      if (field.unit) {
        const unit = document.createElement('span');
        unit.textContent = field.unit;
        group.querySelector('.audio-assistant-slider-track').append(unit);
      }
    }
    for (const [value, label] of field.presets) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.audioPreset = field.key;
      button.dataset.value = String(value);
      group.querySelector('.audio-assistant-presets').append(button);
    }
    root.append(group);
  }
}

export function getAudioSourceOptions(apps = [], selected = 'auto') {
  const labels = { qqmusic: 'QQ 音乐', cloudmusic: '网易云音乐', lira: 'LIRA 内置播放器', msedge: '微软 Edge 浏览器', chrome: '谷歌 Chrome 浏览器', firefox: '火狐浏览器' };
  const sources = apps.flatMap((app) => {
    const [process, ...parts] = app.name.split(' · ');
    const title = parts.join(' · ');
    const name = labels[process.toLowerCase()] || (process.toLowerCase().includes('wesing') ? '全民 K 歌' : '');
    if (!name) return app.id === selected ? [{ id: app.id, name: '其他应用（建议使用自动识别）' }] : [];
    return [{ id: app.id, name: title && !/^PID \d+$/.test(title) && title !== name && title !== process ? `${name} · ${title}` : name }];
  });
  return [
    { id: 'auto', name: '自动识别当前音乐（推荐）' },
    { id: 'file', name: '本地文件' },
    { id: 'input', name: '麦克风、线路或声卡回送' },
    { id: 'loopback', name: '播放设备里的声音' },
    ...sources.map((app, index) => ({
      ...app,
      name: sources.filter((other) => other.name === app.name).length > 1 ? `${app.name}（音频 ${sources.slice(0, index + 1).filter((other) => other.name === app.name).length}）` : app.name,
      group: '手动指定播放音乐的应用',
    })),
  ];
}

export function getAudioInputChannels(channels = 0) {
  const options = [{ id: 'auto', name: channels === 1 ? '自动（单声道）' : channels > 1 ? '自动（声道 1 / 2）' : '自动' }];
  for (let channel = 0; channel < Math.min(channels, 128); channel++) {
    if (channel % 2 === 0 && channel + 1 < channels) options.push({ id: `stereo:${channel}`, name: `声道 ${channel + 1} / ${channel + 2}（立体声）` });
    options.push({ id: `mono:${channel}`, name: `声道 ${channel + 1}（单声道）` });
  }
  return options;
}

function updateOptions(select, items, selected, missingLabel = '设备已断开，请重新选择') {
  const options = items.map((item) => ({ ...item }));
  if (selected && !options.some((item) => item.id === selected)) options.push({ id: selected, name: missingLabel, disabled: true });
  const signature = JSON.stringify(options);
  if (select.dataset.options !== signature) {
    const nodes = [];
    const groups = new Map();
    for (const item of options) {
      const option = new Option(item.name, item.id);
      option.disabled = Boolean(item.disabled);
      if (!item.group) { nodes.push(option); continue; }
      if (!groups.has(item.group)) {
        const group = document.createElement('optgroup');
        group.label = item.group;
        groups.set(item.group, group);
        nodes.push(group);
      }
      groups.get(item.group).append(option);
    }
    select.replaceChildren(...nodes);
    select.dataset.options = signature;
  }
  if (select.value !== selected) select.value = selected;
}

export function createAudioParameterQueue(send, onChange) {
  const pending = {};
  const edits = new Map();
  let revision = 0;
  let writing = Promise.resolve(true);
  let activeWrites = 0;
  return {
    pending,
    change(key, value) { pending[key] = value; edits.set(key, ++revision); },
    flush() {
      const patch = { ...pending };
      const versions = new Map(edits);
      if (!Object.keys(patch).length) return activeWrites ? writing : Promise.resolve(true);
      activeWrites++;
      writing = writing.then(async () => {
        const ok = await send(patch);
        for (const key of Object.keys(patch)) if (edits.get(key) === versions.get(key)) delete pending[key];
        activeWrites--;
        onChange();
        return ok;
      });
      return writing;
    },
  };
}

export function initAudioAssistantControls({ enabled, signal, bridge = window.audioAssistant }) {
  const page = document.getElementById('otherAudioAssistantFeature');
  const mainPage = page.closest('.main-page');
  const panel = document.getElementById('audioAssistantPanel');
  const roots = [page, panel];
  const controls = roots.flatMap((root) => [...root.querySelectorAll('[data-audio-controls]')]);
  for (const root of controls) createControls(root);
  const feedback = createAudioFeedback();
  let state = { ready: false, settings: Object.fromEntries(FIELDS.map((field) => [field.key, field.value])), source: 'auto' };
  const changes = createAudioParameterQueue((patch) => invoke('configure', patch), render);
  const optimistic = changes.pending;
  let timer;
  let processingAction = 0;
  let loading = null;
  let refreshing = null;
  let disposed = false;

  function render() {
    if (disposed) return;
    const settings = { ...state.settings, ...optimistic };
    const selectedSource = optimistic.source ?? state.source;
    const local = selectedSource === 'file';
    const deviceSource = selectedSource === 'input' || selectedSource === 'loopback';
    const musicAvailable = !deviceSource || settings.inputMusic === true;
    const busy = state.running || state.starting;
    const speedAvailable = local || (optimistic.source === undefined && state.internalSource === true);
    const preparing = state.ready ? '' : '音频组件尚未就绪，请稍候；仍不可用时，请重新打开电音助手。';
    const speedHint = speedAvailable ? '' : '当前来源为外部实时采集，固定原速。变速请使用 LIRA 内置播放或本地歌曲文件。';
    const routingHints = {
      source: '请先关闭「当前歌曲」，停止处理后再切换音乐来源。',
      cableId: '请先关闭「当前歌曲」，停止处理后再切换原声通道。',
      outputId: '请先关闭「当前歌曲」，停止处理后再切换最终输出。',
      inputId: '请先关闭「处理声音」，再切换输入设备。',
      loopbackId: '请先关闭「处理声音」，再切换采集设备。',
      inputChannels: '请先关闭「处理声音」，再切换输入声道。',
      inputMusic: '请先关闭「处理声音」，再切换音乐处理。',
    };
    if (deviceSource) {
      routingHints.source = '请先关闭「处理声音」，再切换声音来源。';
      routingHints.outputId = '请先关闭「处理声音」，再切换最终输出。';
    }
    const outputs = (state.outputs || []).map((device) => ({ ...device, name: formatAudioDeviceName(device.name) }));
    updateOptions(document.getElementById('audioAssistantSource'), getAudioSourceOptions(state.apps, selectedSource),
      selectedSource, '未找到之前的来源，请重新选择');
    updateOptions(document.getElementById('audioAssistantCable'), [{ id: '', name: '请选择独立通道', disabled: true }, ...outputs], settings.cableId || '');
    const outputChoices = state.outputChoices || outputs;
    updateOptions(document.getElementById('audioAssistantOutput'), [{ id: '', name: local || deviceSource ? 'Windows 默认输出' : '自动跟随播放器原输出' }, ...outputChoices], settings.outputId || '');
    const inputSelect = document.getElementById('audioAssistantInput');
    const inputKey = selectedSource === 'loopback' ? 'loopbackId' : 'inputId';
    inputSelect.dataset.audioSetting = inputKey;
    updateOptions(inputSelect, [{ id: '', name: 'Windows 默认设备' }, ...(selectedSource === 'loopback' ? outputs : state.inputs || [])], settings[inputKey] || '');
    updateOptions(document.getElementById('audioAssistantInputChannels'), getAudioInputChannels(state.inputDevice?.channels),
      settings.inputChannels || 'auto', '之前的声道不可用，请重新选择');
    document.getElementById('audioAssistantDeviceInput').hidden = !deviceSource;
    document.getElementById('audioAssistantInputHint').textContent = selectedSource === 'loopback'
      ? '采集所选设备中正在播放的声音；最终输出须选另一个设备。这路声音会包含该设备上的其他应用。'
      : '接入麦克风、线路或声卡回送。监听麦克风请使用耳机；使用声卡回送时，请在声卡里排除最终输出，避免声音循环。';
    const format = state.inputDevice;
    document.getElementById('audioAssistantInputFormat').textContent = state.inputError || (format
      ? `自动适配 · ${format.sampleRate.toLocaleString()} Hz · ${format.channels} 声道` : '接好设备后点击「刷新设备」。');
    document.getElementById('audioAssistantFileRow').hidden = !local;
    document.getElementById('audioAssistantIsolation').hidden = local || deviceSource;
    document.getElementById('audioAssistantFileName').textContent = state.fileName || '尚未选择';
    document.getElementById('audioAssistantSourceDevice').textContent = state.sourceDevice ? `原输出：${formatAudioDeviceName(state.sourceDevice)}` : '';
    for (const root of roots) {
      for (const label of root.querySelectorAll('[data-audio-active-label]')) label.textContent = deviceSource ? '处理声音' : '当前歌曲';
      for (const label of root.querySelectorAll('[data-audio-source-label]')) label.textContent = deviceSource ? '当前来源' : '当前歌曲';
      for (const input of root.querySelectorAll('[data-audio-setting]')) {
        const key = input.dataset.audioSetting;
        if (input.type === 'checkbox') input.checked = key === 'original' ? optimistic.original ?? state.original ?? false : settings[key] === true;
        else if (input.tagName !== 'SELECT') {
          const value = String(key === 'strength' && !musicAvailable ? 0 : key === 'speedPercent' && !speedAvailable ? 100 : settings[key] ?? '');
          if (input.value !== value) input.value = value;
        }
        const title = preparing || (key === 'strength' && !musicAvailable ? '当前保留输入人声。需要处理音乐时，先停止，再启用「音乐处理」。' : '')
          || (key === 'speedPercent' ? speedHint : '') || (busy ? routingHints[key] || '' : '');
        if (input.title !== title) input.title = title;
        if (input.disabled !== Boolean(title)) input.disabled = Boolean(title);
      }
      for (const output of root.querySelectorAll('[data-audio-value]')) {
        const key = output.dataset.audioValue;
        output.textContent = key === 'strength' && !musicAvailable ? '保留输入人声'
          : formatAudioParameter(key, key === 'speedPercent' && !speedAvailable ? 100 : settings[key]);
      }
      for (const button of root.querySelectorAll('[data-audio-preset]')) {
        const key = button.dataset.audioPreset;
        button.title = preparing || (key === 'strength' && !musicAvailable ? '需要处理音乐时，先停止，再启用「音乐处理」。' : '')
          || (key === 'speedPercent' ? speedHint : '');
        button.disabled = Boolean(button.title);
        button.setAttribute('aria-pressed', String(Number(button.dataset.value) === (key === 'speedPercent' && !speedAvailable ? 100 : settings[key])));
      }
      for (const toggle of root.querySelectorAll('[data-audio-active]')) {
        toggle.checked = Boolean(busy);
        toggle.setAttribute('aria-label', deviceSource ? '处理输入声音' : '处理当前歌曲');
        toggle.disabled = !enabled() || !state.ready;
      }
      for (const song of root.querySelectorAll('[data-audio-song]')) { song.textContent = state.song || '等待播放器播放歌曲'; song.title = song.textContent; }
      for (const status of root.querySelectorAll('[data-audio-status]')) {
        const message = formatAudioStatus(state);
        if (status.textContent !== message) status.textContent = message;
      }
      for (const button of root.querySelectorAll('[data-audio-action]')) {
        const action = button.dataset.audioAction;
        const stoppedAction = { recover: '恢复原声', refresh: '刷新设备', file: '选择歌曲' }[action];
        button.title = preparing || (busy && stoppedAction ? `请先关闭「${deviceSource ? '处理声音' : '当前歌曲'}」，停止处理后再${stoppedAction}。` : '');
        button.disabled = Boolean(button.title);
      }
      for (const group of root.querySelectorAll('[data-audio-group="speedPercent"]')) group.classList.toggle('is-unavailable', !speedAvailable);
      for (const group of root.querySelectorAll('[data-audio-group="strength"]')) group.classList.toggle('is-unavailable', !musicAvailable);
    }
    for (const meter of page.querySelectorAll('[data-audio-level]')) {
      const level = Math.round(Math.min(1, Math.max(0, state[meter.dataset.audioLevel] || 0)) * 100);
      meter.setAttribute('aria-valuenow', String(level));
      meter.firstElementChild.style.width = `${level}%`;
    }
  }

  function receive(next) {
    if (disposed || (next.revision && next.revision < (state.revision || 0))) return;
    state = { ...state, ...next, settings: next.settings || state.settings, source: next.source || state.source };
    feedback.receive(state);
    render();
  }

  async function invoke(op, value) {
    if (!bridge) { feedback.fail(op, '请从 Windows 桌面客户端使用电音助手。'); return false; }
    const action = op === 'start' || op === 'stop' ? ++processingAction : processingAction;
    feedback.begin();
    try {
      const request = () => op === 'start' && (disposed || !enabled() || action !== processingAction)
        ? { ok: true }
        : bridge.invoke({ op, ...(value === undefined ? {} : { value }) });
      const result = await (op === 'start'
        ? withPlaybackOutputLocked(document.getElementById('music-player'), request)
        : request());
      if (disposed) return false;
      if (result.state) receive(result.state);
      feedback.finish(op, result);
      return result.ok;
    } catch (failure) {
      feedback.finish(op, { ok: false, error: failure.message });
      return false;
    }
  }

  function flush() {
    clearTimeout(timer);
    return changes.flush();
  }

  function change(key, value) {
    changes.change(key, value);
    render();
    clearTimeout(timer);
    timer = setTimeout(flush, 70);
  }

  async function load() {
    if (disposed || state.ready || loading) return loading;
    loading = invoke('get').finally(() => { loading = null; });
    return loading;
  }

  async function refreshInventory() {
    if (disposed || !state.ready || state.running || state.starting) return false;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (!await flush() || disposed) return false;
      return invoke('refresh');
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  for (const root of roots) {
    root.addEventListener('lira-select-open', (event) => {
      if (event.target.matches('select[data-audio-setting]')) void refreshInventory();
    }, { signal });
    root.addEventListener('input', (event) => {
      const input = event.target.closest('[data-audio-setting]');
      if (!input || input.tagName === 'SELECT' || input.type === 'checkbox') return;
      if (!input.validity.valid || input.value === '') return;
      change(input.dataset.audioSetting, Number(input.value));
    }, { signal });
    root.addEventListener('change', async (event) => {
      const input = event.target;
      if (input.matches('[data-audio-active]')) {
        const active = input.checked;
        if (refreshing) await refreshing;
        if (!await flush()) { render(); return; }
        if (active && !enabled()) { render(); return; }
        await invoke(active ? 'start' : 'stop');
        render();
      } else if (input.matches('select[data-audio-setting], input[type="checkbox"][data-audio-setting]')) {
        change(input.dataset.audioSetting, input.type === 'checkbox' ? input.checked : input.value);
        await flush();
      }
    }, { signal });
    root.addEventListener('click', async (event) => {
      const preset = event.target.closest('[data-audio-preset]');
      if (preset) { change(preset.dataset.audioPreset, Number(preset.dataset.value)); return; }
      const action = event.target.closest('[data-audio-action]')?.dataset.audioAction;
      if (!action) return;
      if (action === 'refresh') { await refreshInventory(); return; }
      if (action === 'reset') {
        for (const [key, value] of Object.entries({ strength: 0, speedPercent: 100, semitones: 0, volume: 60, original: false })) {
          changes.change(key, value);
        }
        render();
        await flush();
        return;
      }
      if (!await flush()) return;
      if (action === 'file') {
        try {
          const result = await window.musicAPI?.selectLocalFiles();
          if (disposed) return;
          if (result?.ok && !result.canceled && result.files?.length) await invoke('file', result.files[0].path);
          else if (!result?.ok) feedback.fail('file', result?.error);
        } catch { feedback.fail('file'); }
      } else await invoke(action);
    }, { signal });
  }
  const unsubscribe = bridge?.onState(receive);
  function loadVisibleSettings() {
    if (!page.hidden && mainPage.classList.contains('active')) void load();
  }
  const observer = new MutationObserver(loadVisibleSettings);
  observer.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(mainPage, { attributes: true, attributeFilter: ['class'] });
  panel.addEventListener('toggle', () => { if (panel.matches(':popover-open')) void load(); }, { signal });
  render();
  if (enabled()) void load();
  else loadVisibleSettings();
  return {
    setEnabled(value) {
      render();
      if (value) void load();
      else void invoke('stop');
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      unsubscribe?.();
      feedback.dispose();
      for (const root of controls) root.replaceChildren();
    },
  };
}
