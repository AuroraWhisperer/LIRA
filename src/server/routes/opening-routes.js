// 开播动画配置与本地音乐上传路由。
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readRawBody, sendJson } = require('../http-utils');

const prefixes = ['/api/opening'];
const OPENING_MUSIC_DIR_NAME = 'opening-music';
const DEFAULT_AUDIO_URL = '/img/overlays/opening/music.ogg';
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']);
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
  }
};

function getOpeningConfig(context) {
  const settings = context.settings.get();
  const audioFile = normalizeStoredFileName(settings.openingAudioFile);
  const hasUploadedAudio = Boolean(audioFile && fs.existsSync(path.join(getMusicDir(context.system.dataDir), audioFile)));
  const volume = Number(settings.openingAudioVolume);
  return {
    enabled: parseBoolean(settings.openingEnabled, false),
    title: cleanText(settings.openingTitle, MAX_TEXT_LENGTHS.title) || '唱一首，在一首，给你的歌',
    subtitle: cleanText(settings.openingSubtitle, MAX_TEXT_LENGTHS.subtitle) || '开播准备中',
    name: cleanText(settings.openingName, MAX_TEXT_LENGTHS.name),
    footer: cleanText(settings.openingFooter, MAX_TEXT_LENGTHS.footer) || 'SINGING LIVE',
    quality: QUALITY_VALUES.has(settings.openingQuality) ? settings.openingQuality : 'normal',
    showNotes: parseBoolean(settings.openingShowNotes, true),
    showEq: parseBoolean(settings.openingShowEq, true),
    audio: 'browser',
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.35,
    audioUrl: hasUploadedAudio ? `/opening-media/${encodeURIComponent(audioFile)}` : DEFAULT_AUDIO_URL,
    audioName: hasUploadedAudio ? cleanText(settings.openingAudioName, 160) || audioFile : '默认音乐：果实',
    hasUploadedAudio
  };
}

function getMusicDir(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), OPENING_MUSIC_DIR_NAME);
}

function normalizeStoredFileName(value) {
  const fileName = path.basename(String(value || ''));
  if (fileName !== String(value || '') || !AUDIO_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return '';
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
  const header = String(req.headers['content-type'] || '');
  const boundaryMatch = header.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const body = await readRawBody(req, MAX_UPLOAD_BYTES);
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
  if (!name || !AUDIO_EXTENSIONS.has(extension)) return null;
  const contentStart = headerEnd + 4;
  const contentEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), contentStart);
  if (contentEnd < 0) return null;
  const content = body.subarray(contentStart, contentEnd);
  if (content.length === 0) return null;
  return { content, extension, name: cleanText(name, 160) || `上传音乐${extension}` };
}

module.exports = {
  prefixes,
  routes,
  getOpeningConfig,
  getMusicDir,
  normalizeStoredFileName,
  DEFAULT_AUDIO_URL
};
