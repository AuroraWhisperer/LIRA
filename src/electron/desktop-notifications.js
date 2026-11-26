'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createSystemNotifications } = require('./system-notifications');
const { writeAtomicFileAsync } = require('./atomic-file');

const DEFAULT_SETTINGS = Object.freeze({
  plannerRemindersEnabled: true,
  largeGiftEnabled: false,
  largeGiftThresholdRmb: 1000,
});

function configureNotificationIdentity({ app, shell, writeLog = () => {}, fileSystem = fs }) {
  const productionId = 'com.aurorawhisperer.lira';
  const appId = app.isPackaged ? productionId : `${productionId}.development`;
  app.setAppUserModelId(appId);
  // Older development runs registered Electron under the installed application's ID.
  const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
  if (!fileSystem.existsSync(shortcut)) return;
  try {
    const link = shell.readShortcutLink(shortcut);
    if (link.appUserModelId !== productionId) return;
    const target = path.resolve(link.target);
    if (app.isPackaged) {
      // An upgrade must also repair the old collision without claiming another app's shortcut.
      const projectRoot = path.resolve(path.dirname(target), '../../..');
      const developmentExe = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
      if (target.toLowerCase() !== developmentExe.toLowerCase()) return;
      const manifest = JSON.parse(fileSystem.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
      if (manifest.name !== 'lira' || manifest.build?.appId !== productionId) return;
    } else if (target.toLowerCase() !== path.resolve(app.getPath('exe')).toLowerCase()) return;
    if (!shell.writeShortcutLink(shortcut, 'update', { appUserModelId: `${productionId}.development` })) throw new Error('Shortcut update failed');
  } catch {
    writeLog('desktop-notifications', { event: 'DEVELOPMENT_IDENTITY_REPAIR_FAILED' });
  }
}

function isValidSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => {
    if (key === 'plannerRemindersEnabled' || key === 'largeGiftEnabled') return typeof value[key] === 'boolean';
    if (key !== 'largeGiftThresholdRmb') return false;
    const amount = value[key];
    return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 &&
      Number.isSafeInteger(Math.round(amount * 100)) && amount === Math.round(amount * 100) / 100;
  });
}

function createDesktopNotifications({
  dataDir, Notification, getMainWindow, icon, writeLog = () => {},
  onPlannerRemindersChanged = () => {}, fileSystem = fs,
}) {
  const filePath = path.join(dataDir, 'desktop-notifications.json');
  let settings = { ...DEFAULT_SETTINGS };
  let pending = Promise.resolve();
  let disposed = false;
  let giftSource = null;
  let giftCutoff = null;
  let giftCutoffPending = null;
  let giftCutoffGeneration = 0;
  const notifications = createSystemNotifications({ Notification, getMainWindow, icon, writeLog,
    scope: 'desktop-notifications', timedOutLimit: 1000 });
  try {
    const stored = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
    if (!isValidSettings(stored)) throw new Error('DESKTOP_NOTIFICATIONS_INVALID');
    settings = { ...settings, ...stored };
  } catch (error) {
    if (error.code !== 'ENOENT') writeLog('desktop-notifications', { event: 'READ_FALLBACK' });
  }

  function getState() {
    return { ok: true, supported: Notification.isSupported(), settings: { ...settings } };
  }

  function update(input) {
    if (!isValidSettings(input)) return Promise.resolve({ ok: false, error: 'DESKTOP_NOTIFICATIONS_INVALID' });
    const patch = { ...input };
    const operation = pending.then(async () => {
      if (disposed) return { ok: false, error: 'DESKTOP_NOTIFICATIONS_STOPPED' };
      const next = { ...settings, ...patch };
      try {
        await writeAtomicFileAsync(filePath, JSON.stringify(next) + '\n', fileSystem.promises);
      } catch {
        writeLog('desktop-notifications', { event: 'WRITE_FAILED' });
        return { ok: false, error: 'DESKTOP_NOTIFICATIONS_SAVE_FAILED' };
      }
      const plannerChanged = next.plannerRemindersEnabled !== settings.plannerRemindersEnabled;
      const giftChanged = next.largeGiftEnabled !== settings.largeGiftEnabled;
      if (giftChanged) clearGiftCutoff();
      settings = next;
      if (plannerChanged) onPlannerRemindersChanged(settings.plannerRemindersEnabled);
      if (!settings.largeGiftEnabled) notifications.clear();
      if (giftChanged && settings.largeGiftEnabled) await refreshGiftCutoff();
      return getState();
    });
    pending = operation;
    return operation;
  }

  function clearGiftCutoff() {
    giftCutoffGeneration += 1;
    giftCutoff = null;
    giftCutoffPending = null;
  }

  function setGiftSource(source) {
    if (disposed) return Promise.resolve();
    if (source !== giftSource) {
      giftSource = source;
      clearGiftCutoff();
    }
    return refreshGiftCutoff();
  }

  function refreshGiftCutoff() {
    if (disposed || !settings.largeGiftEnabled || !giftSource?.isCurrent() || giftCutoff !== null) return Promise.resolve();
    if (giftCutoffPending) return giftCutoffPending;
    const source = giftSource;
    const generation = giftCutoffGeneration;
    giftCutoffPending = Promise.resolve().then(() => source.readCursor()).then((cursor) => {
      if (!disposed && generation === giftCutoffGeneration && source.isCurrent() &&
          Number.isSafeInteger(cursor) && cursor >= 0) giftCutoff = cursor;
    }).catch(() => {
      // An unavailable source cannot establish a cutoff. The existing gift
      // reconciliation will offer the source again; no independent retry loop.
    }).finally(() => {
      if (generation === giftCutoffGeneration) giftCutoffPending = null;
    });
    return giftCutoffPending;
  }

  function notifyGift(item) {
    if (disposed || !settings.largeGiftEnabled || !Notification.isSupported() || item?.detection_status !== 'final') return;
    const delivery = item.remote_delivery;
    // Compare the source's finalization cursor, never its business timestamp
    // with the desktop clock or local arrival of a catch-up row.
    if (giftCutoff === null || !giftSource?.isCurrent() ||
        delivery?.sourceId !== giftSource.sourceId || delivery.syncEpoch !== giftSource.syncEpoch ||
        delivery.projectionGeneration !== giftSource.projectionGeneration ||
        !Number.isSafeInteger(delivery.cursor) || delivery.cursor <= giftCutoff) return;
    const totalCents = Math.round(Number(item.total_price) * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents <= Math.round(settings.largeGiftThresholdRmb * 100)) return;
    notifications.show('LIRA · 大额礼物',
      `${String(item.user_name || '观众').slice(0, 80)} 送出 ${String(item.gift_name || '礼物').slice(0, 80)} × ${item.num}\n共 ${(totalCents / 100).toFixed(2)} 元`);
  }

  function dispose() {
    disposed = true;
    giftSource = null;
    clearGiftCutoff();
    notifications.clear();
  }

  return { getState, update, notifyGift, setGiftSource, dispose,
    whenIdle: async () => { await pending; await giftCutoffPending; } };
}

module.exports = { createDesktopNotifications, configureNotificationIdentity };
