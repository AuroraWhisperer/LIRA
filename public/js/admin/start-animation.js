'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';

const OPENING_DEFAULTS = Object.freeze({
  enabled: false,
  title: '唱一首，在一首，给你的歌',
  subtitle: '开播准备中',
  name: '',
  footer: 'SINGING LIVE',
  quality: 'normal',
  showNotes: true,
  showEq: true,
  volume: 0.35
});

const QUALITY_VALUES = new Set(['high', 'normal', 'low']);
const SETTINGS_ENDPOINT = '/api/' + 'settings';
const OPENING_CONFIG_ENDPOINT = '/api/opening/config';
const OPENING_AUDIO_ENDPOINT = '/api/opening/music';

function readStartAnimationConfig(root = document) {
  const value = (id, fallback) => root.getElementById(id)?.value ?? fallback;
  const volume = Number(value('openingAudioVolume', String(Math.round(OPENING_DEFAULTS.volume * 100))));
  return {
    enabled: Boolean(root.getElementById('openingEnabled')?.checked),
    title: value('openingTitle', OPENING_DEFAULTS.title).trim(),
    subtitle: value('openingSubtitle', OPENING_DEFAULTS.subtitle).trim(),
    name: value('openingName', OPENING_DEFAULTS.name).trim(),
    footer: value('openingFooter', OPENING_DEFAULTS.footer).trim(),
    quality: QUALITY_VALUES.has(value('openingQuality', OPENING_DEFAULTS.quality))
      ? value('openingQuality', OPENING_DEFAULTS.quality) : OPENING_DEFAULTS.quality,
    showNotes: Boolean(root.getElementById('openingShowNotes')?.checked),
    showEq: Boolean(root.getElementById('openingShowEq')?.checked),
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume / 100)) : OPENING_DEFAULTS.volume
  };
}

function buildOpeningUrl(origin, config) {
  const url = new URL('/opening', origin);
  const params = new URLSearchParams();
  params.set('enabled', config.enabled ? '1' : '0');
  params.set('title', config.title || OPENING_DEFAULTS.title);
  params.set('subtitle', config.subtitle || OPENING_DEFAULTS.subtitle);
  params.set('name', config.name);
  params.set('footer', config.footer || OPENING_DEFAULTS.footer);
  params.set('quality', QUALITY_VALUES.has(config.quality) ? config.quality : OPENING_DEFAULTS.quality);
  params.set('showNotes', config.showNotes ? '1' : '0');
  params.set('showEq', config.showEq ? '1' : '0');
  params.set('volume', String(Number.isFinite(config.volume) ? config.volume : OPENING_DEFAULTS.volume));
  params.set('audio', 'browser');
  url.search = params.toString();
  return url.toString();
}

function buildOpeningSourceUrl(origin) {
  return new URL('/opening', origin).toString();
}

function openingSettingsPayload(config) {
  return {
    openingEnabled: config.enabled ? 'true' : 'false',
    openingTitle: config.title,
    openingSubtitle: config.subtitle,
    openingName: config.name,
    openingFooter: config.footer,
    openingQuality: config.quality,
    openingShowNotes: config.showNotes ? 'true' : 'false',
    openingShowEq: config.showEq ? 'true' : 'false',
    openingAudioVolume: String(config.volume)
  };
}

function setFormConfig(root, config) {
  const setValue = (id, value) => {
    const element = root.getElementById(id);
    if (element && value !== undefined && value !== null) element.value = String(value);
  };
  const setChecked = (id, value) => {
    const element = root.getElementById(id);
    if (element) element.checked = Boolean(value);
  };
  setChecked('openingEnabled', config.enabled);
  setValue('openingTitle', config.title);
  setValue('openingSubtitle', config.subtitle);
  setValue('openingName', config.name);
  setValue('openingFooter', config.footer);
  setValue('openingQuality', config.quality);
  setChecked('openingShowNotes', config.showNotes);
  setChecked('openingShowEq', config.showEq);
  setValue('openingAudioVolume', Math.round(Number(config.volume) * 100));
}

function updateVolumeOutput(root, config) {
  const output = root.getElementById('openingAudioVolumeValue');
  if (output) output.textContent = `${Math.round(config.volume * 100)}%`;
}

let initialized = false;

