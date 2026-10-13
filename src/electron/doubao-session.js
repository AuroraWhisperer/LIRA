'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { toSerializableCookie, toElectronCookieDetails } = require('./cookie-details');
const { requestDoubaoText } = require('./doubao-page');
const { doubaoError, parseDoubaoReply, readDoubaoConversation } = require('../ai/doubao-client');

const ORIGIN = 'https://www.doubao.com';
const LOGIN_COOKIE_NAMES = new Set(['sessionid', 'sessionid_ss']);

function isDoubaoCookie(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./u, '');
  return domain === 'doubao.com' || domain.endsWith('.doubao.com');
}

function createDoubaoSession({ BrowserWindow, session, safeStorage, dataDir, getParent = () => null }) {
  const accountSession = session.fromPartition(safeStorage.isEncryptionAvailable() ? 'persist:lira-doubao' : 'lira-doubao');
  const snapshotPath = path.join(dataDir, 'doubao-auth', 'cookies.enc');
  const instanceId = crypto.randomUUID();
  const controllers = new Set();
  let conversationState = null;
  let window = null;
  let loading = null;
  let initialized = null;
  let queue = Promise.resolve();
  let authWork = Promise.resolve();
  let saveTimer = null;
  let identity = '';
  let revision = 0;
  let loggedIn = false;
  let needsVerification = false;
  let disposed = false;
  let loggingOut = false;

  accountSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  accountSession.setPermissionCheckHandler(() => false);
  const cancelDownload = event => event.preventDefault();
  accountSession.on('will-download', cancelDownload);

  function getStatus() {
    return { available: !disposed, loggedIn, needsVerification, encryptionAvailable: Boolean(safeStorage.isEncryptionAvailable()) };
  }

  function invalidate() {
    revision++;
    for (const controller of controllers) controller.abort(doubaoError('DOUBAO_SESSION_CHANGED'));
  }

  async function refreshAuth() {
    const currentRevision = revision;
    const cookies = await accountSession.cookies.get({ url: ORIGIN });
    if (disposed || loggingOut || currentRevision !== revision) return;
    const credential = cookies.find(cookie => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value)?.value || '';
    const nextIdentity = credential ? crypto.createHash('sha256').update(credential).digest('hex') : '';
    if (identity !== nextIdentity) {
      conversationState = null;
      identity = nextIdentity;
      loggedIn = Boolean(identity);
      needsVerification = false;
      invalidate();
      if (!loggedIn) fs.rmSync(snapshotPath, { force: true });
    }
  }

  async function persist() {
    if (disposed || loggingOut || !loggedIn || !safeStorage.isEncryptionAvailable()) return;
    const currentRevision = revision;
    const cookies = (await accountSession.cookies.get({})).filter(isDoubaoCookie).map(toSerializableCookie);
    if (disposed || loggingOut || currentRevision !== revision) return;
    const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, cookies }));
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    const temporaryPath = `${snapshotPath}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, encrypted, { mode: 0o600 });
      fs.renameSync(temporaryPath, snapshotPath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  function cookieChanged(_event, cookie) {
    if (disposed || loggingOut || !isDoubaoCookie(cookie)) return;
    authWork = authWork.then(refreshAuth).catch(() => {});
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      authWork = authWork.then(persist).catch(() => {});
    }, 600);
  }
  accountSession.cookies.on('changed', cookieChanged);

  function initialize() {
    initialized ||= (async () => {
      if (fs.existsSync(snapshotPath) && safeStorage.isEncryptionAvailable()) {
        const current = await accountSession.cookies.get({ url: ORIGIN });
        if (!current.some(cookie => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value)) {
          try {
            const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(snapshotPath)));
            if (saved.version === 1 && Array.isArray(saved.cookies)) {
              for (const cookie of saved.cookies.filter(isDoubaoCookie)) {
                if (cookie.expirationDate && cookie.expirationDate <= Date.now() / 1000) continue;
                await accountSession.cookies.set(toElectronCookieDetails(cookie));
              }
            }
          } catch {
            console.warn('[Doubao] Unable to restore encrypted account snapshot.');
          }
        }
      }
      await authWork;
      await refreshAuth();
    })();
    return initialized;
  }

  function destroyWindow() {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    loading = null;
  }

  async function ensureWindow() {
    if (disposed || loggingOut) throw doubaoError('DOUBAO_SESSION_CHANGED');
    if (window && !window.isDestroyed()) { await loading; return window; }
    const current = new BrowserWindow({
      parent: getParent() || undefined, title: 'LIRA · 豆包账号登录与验证', width: 1100, height: 820,
      show: false, autoHideMenuBar: true,
      webPreferences: { session: accountSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    window = current;
    current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event, url) => {
      try { if (new URL(url).origin !== ORIGIN) event.preventDefault(); } catch { event.preventDefault(); }
    };
    current.webContents.on('will-navigate', restrictNavigation);
    current.webContents.on('will-redirect', restrictNavigation);
    current.on('close', event => { if (!disposed && !loggingOut) { event.preventDefault(); current.hide(); } });
    current.on('closed', () => { if (window === current) { window = null; loading = null; } });
    loading = current.loadURL(`${ORIGIN}/chat/`).catch(() => {
      if (window === current) destroyWindow();
      throw doubaoError('DOUBAO_UNAVAILABLE');
    });
    await loading;
    return current;
  }

  async function openLogin() {
    await initialize();
    const pending = ensureWindow();
    window?.show();
    window?.focus();
    const current = await pending;
    if (!loggedIn) {
      await current.webContents.executeJavaScript(`(() => {
        if (location.origin !== ${JSON.stringify(ORIGIN)}) return;
        const deadline = Date.now() + 15000;
        clearInterval(window.__liraDoubaoLoginTimer);
        const timer = window.__liraDoubaoLoginTimer = setInterval(() => {
          const login = [...document.querySelectorAll('button,[role="button"]')].find(element => element.textContent.trim() === '登录');
          if (login) { clearInterval(timer); login.click(); }
          else if (Date.now() >= deadline) clearInterval(timer);
        }, 300);
      })()`);
    }
    return getStatus();
  }

  function request({ text, signal, timeoutMs = 12000 }) {
    const queuedAt = performance.now();
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    controllers.add(controller);
    const expectedRevision = revision;
    const work = queue.then(async () => {
      combined.throwIfAborted();
      if (disposed || loggingOut || revision !== expectedRevision) throw doubaoError('DOUBAO_SESSION_CHANGED');
      // Resolve inside the queue so simultaneous first calls cannot create duplicates.
      const conversation = conversationState ||= { conversationId: '', sectionId: '', blocked: false };
      if (conversation.blocked) throw doubaoError('DOUBAO_CONTEXT_UNCONFIRMED');
      const duration = Math.min(60000, Math.max(3000, Number(timeoutMs) || 12000));
      let timer;
      let onAbort;
      const cancelled = new Promise((_, reject) => {
        onAbort = () => { destroyWindow(); reject(combined.reason); };
        combined.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(doubaoError('DOUBAO_TIMEOUT')), duration);
      });
      try {
        const operation = (async () => {
          const current = await ensureWindow();
          combined.throwIfAborted();
          if (current.webContents.getURL().split('/').slice(0, 3).join('/') !== ORIGIN) throw doubaoError('DOUBAO_UNAVAILABLE');
          // Without an ACK, neither creation nor the latest context is known.
          conversation.blocked = true;
          const { conversationId, sectionId } = conversation;
          const dispatchedAt = performance.now();
          const result = await current.webContents.executeJavaScript(`(${requestDoubaoText.toString()})(${JSON.stringify({ text, timeoutMs: duration, conversationId, sectionId })})`);
          combined.throwIfAborted();
          if (revision !== expectedRevision) throw doubaoError('DOUBAO_SESSION_CHANGED');
          if (result.error) throw doubaoError(result.error);
          if (result.status !== 200) return { status: result.status };
          let acknowledged;
          try {
            acknowledged = readDoubaoConversation(result.body);
            if (acknowledged) {
              if (conversationId && (acknowledged.conversationId !== conversationId || acknowledged.sectionId === sectionId)) {
                throw doubaoError('DOUBAO_CONTEXT_UNCONFIRMED');
              }
              Object.assign(conversation, acknowledged, { blocked: false });
            }
          } catch (error) { conversation.blocked = true; throw error; }
          // Retain acknowledged IDs even if the stream later fails or needs verification.
          let reply;
          try { reply = parseDoubaoReply(result.body); } catch (error) {
            // An explicit verification rejection before ACK permits a manual retry;
            // unlike a lost response, it does not confirm an accepted conversation.
            if (error.code === 'DOUBAO_VERIFICATION_REQUIRED') {
              conversation.blocked = false;
              if (!conversation.conversationId) conversationState = null;
            }
            throw error;
          }
          if (!acknowledged) { conversation.blocked = true; throw doubaoError('DOUBAO_CONTEXT_UNCONFIRMED'); }
          const firstTextMs = Number.isFinite(result.firstTextMs) && result.firstTextMs >= 0
            ? Math.round(dispatchedAt - queuedAt + result.firstTextMs) : undefined;
          return { status: result.status, text: reply, firstTextMs };
        })();
        return await Promise.race([operation, cancelled]);
      } finally {
        clearTimeout(timer);
        combined.removeEventListener('abort', onAbort);
      }
    });
    queue = work.catch(() => {});
    return work.finally(() => controllers.delete(controller));
  }

  async function logout() {
    if (disposed) throw doubaoError('DOUBAO_SESSION_CHANGED');
    loggingOut = true;
    conversationState = null;
    invalidate();
    clearTimeout(saveTimer);
    destroyWindow();
    try {
      await Promise.allSettled([initialized, queue, authWork]);
      await accountSession.clearStorageData();
      fs.rmSync(snapshotPath, { force: true });
      identity = '';
      loggedIn = false;
      needsVerification = false;
    } finally { loggingOut = false; }
    return getStatus();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    conversationState = null;
    invalidate();
    clearTimeout(saveTimer);
    accountSession.cookies.removeListener('changed', cookieChanged);
    accountSession.removeListener('will-download', cancelDownload);
    destroyWindow();
  }

  return {
    initialize, getStatus, openLogin, request, logout, dispose,
    getSessionRevision: () => `${instanceId}:${revision}`,
    setNeedsVerification(value) { if (needsVerification !== value) { needsVerification = value; invalidate(); } },
    async whenIdle() { await Promise.allSettled([initialized, queue, authWork]); },
  };
}

module.exports = { createDoubaoSession };
