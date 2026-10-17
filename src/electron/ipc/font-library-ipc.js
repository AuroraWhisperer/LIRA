'use strict';

const STATUSES = new Set(['idle', 'checking', 'downloading', 'ready', 'error']);

function publicFontState(snapshot = {}) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const total = count(snapshot.total);
  const completed = Math.min(count(snapshot.completed), total);
  return { status: STATUSES.has(snapshot.status) ? snapshot.status : 'idle', total, completed,
    failed: Math.min(count(snapshot.failed), completed),
    currentFont: String(snapshot.currentFont || '').slice(0, 100),
    completedAt: String(snapshot.completedAt || '').slice(0, 32) };
}

function registerFontLibraryIpc({ safeHandle, fontLibrary, licenseManager, getMainWindow }) {
  if (!fontLibrary) return () => {};
  safeHandle('license:get-font-library-state', () => ({ ok: true, ...publicFontState(fontLibrary.getState()) }));
  safeHandle('license:retry-font-library', async () => {
    if (licenseManager.getState() !== licenseManager.LicenseState.AUTHORIZED)
      return { ok: false, error: 'LICENSE_REQUIRED' };
    const state = publicFontState(await fontLibrary.initialize());
    return { ok: state.status === 'ready', ...state };
  }, true);
  return fontLibrary.onStateChanged(snapshot => {
    const window = getMainWindow();
    if (window && !window.isDestroyed())
      window.webContents.send('license:font-library-state-changed', publicFontState(snapshot));
  });
}

module.exports = { registerFontLibraryIpc };
