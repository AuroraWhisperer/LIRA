// 本地开播媒体的文件存取；不负责 HTTP 或设置提交。
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AUDIO_EXTENSIONS, CHARACTER_EXTENSIONS } = require('./opening-contract');

const OPENING_MUSIC_DIR_NAME = 'opening-music';
const OPENING_CHARACTER_DIR_NAME = 'opening-character';

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

function musicFileExists(dataDir, fileName) {
  return Boolean(fileName && fs.existsSync(path.join(getMusicDir(dataDir), fileName)));
}

function characterFileExists(dataDir, fileName) {
  return Boolean(fileName && fs.existsSync(path.join(getCharacterDir(dataDir), fileName)));
}

function saveOpeningMediaFile(dataDir, kind, upload) {
  const directory = kind === 'music' ? getMusicDir(dataDir) : getCharacterDir(dataDir);
  fs.mkdirSync(directory, { recursive: true });
  const prefix = kind === 'music' ? 'opening' : 'opening-character';
  const fileName = `${prefix}-${Date.now()}-${crypto.randomUUID()}${upload.extension}`;
  const filePath = path.join(directory, fileName);
  const tempPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tempPath, upload.content, { flag: 'wx' });
    fs.renameSync(tempPath, filePath);
    return fileName;
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch (cleanupError) {
      void cleanupError;
    }
    throw error;
  }
}

module.exports = {
  getMusicDir,
  getCharacterDir,
  normalizeStoredFileName,
  normalizeStoredCharacterFileName,
  musicFileExists,
  characterFileExists,
  saveOpeningMediaFile,
};
