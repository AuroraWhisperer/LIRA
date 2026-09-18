'use strict';

const { randomUUID } = require('node:crypto');

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
  timers = globalThis,
}) {
  let disposed = false;
  let timer = null;
  let abortController = null;
  let operation = Promise.resolve();
  let current = null;
  let syncStatus = 'offline';
  let delay = 15000;

  function context() {
    const scope = fanScopeFor(licenseManager);
    const epoch = licenseManager.getAuthorizationEpoch();
    if (!scope || disposed) return null;
    if (!current || current.scope !== scope || current.epoch !== epoch) {
      abortController?.abort();
      current = { scope, epoch, id: randomUUID() };
      syncStatus = 'pending';
    }
    return current;
  }

  function same(captured) {
    return context()?.id === captured.id;
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
    abortController?.abort();
    current = null;
    syncStatus = 'offline';
    void run();
  });

  function invoke(request) {
    const captured = context();
    if (!captured) throw new Error('请先登录主播账号。');
    if (!request || typeof request !== 'object')
      throw new Error('档案请求无效。');
    const { action, payload = {}, contextId } = request;
    if (action !== 'open' && contextId !== captured.id)
      throw new Error('主播账号已变化，请重新打开粉丝档案。');
    const service = getService();
    if (!service) throw new Error('档案存储尚未就绪。');
    const data = service.execute(
      captured.scope,
      action === 'open' ? 'list' : action,
      payload,
    );
    if (action === 'configure') void run();
    return {
      contextId: captured.id,
      data,
      syncStatus,
      accountName: licenseManager.getCloudSyncIdentity()?.accountName || '',
    };
  }

  return {
    invoke,
    start: run,
    whenIdle: () => operation,
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.clearTimeout(timer);
      abortController?.abort();
      unsubscribe?.();
      current = null;
    },
  };
}

module.exports = { createFanProfileController, fanScopeFor };
