'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { CLIENT_THEME_BACKGROUNDS, isClientThemeId, normalizeClientThemeId } = require('../shared/client-theme');
const { hasExactOrigin } = require('./local-media-access');

function createClientAppearance({ dataDir, fileSystem = fs, writeLog = () => {} }) {
  const filePath = path.join(dataDir, 'client-appearance.json');
  let themeId = normalizeClientThemeId();
  let pending = Promise.resolve();
  try {
    const record = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    if (!isClientThemeId(record?.themeId)) throw new Error('CLIENT_THEME_INVALID');
    themeId = record.themeId;
  } catch (error) {
    if (error.code !== 'ENOENT') writeLog('client-appearance', { event: 'READ_FALLBACK' });
  }

  function setThemeId(nextThemeId) {
    if (!isClientThemeId(nextThemeId)) return Promise.resolve({ ok: false, error: 'CLIENT_THEME_INVALID' });
    const operation = pending.then(async () => {
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fileSystem.promises.writeFile(temporaryPath, JSON.stringify({ themeId: nextThemeId }) + '\n', { flag: 'wx', flush: true });
        await fileSystem.promises.rename(temporaryPath, filePath);
        themeId = nextThemeId;
        return { ok: true, themeId };
      } catch {
        writeLog('client-appearance', { event: 'WRITE_FAILED' });
        return { ok: false, error: 'CLIENT_THEME_SAVE_FAILED' };
      } finally {
        await fileSystem.promises.unlink(temporaryPath).catch(() => {});
      }
    });
    pending = operation;
    return operation;
  }

  return { getThemeId: () => themeId, setThemeId, whenIdle: () => pending };
}

function getClientWindowBackground(url, baseUrl, themeId) {
  if (hasExactOrigin(url, baseUrl) && ['/', '/admin', '/settings', '/songs'].includes(new URL(url).pathname)) {
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
