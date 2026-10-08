// 开播配置、样式媒体选择与设置提交的应用能力。
'use strict';

const {
  DEFAULT_OPENING_STYLE, normalizeOpeningStyle,
  DEFAULT_OPENING_TRACK_MOTION, normalizeOpeningTrackMotion, cleanOpeningText,
} = require('./opening-contract');
const { normalizeSettingsPatch } = require('./settings-contract');
const { openingStyleSettingsPatch } = require('../../public/js/shared/opening-settings');
const { normalizeStoredFileName, normalizeStoredCharacterFileName,
  musicFileExists, characterFileExists, saveOpeningMediaFile } = require('./opening-media-store');

const DEFAULT_AUDIO_URL = '';
const DEFAULT_CHARACTER_URL = '';
const QUALITY_VALUES = new Set(['high', 'normal', 'low']);
const MAX_TEXT_LENGTHS = Object.freeze({
  title: 20,
  subtitle: 40,
  name: 32,
  footer: 48,
});

function resolveOpeningMediaSlot(kind, style = DEFAULT_OPENING_STYLE) {
  if (kind === 'music') {
    const settingPrefix = style === 'classic' ? 'openingAudio' : style === 'pixel-cassette' ? 'openingPixelAudio' : null;
    return settingPrefix ? { kind, settingPrefix } : null;
  }
  const normalizedStyle = normalizeOpeningStyle(style);
  if (!normalizedStyle) return null;
  return { kind, settingPrefix: normalizedStyle === 'pixel-cassette' ? 'openingPixelCharacter' : 'openingCharacter' };
}

function saveOpeningMedia({ settings, system, broadcastSnapshot }, slot, upload) {
  const fileName = saveOpeningMediaFile(system.dataDir, slot.kind, upload);
  settings.set(`${slot.settingPrefix}File`, fileName);
  settings.set(`${slot.settingPrefix}Name`, upload.name);
  broadcastSnapshot('settings');
  return getOpeningConfig({ settings, system });
}

function clearOpeningMedia({ settings, system, broadcastSnapshot }, slot) {
  settings.set(`${slot.settingPrefix}File`, '');
  settings.set(`${slot.settingPrefix}Name`, '');
  broadcastSnapshot('settings');
  return getOpeningConfig({ settings, system });
}

function updateOpeningStyleSettings({ settings, system, broadcastSnapshot }, style, patch) {
  let values;
  try {
    values = openingStyleSettingsPatch(style, patch);
  } catch (error) {
    throw Object.assign(error, { statusCode: 400 });
  }
  const normalized = normalizeSettingsPatch(values, settings.defaults);
  if (normalized.error) throw Object.assign(new Error(normalized.error), { statusCode: 400 });
  settings.setMany(normalized.values);
  broadcastSnapshot('settings');
  return getOpeningConfig({ settings, system });
}

function getOpeningConfig({ settings: settingsStore, system }) {
  const settings = settingsStore.get();
  const audioFile = normalizeStoredFileName(settings.openingAudioFile);
  const hasUploadedAudio = Boolean(
    audioFile && musicFileExists(system.dataDir, audioFile),
  );
  const characterFile = normalizeStoredCharacterFileName(settings.openingCharacterFile);
  const hasUploadedCharacter = Boolean(
    characterFile && characterFileExists(system.dataDir, characterFile),
  );
  const pixelCharacterFile = normalizeStoredCharacterFileName(settings.openingPixelCharacterFile);
  const hasUploadedPixelCharacter = Boolean(
    pixelCharacterFile && characterFileExists(system.dataDir, pixelCharacterFile),
  );
  const volume = Number(settings.openingAudioVolume);
  const footer = cleanOpeningText(settings.openingFooter, MAX_TEXT_LENGTHS.footer);
  const classic = {
    enabled: parseBoolean(settings.openingEnabled, false),
    style: normalizeOpeningStyle(settings.openingStyle) || DEFAULT_OPENING_STYLE,
    title: cleanOpeningText(settings.openingTitle, MAX_TEXT_LENGTHS.title) || '唱一首，在一首，给你的歌',
    subtitle: cleanOpeningText(settings.openingSubtitle, MAX_TEXT_LENGTHS.subtitle) || '开播准备中',
    name: cleanOpeningText(settings.openingName, MAX_TEXT_LENGTHS.name),
    footer: footer && footer !== 'SINGING LIVE' ? footer : '欢迎来到直播间',
    quality: QUALITY_VALUES.has(settings.openingQuality) ? settings.openingQuality : 'normal',
    trackMotion: normalizeOpeningTrackMotion(settings.openingTrackMotion) || DEFAULT_OPENING_TRACK_MOTION,
    showNotes: parseBoolean(settings.openingShowNotes, true),
    showEq: parseBoolean(settings.openingShowEq, true),
    audio: 'browser',
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.35,
    audioUrl: hasUploadedAudio ? `/opening-media/${encodeURIComponent(audioFile)}` : DEFAULT_AUDIO_URL,
    audioName: hasUploadedAudio ? cleanOpeningText(settings.openingAudioName, 160) || audioFile : '',
    hasUploadedAudio,
    characterUrl: hasUploadedCharacter
      ? `/opening-character/${encodeURIComponent(characterFile)}`
      : DEFAULT_CHARACTER_URL,
    characterName: hasUploadedCharacter ? cleanOpeningText(settings.openingCharacterName, 160) || characterFile : '',
    hasUploadedCharacter,
    pixelCharacterUrl: hasUploadedPixelCharacter
      ? `/opening-character/${encodeURIComponent(pixelCharacterFile)}` : DEFAULT_CHARACTER_URL,
    pixelCharacterName: hasUploadedPixelCharacter
      ? cleanOpeningText(settings.openingPixelCharacterName, 160) || pixelCharacterFile : '',
    hasUploadedPixelCharacter,
  };
  const pixelAudioFile = normalizeStoredFileName(settings.openingPixelAudioFile);
  const pixelAudioExists = Boolean(pixelAudioFile && musicFileExists(system.dataDir, pixelAudioFile));
  const pixelVolume = Number(settings.openingPixelAudioVolume ?? 0.35);
  const pixel = { ...classic, style: 'pixel-cassette',
    quality: QUALITY_VALUES.has(settings.openingPixelQuality) ? settings.openingPixelQuality : 'normal',
    showNotes: parseBoolean(settings.openingPixelShowNotes, true),
    showEq: parseBoolean(settings.openingPixelShowEq, true),
    volume: Number.isFinite(pixelVolume) ? Math.max(0, Math.min(1, pixelVolume)) : 0.35,
    audioUrl: pixelAudioExists ? `/opening-media/${encodeURIComponent(pixelAudioFile)}` : '',
    audioName: pixelAudioExists ? cleanOpeningText(settings.openingPixelAudioName, 160) || pixelAudioFile : '',
    hasUploadedAudio: pixelAudioExists,
  };
  const styles = { classic: { ...classic, style: 'classic' }, 'pixel-cassette': pixel };
  return { ...(classic.style === 'pixel-cassette' ? pixel : classic), styles };
}

function parseBoolean(value, fallback) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

module.exports = {
  getOpeningConfig,
  resolveOpeningMediaSlot,
  saveOpeningMedia,
  clearOpeningMedia,
  updateOpeningStyleSettings,
};
