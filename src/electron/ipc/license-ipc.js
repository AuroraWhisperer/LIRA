'use strict';

function registerLicenseIpc(options = {}) {
  const { ipcMain, licenseManager, getMainWindow = () => null } = options;
  if (!ipcMain || !licenseManager) throw new Error('License IPC dependencies are required.');

  const safeHandle = (channel, handler) => {
    try { ipcMain.removeHandler?.(channel); } catch (error) { void error; }
    ipcMain.handle(channel, async (_event, payload) => {
      try { return await handler(payload); } catch (error) {
        return { ok: false, state: licenseManager.getState(), error: String(error?.code || error?.message || 'LICENSE_ERROR') };
      }
    });
  };

  safeHandle('license:get-state', () => ({ ok: true, ...licenseManager.getSnapshot() }));
  safeHandle('license:activate', (payload) => {
    const input = validateActivationPayload(payload);
    if (!input.ok) return input;
    return licenseManager.activate(input);
  });
  safeHandle('license:retry', async () => {
    await licenseManager.retry();
    return { ok: licenseManager.getState() === licenseManager.LicenseState.AUTHORIZED, ...licenseManager.getSnapshot() };
  });
  safeHandle('license:get-profile', () => licenseManager.getProfile().then(snapshot => ({ ok: true, ...snapshot })));
  safeHandle('license:sync-songs', (songs) => {
    if (!Array.isArray(songs) || songs.length > 5000) return { ok: false, state: licenseManager.getState(), error: 'SONG_LIST_INVALID' };
    if (JSON.stringify(songs).length > 4 * 1024 * 1024) return { ok: false, state: licenseManager.getState(), error: 'SONG_LIST_TOO_LARGE' };
    return licenseManager.syncSongs(songs).then(result => ({ ok: true, ...result }));
  });
  safeHandle('license:create-pairing-code', () => licenseManager.createPairingCode());
  safeHandle('license:list-pairing-codes', () => licenseManager.listPairingCodes());
  safeHandle('license:revoke-pairing-code', (id) => {
    if (!Number.isInteger(Number(id)) || Number(id) < 1) return { ok: false, error: 'PAIRING_CODE_ID_INVALID' };
    return licenseManager.revokePairingCode(Number(id));
  });

  return licenseManager.onStateChanged((snapshot) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed?.()) window.webContents.send('license:state-changed', snapshot);
  });
}

function validateActivationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, state: 'needs_activation', error: 'ACTIVATION_INPUT_INVALID' };
  const accountName = String(payload.accountName || '');
  const password = String(payload.password || '');
  const activationCode = String(payload.activationCode || '');
  if (accountName.length > 64) return { ok: false, state: 'needs_activation', error: 'ACCOUNT_NAME_LENGTH' };
  if (password.length > 256) return { ok: false, state: 'needs_activation', error: 'PASSWORD_TOO_LONG' };
  if (activationCode.length > 256) return { ok: false, state: 'needs_activation', error: 'ACTIVATION_CODE_INVALID' };
  if (!accountName || !password || !activationCode) return { ok: false, state: 'needs_activation', error: 'ACTIVATION_INPUT_INVALID' };
  return { ok: true, accountName, password, activationCode };
}

module.exports = { registerLicenseIpc, validateActivationPayload };
