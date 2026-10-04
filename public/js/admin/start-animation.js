'use strict';

import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { openComponentPreview } from './component-preview-dialog.js';

const OPENING_DEFAULTS = Object.freeze({
  enabled: false,
  style: 'classic',
  title: '唱一首，在一首，给你的歌',
  subtitle: '开播准备中',
  name: '',
  footer: '欢迎来到直播间',
  quality: 'normal',
  trackMotion: 'heart',
  showNotes: true,
  showEq: true,
  volume: 0.35,
});

const QUALITY_VALUES = new Set(['high', 'normal', 'low']);
const TRACK_MOTION_VALUES = new Set(['heart', 'barber', 'progress']);
const SETTINGS_ENDPOINT = '/api/' + 'settings';
const OPENING_CONFIG_ENDPOINT = '/api/opening/config';
const OPENING_AUDIO_ENDPOINT = '/api/opening/music';
const OPENING_CHARACTER_ENDPOINT = '/api/opening/character';
const MAX_CHARACTER_UPLOAD_BYTES = 16 * 1024 * 1024;
const CHARACTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

function readStartAnimationConfig(root = document) {
  const value = (id, fallback) => root.getElementById(id)?.value ?? fallback;
  const volume = Number(value('openingAudioVolume', String(Math.round(OPENING_DEFAULTS.volume * 100))));
  const trackMotion = value('openingTrackMotion', OPENING_DEFAULTS.trackMotion);
  return {
    enabled: Boolean(root.getElementById('openingEnabled')?.checked),
    style: value('openingStyle', OPENING_DEFAULTS.style),
    title: value('openingTitle', OPENING_DEFAULTS.title).trim(),
    subtitle: value('openingSubtitle', OPENING_DEFAULTS.subtitle).trim(),
    name: value('openingName', OPENING_DEFAULTS.name).trim(),
    footer: value('openingFooter', OPENING_DEFAULTS.footer).trim(),
    quality: QUALITY_VALUES.has(value('openingQuality', OPENING_DEFAULTS.quality))
      ? value('openingQuality', OPENING_DEFAULTS.quality)
      : OPENING_DEFAULTS.quality,
    trackMotion: TRACK_MOTION_VALUES.has(trackMotion) ? trackMotion : OPENING_DEFAULTS.trackMotion,
    showNotes: Boolean(root.getElementById('openingShowNotes')?.checked),
    showEq: Boolean(root.getElementById('openingShowEq')?.checked),
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume / 100)) : OPENING_DEFAULTS.volume,
  };
}

function buildOpeningSourceUrl(origin) {
  return new URL('/opening', origin).toString();
}

