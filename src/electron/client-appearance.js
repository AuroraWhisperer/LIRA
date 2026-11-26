'use strict';

const { ADMIN_PAGE_PATHS } = require('../shared/admin-page-paths');

const fs = require('node:fs');
const path = require('node:path');
const { writeAtomicFileAsync } = require('./atomic-file');
const { CLIENT_THEME_BACKGROUNDS, isClientThemeId, normalizeClientThemeId } = require('../shared/client-theme');
const { DEFAULT_CLIENT_FONT_ID, isClientFontId } = require('../../public/js/shared/client-font-theme.js');
const { hasExactOrigin } = require('./local-media-access');

function createClientAppearance({ dataDir, fileSystem = fs, writeLog = () => {} }) {
  const filePath = path.join(dataDir, 'client-appearance.json');
  let themeId = normalizeClientThemeId();
  let fontId = DEFAULT_CLIENT_FONT_ID;
  let pending = Promise.resolve();
  try {
    const record = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    const savedFontId = record?.fontId ?? record?.fonts?.han;
    if (isClientFontId(savedFontId)) fontId = savedFontId;
    if (!isClientThemeId(record?.themeId)) throw new Error('CLIENT_THEME_INVALID');
    themeId = record.themeId;
  } catch (error) {
    if (error.code !== 'ENOENT') writeLog('client-appearance', { event: 'READ_FALLBACK' });
  }

  function save(patch) {
    const operation = pending.then(async () => {
      const next = { themeId, fontId, ...patch };
      const record = { themeId: next.themeId };
      if (next.fontId !== DEFAULT_CLIENT_FONT_ID) record.fontId = next.fontId;
      try {
        await writeAtomicFileAsync(filePath, JSON.stringify(record) + '\n', fileSystem.promises);
        themeId = next.themeId;
        fontId = next.fontId;
        return { ok: true, ...patch };
      } catch {
        writeLog('client-appearance', { event: 'WRITE_FAILED' });
        return { ok: false, error: 'CLIENT_THEME_SAVE_FAILED' };
      }
    });
    pending = operation;
    return operation;
  }

  function setThemeId(nextThemeId) {
    if (!isClientThemeId(nextThemeId)) return Promise.resolve({ ok: false, error: 'CLIENT_THEME_INVALID' });
    return save({ themeId: nextThemeId });
  }

  function setFontId(nextFontId) {
    if (!isClientFontId(nextFontId)) return Promise.resolve({ ok: false, error: 'CLIENT_FONT_INVALID' });
    return save({ fontId: nextFontId });
  }

  return { getThemeId: () => themeId, getFontId: () => fontId, setThemeId, setFontId, whenIdle: () => pending };
}

function getClientWindowBackground(url, baseUrl, themeId) {
  if (hasExactOrigin(url, baseUrl) && ADMIN_PAGE_PATHS.includes(new URL(url).pathname)) {
    return CLIENT_THEME_BACKGROUNDS[normalizeClientThemeId(themeId)];
  }
  return '#f7f3ef';
}

function bindClientAppearanceWindow(window, baseUrl, getThemeId) {
  const contents = window.webContents;
  const navigate = (_event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame) window.setBackgroundColor(getClientWindowBackground(url, baseUrl, getThemeId()));
  };
  contents.on('did-start-navigation', navigate);
  window.once('closed', () => contents.removeListener('did-start-navigation', navigate));
}

module.exports = { createClientAppearance, getClientWindowBackground, bindClientAppearanceWindow };