function initStartAnimation() {
  if (initialized) return;
  const form = document.getElementById('openingAnimationForm');
  if (!form) return;
  initialized = true;

  const root = document;
  const urlNode = document.getElementById('openingUrl');
  const preview = document.getElementById('openingPreview');
  const previewState = document.getElementById('openingPreviewState');
  const status = document.getElementById('openingAnimationStatus');
  const titleCount = document.getElementById('openingTitleCount');
  const audioName = document.getElementById('openingAudioName');
  const audioStatus = document.getElementById('openingAudioStatus');
  const origin = localOverlayOrigin(location);
  const sourceUrl = buildOpeningSourceUrl(origin);
  let persistTimer = null;
  let previewVersion = 0;
  let hydrated = false;

  const render = (forcePreviewReload = false) => {
    const config = readStartAnimationConfig(root);
    const previewUrl = buildOpeningUrl(origin, config);
    if (titleCount) titleCount.textContent = `${Array.from(config.title).length}/20`;
    updateVolumeOutput(root, config);
    if (urlNode) urlNode.textContent = sourceUrl;
    if (preview) {
      if (!config.enabled) {
        preview.hidden = true;
        if (preview.src !== 'about:blank') preview.src = 'about:blank';
      } else {
        preview.hidden = false;
        const nextPreviewUrl = forcePreviewReload
          ? `${previewUrl}&preview=${previewVersion += 1}` : previewUrl;
        if (preview.src !== nextPreviewUrl) preview.src = nextPreviewUrl;
      }
    }
    if (previewState) {
      previewState.textContent = config.enabled ? '已开启' : '已关闭';
      previewState.dataset.state = config.enabled ? 'enabled' : 'disabled';
    }
    if (status && !status.dataset.busy) status.textContent = config.enabled
      ? '配置会自动保存，Browser Source 刷新后会读取最新设置。'
      : '整套特效已关闭：Browser Source 透明，动画与音乐均已停止。';
    return config;
  };

  const persist = () => {
    if (!hydrated) return;
    const config = readStartAnimationConfig(root);
    if (status) {
      status.dataset.busy = 'true';
      status.textContent = '正在保存开播动画配置…';
    }
    fetch(SETTINGS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(openingSettingsPayload(config))
    }).then((response) => {
      if (!response.ok) throw new Error('配置保存失败');
      if (status) {
        delete status.dataset.busy;
        status.textContent = '配置已保存，固定地址刷新后会读取最新设置。';
      }
    }).catch((error) => {
      if (status) {
        delete status.dataset.busy;
        status.textContent = error.message || '配置保存失败，请重试。';
      }
    });
  };

  const schedulePersist = () => {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 220);
  };

  const loadSavedConfig = async () => {
    try {
      const response = await fetch(OPENING_CONFIG_ENDPOINT, { cache: 'no-store' });
      if (!response.ok) {
        hydrated = true;
        return;
      }
      const payload = await response.json();
      if (!payload?.ok || !payload.data) {
        hydrated = true;
        return;
      }
      setFormConfig(root, payload.data);
      if (audioName) audioName.textContent = payload.data.audioName || '默认音乐：果实';
      hydrated = true;
      render(true);
    } catch (_) {
      hydrated = true;
      render();
    }
  };

  form.addEventListener('input', () => {
    render();
    schedulePersist();
  });
  form.addEventListener('change', () => {
    render();
    schedulePersist();
  });

  document.getElementById('openingAudioFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (audioStatus) audioStatus.textContent = '正在上传歌曲…';
    const body = new FormData();
    body.append('file', file, file.name);
    try {
      const response = await fetch(OPENING_AUDIO_ENDPOINT, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '歌曲上传失败');
      if (audioName) audioName.textContent = payload.data.audioName || file.name;
      if (audioStatus) audioStatus.textContent = '歌曲已保存到开播音乐文件夹。';
      render(true);
    } catch (error) {
      if (audioStatus) audioStatus.textContent = error.message || '歌曲上传失败，请重试。';
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('openingResetAudio')?.addEventListener('click', async () => {
    try {
      const response = await fetch(OPENING_AUDIO_ENDPOINT, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '恢复默认音乐失败');
      if (audioName) audioName.textContent = payload.data.audioName || '默认音乐：果实';
      if (audioStatus) audioStatus.textContent = '已恢复默认音乐：果实。';
      render(true);
    } catch (error) {
      if (audioStatus) audioStatus.textContent = error.message || '恢复默认音乐失败。';
    }
  });

  document.getElementById('openingCopyUrl')?.addEventListener('click', async () => {
    try {
      await copyText(sourceUrl);
      toast('固定开播动画地址已复制');
    } catch (error) {
      toast(error.message || '复制失败，请手动复制地址。');
    }
  });
  render();
  loadSavedConfig();
}

export {
  OPENING_DEFAULTS,
  buildOpeningUrl,
  buildOpeningSourceUrl,
  initStartAnimation,
  readStartAnimationConfig,
  openingSettingsPayload
};