function openingSettingsPayload(config) {
  return {
    openingEnabled: config.enabled ? 'true' : 'false',
    openingStyle: config.style || OPENING_DEFAULTS.style,
    openingTitle: config.title,
    openingSubtitle: config.subtitle,
    openingName: config.name,
    openingFooter: config.footer,
    openingQuality: config.quality,
    openingTrackMotion: config.trackMotion,
    openingShowNotes: config.showNotes ? 'true' : 'false',
    openingShowEq: config.showEq ? 'true' : 'false',
    openingAudioVolume: String(config.volume),
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
  setValue('openingStyle', config.style || OPENING_DEFAULTS.style);
  setValue('openingTitle', config.title);
  setValue('openingSubtitle', config.subtitle);
  setValue('openingName', config.name);
  setValue('openingFooter', config.footer === 'SINGING LIVE' ? OPENING_DEFAULTS.footer : config.footer);
  setValue('openingQuality', config.quality);
  setValue(
    'openingTrackMotion',
    TRACK_MOTION_VALUES.has(config.trackMotion) ? config.trackMotion : OPENING_DEFAULTS.trackMotion,
  );
  setChecked('openingShowNotes', config.showNotes);
  setChecked('openingShowEq', config.showEq);
  setValue('openingAudioVolume', volumePercent(config.volume));
}

function volumePercent(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return Math.round(OPENING_DEFAULTS.volume * 100);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
}

function updateVolumeOutput(root, config) {
  const output = root.getElementById('openingAudioVolumeValue');
  if (output) output.textContent = `${volumePercent(config.volume)}%`;
}

let initialized = false;

function initStartAnimation() {
  if (initialized) return;
  const form = document.getElementById('openingAnimationForm');
  if (!form) return;
  initialized = true;

  const root = document;
  const urlNode = document.getElementById('openingUrl');
  const previewButton = document.getElementById('openingPreviewBtn');
  const titleCount = document.getElementById('openingTitleCount');
  const audioName = document.getElementById('openingAudioName');
  const audioStatus = document.getElementById('openingAudioStatus');
  const characterName = document.getElementById('openingCharacterName');
  const characterStatus = document.getElementById('openingCharacterStatus');
  const configStatus = document.getElementById('openingConfigStatus');
  const reloadButton = document.getElementById('openingReload');
  const origin = localOverlayOrigin(location);
  const sourceUrl = buildOpeningSourceUrl(origin);
  let persistTimer = null;
  let hydrated = false;
  let loading = false;
  let characterNames = {};
  let saveInFlight = false;
  let saveQueued = false;
  let lastSavedPayload = '';

  const updateMediaConfig = (config) => {
    characterNames = { classic: config.characterName || '', 'pixel-cassette': config.pixelCharacterName || '' };
  };

  const render = () => {
    const config = readStartAnimationConfig(root);
    const pixelStyle = config.style === 'pixel-cassette';
    for (const id of ['openingCopyHeading', 'openingCopyFields', 'openingTrackMotionField']) {
      const field = root.getElementById(id);
      if (field) field.hidden = pixelStyle;
    }
    const pixelHint = root.getElementById('openingPixelHint');
    if (pixelHint) pixelHint.hidden = !pixelStyle;
    if (characterName) characterName.textContent = characterNames[config.style]
      || (pixelStyle ? '未上传头像' : '未上传人物图');
    const characterHeading = root.getElementById('openingCharacterHeading');
    if (characterHeading) characterHeading.textContent = pixelStyle ? '头像图片' : '人物图片';
    const clearCharacter = root.getElementById('openingResetCharacter');
    if (clearCharacter) clearCharacter.textContent = pixelStyle ? '清除头像' : '清除人物图';
    if (titleCount) titleCount.textContent = `${Array.from(config.title).length}/20`;
    updateVolumeOutput(root, config);
    if (urlNode) urlNode.textContent = sourceUrl;
    return config;
  };

  const persist = async () => {
    if (!hydrated) return;
    saveQueued = true;
    if (saveInFlight) return;
    saveInFlight = true;
    try {
      while (saveQueued) {
        saveQueued = false;
        const body = JSON.stringify(openingSettingsPayload(readStartAnimationConfig(root)));
        if (body === lastSavedPayload) continue;
        const response = await fetch(SETTINGS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!response.ok) throw new Error('配置保存失败');
        lastSavedPayload = body;
      }
    } catch (error) {
      toast(error.message || '配置保存失败，请重试。');
    } finally {
      saveInFlight = false;
      if (saveQueued) void persist();
    }
  };

  const schedulePersist = () => {
    if (!hydrated) return;
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(persist, 220);
  };

  const updateLoadState = () => {
    for (const control of form.elements) control.disabled = !hydrated;
    const enabled = root.getElementById('openingEnabled');
    if (enabled) enabled.disabled = !hydrated;
    if (previewButton) previewButton.disabled = !hydrated;
    const loadState = root.getElementById('openingLoadState');
    if (loadState) loadState.hidden = hydrated;
    if (reloadButton) {
      reloadButton.hidden = hydrated || loading;
      reloadButton.disabled = loading;
    }
  };

  const loadSavedConfig = async () => {
    if (loading || hydrated) return;
    loading = true;
    if (configStatus) configStatus.textContent = '正在读取开播配置…';
    updateLoadState();
    try {
      const response = await fetch(OPENING_CONFIG_ENDPOINT, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('开播配置读取失败');
      const payload = await response.json();
      if (!payload?.ok || !payload.data) throw new Error('开播配置读取失败');
      setFormConfig(root, payload.data);
      updateMediaConfig(payload.data);
      if (audioName) audioName.textContent = payload.data.audioName || '未上传音乐';
      lastSavedPayload = JSON.stringify(openingSettingsPayload(readStartAnimationConfig(root)));
      hydrated = true;
    } catch {
      if (configStatus) configStatus.textContent = '开播配置读取失败，请重新读取后再编辑。';
    } finally {
      loading = false;
      updateLoadState();
      render();
    }
  };

  const handleConfigChange = () => {
    if (!hydrated) return;
    render();
    schedulePersist();
  };
  form.addEventListener('input', handleConfigChange);
  form.addEventListener('change', handleConfigChange);
  document.getElementById('openingEnabled')?.addEventListener('change', handleConfigChange);
  reloadButton?.addEventListener('click', () => { void loadSavedConfig(); });
  previewButton?.addEventListener('click', () => {
    if (hydrated) openComponentPreview({ id: 'opening' });
  });

  document.getElementById('openingAudioFile')?.addEventListener('change', async (event) => {
    if (!hydrated) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (audioStatus) audioStatus.textContent = '正在上传歌曲…';
    const body = new FormData();
    body.append('file', file, file.name);
    try {
      const response = await fetch(OPENING_AUDIO_ENDPOINT, {
        method: 'POST',
        body,
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '歌曲上传失败');
      if (audioName) audioName.textContent = payload.data.audioName || file.name;
      if (audioStatus) audioStatus.textContent = '歌曲已保存到开播音乐文件夹。';
      updateMediaConfig(payload.data);
      render();
    } catch (error) {
      if (audioStatus) audioStatus.textContent = error.message || '歌曲上传失败，请重试。';
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('openingCharacterFile')?.addEventListener('change', async (event) => {
    if (!hydrated) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!CHARACTER_EXTENSIONS.has(extension)) {
      if (characterStatus) characterStatus.textContent = '请选择 PNG、JPG 或 WebP 图片。';
      event.target.value = '';
      return;
    }
    if (file.size > MAX_CHARACTER_UPLOAD_BYTES) {
      if (characterStatus) characterStatus.textContent = '图片不能超过 16 MB。';
      event.target.value = '';
      return;
    }
    if (characterStatus) characterStatus.textContent = '正在上传人物图片…';
    const body = new FormData();
    body.append('file', file, file.name);
    try {
      const style = readStartAnimationConfig(root).style;
      const endpoint = style === 'pixel-cassette' ? `${OPENING_CHARACTER_ENDPOINT}?style=pixel-cassette` : OPENING_CHARACTER_ENDPOINT;
      const response = await fetch(endpoint, {
        method: 'POST',
        body,
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '人物图片上传失败');
      if (characterStatus) characterStatus.textContent = '人物图片已保存。';
      updateMediaConfig(payload.data);
      render();
    } catch (error) {
      if (characterStatus) characterStatus.textContent = error.message || '人物图片上传失败，请重试。';
    } finally {
      event.target.value = '';
    }
  });

  document.getElementById('openingResetCharacter')?.addEventListener('click', async () => {
    if (!hydrated) return;
    try {
      const style = readStartAnimationConfig(root).style;
      const endpoint = style === 'pixel-cassette' ? `${OPENING_CHARACTER_ENDPOINT}?style=pixel-cassette` : OPENING_CHARACTER_ENDPOINT;
      const response = await fetch(endpoint, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '清除人物图失败');
      if (characterStatus) characterStatus.textContent = '已清除人物图。';
      updateMediaConfig(payload.data);
      render();
    } catch (error) {
      if (characterStatus) characterStatus.textContent = error.message || '清除人物图失败。';
    }
  });

  document.getElementById('openingResetAudio')?.addEventListener('click', async () => {
    if (!hydrated) return;
    try {
      const response = await fetch(OPENING_AUDIO_ENDPOINT, {
        method: 'DELETE',
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '清除音乐失败');
      if (audioName) audioName.textContent = payload.data.audioName || '未上传音乐';
      if (audioStatus) audioStatus.textContent = '已清除音乐。';
      updateMediaConfig(payload.data);
      render();
    } catch (error) {
      if (audioStatus) audioStatus.textContent = error.message || '清除音乐失败。';
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
  buildOpeningSourceUrl,
  initStartAnimation,
  readStartAnimationConfig,
  openingSettingsPayload,
  volumePercent,
};
