'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

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
  now = Date.now,
}) {
  const filePath = path.join(dataDir, 'desktop-notifications.json');
  let settings = { ...DEFAULT_SETTINGS };
  let pending = Promise.resolve();
  let disposed = false;
  let giftEnabledAt = now();
  const notifications = new Set();
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

  function closeNotifications() {
    for (const notification of notifications) {
      notification.removeAllListeners();
      notification.close();
    }
    notifications.clear();
  }

  function update(input) {
    if (!isValidSettings(input)) return Promise.resolve({ ok: false, error: 'DESKTOP_NOTIFICATIONS_INVALID' });
    const patch = { ...input };
    const operation = pending.then(async () => {
      if (disposed) return { ok: false, error: 'DESKTOP_NOTIFICATIONS_STOPPED' };
      const next = { ...settings, ...patch };
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fileSystem.promises.writeFile(temporaryPath, JSON.stringify(next) + '\n', { flag: 'wx', flush: true });
        for (let attempt = 0; ; attempt++) {
          try { await fileSystem.promises.rename(temporaryPath, filePath); break; }
          catch (error) {
            if (attempt >= 4 || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
            await delay(50 * (attempt + 1));
          }
        }
      } catch {
        writeLog('desktop-notifications', { event: 'WRITE_FAILED' });
        return { ok: false, error: 'DESKTOP_NOTIFICATIONS_SAVE_FAILED' };
      } finally {
        await fileSystem.promises.unlink(temporaryPath).catch(() => {});
      }
      const plannerChanged = next.plannerRemindersEnabled !== settings.plannerRemindersEnabled;
      if (next.largeGiftEnabled && !settings.largeGiftEnabled) giftEnabledAt = now();
      settings = next;
      if (plannerChanged) onPlannerRemindersChanged(settings.plannerRemindersEnabled);
      if (!settings.largeGiftEnabled) closeNotifications();
      return getState();
    });
    pending = operation;
    return operation;
  }

  function notifyGift(item) {
    if (disposed || !settings.largeGiftEnabled || !Notification.isSupported() || item?.detection_status !== 'final') return;
    // Catch-up after startup or enabling must not notify about earlier gifts.
    if (!(Date.parse(item.updated_at) >= giftEnabledAt)) return;
    const totalCents = Math.round(Number(item.total_price) * 100);
    if (!Number.isSafeInteger(totalCents) || totalCents <= Math.round(settings.largeGiftThresholdRmb * 100)) return;
    let notification;
    try {
      notification = new Notification({
        title: 'LIRA · 大额礼物',
        body: `${String(item.user_name || '观众').slice(0, 80)} 送出 ${String(item.gift_name || '礼物').slice(0, 80)} × ${item.num}\n共 ${(totalCents / 100).toFixed(2)} 元`,
        ...(icon ? { icon } : {}),
      });
      notifications.add(notification);
      notification.once('click', () => {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      });
      notification.once('close', () => notifications.delete(notification));
      notification.once('failed', () => {
        notifications.delete(notification);
        writeLog('desktop-notifications', { error: 'NOTIFICATION_FAILED' });
      });
      notification.show();
    } catch {
      if (notification) notifications.delete(notification);
      writeLog('desktop-notifications', { error: 'NOTIFICATION_FAILED' });
    }
  }

  function dispose() {
    disposed = true;
    closeNotifications();
  }

  return { getState, update, notifyGift, dispose, whenIdle: () => pending };
}

module.exports = { createDesktopNotifications, configureNotificationIdentity };
