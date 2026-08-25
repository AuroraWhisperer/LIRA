// 开播动画配置与本地媒体上传路由。
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readRawBody, sendJson } = require('../http-utils');
const {
  DEFAULT_OPENING_TRACK_MOTION,
  normalizeOpeningTrackMotion
} = require('../opening-contract');

const prefixes = ['/api/opening'];
const OPENING_MUSIC_DIR_NAME = 'opening-music';
const OPENING_CHARACTER_DIR_NAME = 'opening-character';
const DEFAULT_AUDIO_URL = '/img/overlays/opening/music.ogg';
const DEFAULT_CHARACTER_URL = '/img/overlays/opening/avatar.webp';
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CHARACTER_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_CHARACTER_REQUEST_BYTES = MAX_CHARACTER_UPLOAD_BYTES + (64 * 1024);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']);
const CHARACTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const QUALITY_VALUES = new Set(['high', 'normal', 'low']);
const MAX_TEXT_LENGTHS = Object.freeze({ title: 20, subtitle: 40, name: 32, footer: 48 });

const routes = {
  async 'GET /api/opening/config'(context, _request, res) {
    sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
  },

  async 'POST /api/opening/music'(context, request, res) {
    const upload = await readMultipartAudio(request.req);
    if (!upload) {
      sendJson(res, 400, { ok: false, error: '请选择 MP3、OGG、WAV 等音频文件。' });
      return;
    }

    const musicDir = getMusicDir(context.system.dataDir);
    fs.mkdirSync(musicDir, { recursive: true });
    const fileName = `opening-${Date.now()}-${crypto.randomUUID()}${upload.extension}`;
    const filePath = path.join(musicDir, fileName);
    const tempPath = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tempPath, upload.content, { flag: 'wx' });
      fs.renameSync(tempPath, filePath);
      context.settings.set('openingAudioFile', fileName);
      context.settings.set('openingAudioName', upload.name);
      context.broadcastSnapshot('settings');
      sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch (cleanupError) { void cleanupError; }
      throw error;
    }
  },

  async 'DELETE /api/opening/music'(context, _request, res) {
    context.settings.set('openingAudioFile', '');
    context.settings.set('openingAudioName', '');
    context.broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
  },

  async 'POST /api/opening/character'(context, request, res) {
    const upload = await readMultipartCharacter(request.req);
    if (!upload) {
      sendJson(res, 400, { ok: false, error: '请选择有效的 PNG、JPG 或 WebP 图片（最大 16 MB）。' });
      return;
    }

    const characterDir = getCharacterDir(context.system.dataDir);
    fs.mkdirSync(characterDir, { recursive: true });
    const fileName = `opening-character-${Date.now()}-${crypto.randomUUID()}${upload.extension}`;
    const filePath = path.join(characterDir, fileName);
    const tempPath = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tempPath, upload.content, { flag: 'wx' });
      fs.renameSync(tempPath, filePath);
      context.settings.set('openingCharacterFile', fileName);
      context.settings.set('openingCharacterName', upload.name);
      context.broadcastSnapshot('settings');
      sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch (cleanupError) { void cleanupError; }
      throw error;
    }
  },

  async 'DELETE /api/opening/character'(context, _request, res) {
    context.settings.set('openingCharacterFile', '');
    context.settings.set('openingCharacterName', '');
    context.broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: getOpeningConfig(context) });
  }
};

