'use strict';

const { randomUUID } = require('node:crypto');
const { dayOf } = require('../fans/dates');

function fanScopeFor(licenseManager) {
  if (!licenseManager?.isAuthorized()) return null;
  const identity = licenseManager.getCloudSyncIdentity();
  const origin = licenseManager.getRemoteBaseUrl();
  if (!identity?.streamerId || !origin) return null;
  return JSON.stringify([new URL(origin).origin, String(identity.streamerId)]);
}

function createFanProfileController({
  licenseManager,
  getService,
  getRoomId = () => '',
  fetchGuardRoster,
  timers = globalThis,
  now = Date.now,
  isWindowOpen = () => false,
}) {
  let disposed = false;
  let timer = null;
  let abortController = null;
  let rosterAbortController = null;
  let rosterOperation = null;
  let operation = Promise.resolve();
  let current = null;
  let syncStatus = 'offline';
  let delay = 15000;
  const startedAt = now();
  let automaticTimer = null;
  let automaticOperation = null;

  function context() {
    const scope = fanScopeFor(licenseManager);
    if (!scope || disposed) {
      abortController?.abort();
      rosterAbortController?.abort();
      current = null;
      syncStatus = 'offline';
      return null;
    }
    const epoch = licenseManager.getAuthorizationEpoch();
    if (!current || current.scope !== scope || current.epoch !== epoch) {
      abortController?.abort();
      rosterAbortController?.abort();
      // Renewal preserves the page context while replacing the authorization
      // generation used to fence in-flight work.
      const id = current?.scope === scope ? current.id : randomUUID();
      current = { ...(current?.id === id ? current : {}), scope, epoch, id };
      if (automaticOperation) current.automaticAttempt = null;
      syncStatus = 'pending';
    }
    return current;
  }

  function same(captured) {
    const active = context();
    return active?.id === captured.id && active.epoch === captured.epoch;
  }

  async function sync() {
    const captured = context();
    if (!captured) return;
    try {
      const service = getService();
      let settings = service?.execute(captured.scope, 'settings');
      if (!settings?.initialized) return;
      abortController = new AbortController();
      syncStatus = 'syncing';
      let hasMore = false;
      // Bounded pages keep shutdown and account changes responsive. The next
      // pass resumes from the cursor committed with the last complete page.
      for (let count = 0; count < 10; count++) {
        const page = await licenseManager.getFanFactsInternal({
          after: settings.cursor || 0,
          epoch: settings.epoch,
          signal: abortController.signal,
        });
        if (!same(captured)) return;
        settings = service.consumeFacts(captured.scope, page);
        hasMore = page.hasMore === true;
        if (!page.hasMore) break;
      }
      syncStatus = hasMore ? 'syncing' : 'ready';
      delay = 15000;
    } catch (error) {
      if (!same(captured)) return;
      syncStatus = error.status === 404 ? 'unsupported' : 'offline';
      delay = Math.min(Math.max(delay * 2, error.retryAfterMs || 0), 300000);
    }
  }

  function schedule() {
    if (disposed) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      void run();
    }, delay);
    timer?.unref?.();
  }

  function run() {
    timers.clearTimeout(timer);
    operation = operation.then(sync).finally(schedule);
    return operation;
  }

  const unsubscribe = licenseManager.onStateChanged(() => {
    context();
    void run();
  });

  function response(captured, data) {
    return {
      contextId: captured.id,
      data,
      syncStatus,
      roomId: String(getRoomId() || ''),
      accountName: licenseManager.getCloudSyncIdentity()?.accountName || '',
    };
  }

  async function syncGuardRoster(captured, service, automaticDate) {
    const roomId = String(getRoomId() || '');
    if (!/^[1-9]\d{0,19}$/.test(roomId)) throw new Error('请先在连接设置中填写直播间号。');
    const controller = new AbortController();
    rosterAbortController = controller;
    try {
      const snapshot = await fetchGuardRoster(roomId, {
        signal: controller.signal,
      });
      if (!same(captured) || controller.signal.aborted)
        throw new Error('登录状态已变化，本次名单没有导入，请重新打开档案。');
      if (String(getRoomId() || '') !== roomId) throw new Error('直播间已变化，本次名单没有导入，请重新同步。');
      if (automaticDate && service.execute(captured.scope, 'settings').autoSyncGuardRoster !== true) return null;
      return response(captured, service.importGuardRoster(captured.scope, snapshot, automaticDate));
    } catch (error) {
      if (/[\u4e00-\u9fff]/.test(error.message || '')) throw error;
      throw new Error('大航海名单读取失败，本次没有导入，请检查网络后重试。');
    } finally {
      rosterAbortController = null;
    }
  }

  async function updateAutomatically() {
    const captured = context();
    if (!captured || !isWindowOpen() || rosterAbortController) return;
    const service = getService();
    const settings = service?.execute(captured.scope, 'settings');
    if (settings?.autoSyncGuardRoster !== true) return;
    const date = dayOf(now());
    const scheduledAt = Date.parse(`${date}T12:10:00+08:00`);
    if (now() < scheduledAt) return;
    const roomId = String(getRoomId() || '');
    if (!/^[1-9]\d{0,19}$/.test(roomId)) return;
    const key = `${date}:${roomId}`;
    if (
      captured.automaticAttempt === key ||
      (settings.lastGuardRosterAutoUpdate?.date === date && settings.lastGuardRosterAutoUpdate.roomId === roomId)
    )
      return;
    captured.automaticAttempt = key;
    const reason = startedAt >= scheduledAt ? 'startup' : 'scheduled';
    try {
      rosterOperation = syncGuardRoster(captured, service, date);
      const result = await rosterOperation;
      if (result && same(captured)) current.notification = { reason, status: 'success', ...result.data };
    } catch (error) {
      if (same(captured) && current.automaticAttempt === key && String(getRoomId() || '') === roomId)
        current.notification = { reason, status: 'error', error: error.message };
    }
  }

  function runAutomaticUpdate() {
    if (disposed) return Promise.resolve();
    if (!automaticOperation)
      automaticOperation = updateAutomatically().finally(() => {
        automaticOperation = null;
      });
    return automaticOperation;
  }

  function scheduleAutomaticUpdate() {
    if (disposed || !isWindowOpen()) return;
    timers.clearTimeout(automaticTimer);
    const at = now();
    const scheduledAt = Date.parse(`${dayOf(at)}T12:10:00+08:00`);
    const wait = at < scheduledAt ? Math.min(30000, scheduledAt - at) : 30000;
    automaticTimer = timers.setTimeout(() => {
      automaticTimer = null;
      void runAutomaticUpdate()
        .catch(() => null)
        .finally(scheduleAutomaticUpdate);
    }, wait);
    automaticTimer?.unref?.();
  }

  function invoke(request) {
    const captured = context();
    if (!captured) throw new Error('请先登录主播账号。');
    if (!request || typeof request !== 'object') throw new Error('档案请求无效。');
    const { action, payload = {}, contextId } = request;
    if (action !== 'open' && action !== 'auto-update-status' && contextId !== captured.id)
      throw new Error('登录状态已变化，请重新打开粉丝档案。');
    const service = getService();
    if (!service) throw new Error('档案存储尚未就绪。');
    if (action === 'auto-update-status') {
      if (!automaticTimer) scheduleAutomaticUpdate();
      return runAutomaticUpdate().then(() => {
        if (!same(captured)) return response(captured, null);
        const notification = current.notification || null;
        current.notification = null;
        return response(captured, notification);
      });
    }
    if (action === 'sync-guard-roster') {
      if (rosterAbortController) throw new Error('大航海名单正在同步，请稍候。');
      if (payload.expectedRoomId !== undefined && payload.expectedRoomId !== String(getRoomId() || ''))
        throw new Error('直播间已变化，请重新打开同步窗口。');
      rosterOperation = syncGuardRoster(captured, service);
      return rosterOperation;
    }
    const data = service.execute(captured.scope, action === 'open' ? 'list' : action, payload);
    if (action === 'configure') {
      if (data.autoSyncGuardRoster !== true) {
        captured.automaticAttempt = null;
        captured.notification = null;
      }
      void run();
    }
    return response(captured, data);
  }

  return {
    invoke,
    start() {
      scheduleAutomaticUpdate();
      return Promise.all([run(), runAutomaticUpdate().catch(() => null)]);
    },
    whenIdle: () => Promise.allSettled([operation, rosterOperation, automaticOperation]),
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.clearTimeout(timer);
      timers.clearTimeout(automaticTimer);
      abortController?.abort();
      rosterAbortController?.abort();
      unsubscribe?.();
      current = null;
    },
  };
}

module.exports = { createFanProfileController, fanScopeFor };
