// 两个开播 HTTP 入口共享的 multipart 解析与上传格式校验。
'use strict';

const path = require('node:path');
const { readRawBody } = require('./http-utils');
const { AUDIO_EXTENSIONS, CHARACTER_EXTENSIONS, MAX_UPLOAD_BYTES,
  MAX_CHARACTER_UPLOAD_BYTES, cleanOpeningText } = require('./opening-contract');

const MAX_CHARACTER_REQUEST_BYTES = MAX_CHARACTER_UPLOAD_BYTES + 64 * 1024;
const OPENING_UPLOAD_ERRORS = {
  music: '请选择 MP3、OGG、WAV 等音频文件。',
  character: '请选择有效的 PNG、JPG 或 WebP 图片（最大 16 MB）。',
};

function readOpeningUpload(req, kind) {
  return kind === 'music' ? readMultipartAudio(req) : readMultipartCharacter(req);
}

async function readMultipartAudio(req) {
  return readMultipartFile(req, MAX_UPLOAD_BYTES, AUDIO_EXTENSIONS, '上传音乐');
}

async function readMultipartCharacter(req) {
  const upload = await readMultipartFile(req, MAX_CHARACTER_REQUEST_BYTES, CHARACTER_EXTENSIONS, '上传人物图');
  if (!upload || upload.content.length > MAX_CHARACTER_UPLOAD_BYTES) return null;
  const detectedExtension = detectCharacterExtension(upload.content);
  const expectedExtension = upload.extension === '.jpeg' ? '.jpg' : upload.extension;
  if (!detectedExtension || detectedExtension !== expectedExtension) return null;
  return { ...upload, extension: detectedExtension };
}

function detectCharacterExtension(content) {
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return '.png';
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return '.jpg';
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return '.webp';
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
  const name = path
    .basename(decodedName)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const extension = path.extname(name).toLowerCase();
  if (!name || !extensions.has(extension)) return null;
  const contentStart = headerEnd + 4;
  const contentEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), contentStart);
  if (contentEnd < 0) return null;
  const content = body.subarray(contentStart, contentEnd);
  if (content.length === 0) return null;
  return {
    content,
    extension,
    name: cleanOpeningText(name, 160) || `${fallbackName}${extension}`,
  };
}

module.exports = { readOpeningUpload, OPENING_UPLOAD_ERRORS };