function getOpeningConfig(context) {
  const settings = context.settings.get();
  const audioFile = normalizeStoredFileName(settings.openingAudioFile);
  const hasUploadedAudio = Boolean(audioFile && fs.existsSync(path.join(getMusicDir(context.system.dataDir), audioFile)));
  const characterFile = normalizeStoredCharacterFileName(settings.openingCharacterFile);
  const hasUploadedCharacter = Boolean(characterFile && fs.existsSync(path.join(getCharacterDir(context.system.dataDir), characterFile)));
  const volume = Number(settings.openingAudioVolume);
  const footer = cleanText(settings.openingFooter, MAX_TEXT_LENGTHS.footer);
  return {
    enabled: parseBoolean(settings.openingEnabled, false),
    title: cleanText(settings.openingTitle, MAX_TEXT_LENGTHS.title) || '唱一首，在一首，给你的歌',
    subtitle: cleanText(settings.openingSubtitle, MAX_TEXT_LENGTHS.subtitle) || '开播准备中',
    name: cleanText(settings.openingName, MAX_TEXT_LENGTHS.name),
    footer: footer && footer !== 'SINGING LIVE' ? footer : '欢迎来到直播间',
    quality: QUALITY_VALUES.has(settings.openingQuality) ? settings.openingQuality : 'normal',
    trackMotion: normalizeOpeningTrackMotion(settings.openingTrackMotion) || DEFAULT_OPENING_TRACK_MOTION,
    showNotes: parseBoolean(settings.openingShowNotes, true),
    showEq: parseBoolean(settings.openingShowEq, true),
    audio: 'browser',
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.35,
    audioUrl: hasUploadedAudio ? `/opening-media/${encodeURIComponent(audioFile)}` : DEFAULT_AUDIO_URL,
    audioName: hasUploadedAudio ? cleanText(settings.openingAudioName, 160) || audioFile : '默认音乐：果实',
    hasUploadedAudio,
    characterUrl: hasUploadedCharacter
      ? `/opening-character/${encodeURIComponent(characterFile)}` : DEFAULT_CHARACTER_URL,
    characterName: hasUploadedCharacter
      ? cleanText(settings.openingCharacterName, 160) || characterFile : '默认人物图',
    hasUploadedCharacter
  };
}

function getMusicDir(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), OPENING_MUSIC_DIR_NAME);
}

function getCharacterDir(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), OPENING_CHARACTER_DIR_NAME);
}

function normalizeStoredFileName(value) {
  const fileName = path.basename(String(value || ''));
  if (fileName !== String(value || '') || !AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return '';
  return fileName;
}

function normalizeStoredCharacterFileName(value) {
  const fileName = path.basename(String(value || ''));
  if (fileName !== String(value || '') || !CHARACTER_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return '';
  return fileName;
}

function cleanText(value, maxLength) {
  return Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim())
    .slice(0, maxLength).join('');
}

function parseBoolean(value, fallback) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

async function readMultipartAudio(req) {
  return readMultipartFile(req, MAX_UPLOAD_BYTES, AUDIO_EXTENSIONS, '上传音乐');
}

async function readMultipartCharacter(req) {
  const upload = await readMultipartFile(
    req,
    MAX_CHARACTER_REQUEST_BYTES,
    CHARACTER_EXTENSIONS,
    '上传人物图'
  );
  if (!upload || upload.content.length > MAX_CHARACTER_UPLOAD_BYTES) return null;
  const detectedExtension = detectCharacterExtension(upload.content);
  const expectedExtension = upload.extension === '.jpeg' ? '.jpg' : upload.extension;
  if (!detectedExtension || detectedExtension !== expectedExtension) return null;
  return { ...upload, extension: detectedExtension };
}

function detectCharacterExtension(content) {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]))) return '.png';
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return '.jpg';
  if (content.length >= 12
    && content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '';
}

async function readMultipartFile(req, maxBytes, extensions, fallbackName) {
  const header = String(req.headers['content-type'] || '');
  const boundaryMatch = header.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const body = await readRawBody(req, maxBytes);
  const marker = Buffer.from(`--${boundary}`);
  const firstBoundary = body.indexOf(marker);
  if (firstBoundary < 0) return null;
  const headerStart = firstBoundary + marker.length + 2;
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart);
  if (headerEnd < 0) return null;
  const headers = body.subarray(headerStart, headerEnd).toString('latin1');
  const disposition = headers.match(/content-disposition:[^\r\n]*/i)?.[0] || '';
  const fieldName = disposition.match(/name="([^"]*)"/i)?.[1] || '';
  const rawName = disposition.match(/filename="([^"]*)"/i)?.[1] || '';
  if (fieldName !== 'file' || !rawName) return null;
  const decodedName = Buffer.from(rawName, 'latin1').toString('utf8');
  const name = path.basename(decodedName).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const extension = path.extname(name).toLowerCase();
  if (!name || !extensions.has(extension)) return null;
  const contentStart = headerEnd + 4;
  const contentEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), contentStart);
  if (contentEnd < 0) return null;
  const content = body.subarray(contentStart, contentEnd);
  if (content.length === 0) return null;
  return { content, extension, name: cleanText(name, 160) || `${fallbackName}${extension}` };
}

module.exports = {
  prefixes,
  routes,
  getOpeningConfig,
  getMusicDir,
  getCharacterDir,
  normalizeStoredFileName,
  normalizeStoredCharacterFileName,
  DEFAULT_AUDIO_URL,
  DEFAULT_CHARACTER_URL,
  MAX_CHARACTER_UPLOAD_BYTES
};
