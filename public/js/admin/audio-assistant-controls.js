'use strict';

const FIELDS = [
  { key: 'strength', label: '声伴比例', min: -100, max: 100, value: 80, presets: [[-100, '人声'], [0, '原唱'], [100, '伴奏']], help: '连续调整人声与伴奏。分离为模型估算，可能有残留。' },
  { key: 'speedPercent', label: '变速', min: 50, max: 200, value: 100, unit: '%', presets: [[50, '0.5×'], [100, '正常'], [150, '1.5×'], [200, '2.0×']], help: '100% 为正常速度。本地歌曲可调 0.5–2 倍，保持调性；外部实时采集固定原速。' },
  { key: 'semitones', label: '升降调', min: -12, max: 12, value: 0, presets: [[-12, '−12'], [-6, '−6'], [0, '原调'], [6, '+6'], [12, '+12']], help: '每 1 Key 为一个半音；调整音高不会改变速度。' },
  { key: 'volume', label: '输出音量', min: 0, max: 200, value: 70, presets: [], help: '0% 为静音，100% 为原音量，最高 200%。超过 100% 会放大，较响的歌曲可能失真。' },
];

export function formatAudioParameter(key, value) {
  if (key === 'strength') return value === 0 ? '原唱' : `${value < 0 ? '人声' : '伴奏'} ${Math.abs(value)}%`;
  if (key === 'speedPercent') return `${(value / 100).toFixed(2)}×`;
  if (key === 'semitones') return `${value > 0 ? '+' : ''}${value} Key`;
  return `${value}%`;
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

function updateOptions(select, items, selected) {
  const options = items.map((item) => ({ ...item }));
  if (selected && !options.some((item) => item.id === selected)) options.push({ id: selected, name: '设备已断开，请重新选择' });
  const signature = JSON.stringify(options);
  if (select.dataset.options !== signature) {
    select.replaceChildren(...options.map((item) => new Option(item.name, item.id)));
    select.dataset.options = signature;
  }
  select.value = selected;
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
  const panel = document.getElementById('audioAssistantPanel');
  const roots = [page, panel];
  const controls = roots.flatMap((root) => [...root.querySelectorAll('[data-audio-controls]')]);
  for (const root of controls) createControls(root);
  const error = document.getElementById('audioAssistantControlError');
  let state = { ready: false, settings: Object.fromEntries(FIELDS.map((field) => [field.key, field.value])), source: 'auto' };
  const changes = createAudioParameterQueue((patch) => invoke('configure', patch), render);
  const optimistic = changes.pending;
  let timer;
  let loading = null;
  let disposed = false;

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
    panel.querySelector('[data-audio-status]').textContent = message || state.status || '正在准备音频组件…';
  }

  function render() {
    if (disposed) return;
    const settings = { ...state.settings, ...optimistic };
    const local = (optimistic.source ?? state.source) === 'file';
    const busy = state.running || state.starting;
    updateOptions(document.getElementById('audioAssistantSource'), [
      { id: 'auto', name: '自动检测 QQ / 网易云 / 全民 K 歌 / LIRA' },
      { id: 'file', name: '本地歌曲文件' }, ...(state.apps || []),
    ], optimistic.source ?? state.source);
    updateOptions(document.getElementById('audioAssistantCable'), [{ id: '', name: '请选择独立通道' }, ...(state.outputs || [])], settings.cableId || '');
    updateOptions(document.getElementById('audioAssistantOutput'), [{ id: '', name: local ? 'Windows 默认输出' : '自动跟随播放器原输出' }, ...(state.outputs || [])], settings.outputId || '');
    document.getElementById('audioAssistantFileRow').hidden = !local;
    document.getElementById('audioAssistantIsolation').hidden = local;
    document.getElementById('audioAssistantFileName').textContent = state.fileName || '尚未选择';
    document.getElementById('audioAssistantSourceDevice').textContent = state.sourceDevice ? `原输出：${state.sourceDevice}` : '';
    for (const root of roots) {
      for (const input of root.querySelectorAll('[data-audio-setting]')) {
        const key = input.dataset.audioSetting;
        if (input.type === 'checkbox') input.checked = optimistic.original ?? state.original ?? false;
        else if (key !== 'source') input.value = String(key === 'speedPercent' && !local ? 100 : settings[key] ?? '');
        input.disabled = !state.ready || (key === 'speedPercent' && !local) || (['source', 'outputId', 'cableId'].includes(key) && busy);
      }
      for (const output of root.querySelectorAll('[data-audio-value]')) {
        const key = output.dataset.audioValue;
        output.textContent = formatAudioParameter(key, key === 'speedPercent' && !local ? 100 : settings[key]);
      }
      for (const button of root.querySelectorAll('[data-audio-preset]')) {
        const key = button.dataset.audioPreset;
        button.disabled = !state.ready || (key === 'speedPercent' && !local);
        button.setAttribute('aria-pressed', String(Number(button.dataset.value) === (key === 'speedPercent' && !local ? 100 : settings[key])));
      }
      for (const toggle of root.querySelectorAll('[data-audio-active]')) {
        toggle.checked = Boolean(busy);
        toggle.disabled = !enabled() || !state.ready;
      }
      for (const song of root.querySelectorAll('[data-audio-song]')) { song.textContent = state.song || '等待播放器播放歌曲'; song.title = song.textContent; }
      for (const status of root.querySelectorAll('[data-audio-status]')) status.textContent = state.status || '正在准备音频组件…';
      for (const button of root.querySelectorAll('[data-audio-action]')) button.disabled = !state.ready || (busy && button.dataset.audioAction !== 'mixer');
      for (const group of root.querySelectorAll('[data-audio-group="speedPercent"]')) group.classList.toggle('is-unavailable', !local);
    }
    const meter = page.querySelector('.audio-assistant-meter');
    const level = Math.round(Math.min(1, Math.max(0, state.level || 0)) * 100);
    meter.setAttribute('aria-valuenow', String(level));
    meter.firstElementChild.style.width = `${level}%`;
    if (!error.hidden) panel.querySelector('[data-audio-status]').textContent = error.textContent;
  }

  function receive(next) {
    if (disposed || (next.revision && next.revision < (state.revision || 0))) return;
    state = { ...state, ...next, settings: next.settings || state.settings, source: next.source || state.source };
    render();
  }

  async function invoke(op, value) {
    if (!bridge) { showError('请从 Windows 桌面客户端使用电音助手。'); return false; }
    try {
      const result = await bridge.invoke({ op, ...(value === undefined ? {} : { value }) });
      if (disposed) return false;
      if (result.state) receive(result.state);
      if (!result.ok) { showError(result.error || '操作失败，请重试。'); return false; }
      showError();
      return true;
    } catch (failure) { showError(failure.message || '音频组件连接中断，请重试。'); return false; }
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

  for (const root of roots) {
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
      if (!await flush()) return;
      if (action === 'file') {
        try {
          const result = await window.musicAPI?.selectLocalFiles();
          if (result?.ok && !result.canceled && result.files?.length) await invoke('file', result.files[0].path);
          else if (result && !result.ok) showError(result.error || '无法选择歌曲文件。');
        } catch { showError('无法选择歌曲文件，请重试。'); }
      } else await invoke(action);
    }, { signal });
  }
  const unsubscribe = bridge?.onState(receive);
  const observer = new MutationObserver(() => { if (!page.hidden) void load(); });
  observer.observe(page, { attributes: true, attributeFilter: ['hidden'] });
  panel.addEventListener('toggle', () => { if (panel.matches(':popover-open')) void load(); }, { signal });
  render();
  if (enabled() || !page.hidden) void load();
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
      for (const root of controls) root.replaceChildren();
    },
  };
}
