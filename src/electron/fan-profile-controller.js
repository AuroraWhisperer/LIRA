'use strict';

const { createPublicError } = require('../shared/public-error');

const { randomUUID } = require('node:crypto');
const { setTimeout: pause } = require('node:timers/promises');
const { dayOf } = require('../fans/dates');
const { projectGuardExpiry } = require('../fans/guard-expiry');
const { identity } = require('../fans/validation');
const { fetchBilibiliFormerNames } = require('../shared/bilibili-former-names');
const { readAuthorizedIdentity } = require('./authorized-identity');

const AUTOMATIC_UPDATE_TIME = '00:10:00+08:00';

function fanScopeFor(licenseManager) {
  const identity = readAuthorizedIdentity(licenseManager);
  return identity ? JSON.stringify([identity.origin, String(identity.streamerId)]) : null;
}

function createFanProfileController({
  licenseManager,
  getService,
  getRoomId = () => '',
  fetchGuardRoster,
  fetchUserProfile,
  fetchFormerNames = fetchBilibiliFormerNames,
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
  let lastFactsContext = null;
  let syncStatus = 'offline';
  let delay = 15000;
  const startedAt = now();
  let automaticTimer = null;
  let automaticOperation = null;
  let automaticGeneration = 0;
  let automaticRosterController = null;
  let expiryJob = null;
  const expiryOperations = new Set();
  let identityPreviewJob = null;
  const identityPreviewOperations = new Set();
  const formerNameJobs = new Map();
  const formerNameOperations = new Set();

  function abortFormerNames() {
    for (const job of formerNameJobs.values()) job.controller.abort();
  }

  function context() {
    const scope = fanScopeFor(licenseManager);
    if (!scope || disposed) {
      abortController?.abort();
      rosterAbortController?.abort();
      expiryJob?.controller.abort();
      identityPreviewJob?.controller.abort();
      abortFormerNames();
      clearAutomaticTimer();
      current = null;
      syncStatus = 'offline';
      return null;
    }
    const generation = licenseManager.getAuthorizationGeneration();
    if (!current || current.scope !== scope || current.generation !== generation) {
      abortController?.abort();
      rosterAbortController?.abort();
      expiryJob?.controller.abort();
      identityPreviewJob?.controller.abort();
      abortFormerNames();
      clearAutomaticTimer();
      current = { scope, generation, id: randomUUID() };
      syncStatus = 'pending';
    }
    return current;
  }

  function same(captured) {
    const active = context();
    return active?.id === captured.id && active.generation === captured.generation;
  }

  async function sync() {
    const captured = context();
    lastFactsContext = captured;
    if (!captured) return;
    try {
      const service = getService();
      if (!service) return;
      let settings = service.execute(captured.scope, 'settings');
      captured.rosterEnabled = settings?.autoSyncGuardRoster === true;
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
      return true;
    } catch (error) {
      if (!same(captured)) return;
      syncStatus = error.status === 404 ? 'unsupported' : 'offline';
      delay = Math.min(Math.max(delay * 2, error.retryAfterMs || 0), 300000);
      return syncStatus !== 'unsupported';
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
    operation = operation.then(sync).then((retry) => { if (retry) schedule(); });
    return operation;
  }

  const unsubscribe = licenseManager.onStateChanged(() => {
    if (context() === lastFactsContext) return;
    void run();
    void runAutomaticUpdate().catch(() => {});
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

  function previewIdentity(captured, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw createPublicError('账号预览请求无效。');
    const selected = identity({ platform: 'bilibili', type: 'uid', value: payload.uid });
    if (!selected) throw createPublicError('请填写 B 站 UID。');
    const uid = selected.value;
    if (identityPreviewJob?.captured === captured && identityPreviewJob.uid === uid && !identityPreviewJob.controller.signal.aborted)
      return identityPreviewJob.promise;
    identityPreviewJob?.controller.abort();
    const controller = new AbortController();
    const job = { captured, uid, controller };
    job.promise = fetchUserProfile(uid, { signal: controller.signal }).then((profile) => {
      if (!same(captured) || controller.signal.aborted) throw createPublicError('账号或输入已变化，请重新读取头像。');
      return response(captured, { uid, name: profile?.name || '', avatarUrl: profile?.avatarUrl || '' });
    }).finally(() => {
      identityPreviewOperations.delete(job.promise);
      if (identityPreviewJob === job) identityPreviewJob = null;
    });
    identityPreviewJob = job;
    identityPreviewOperations.add(job.promise);
    return job.promise;
  }

  async function readFormerNames(captured, service, payload, supplement) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw createPublicError('曾用名请求无效。');
    let profile;
    let selected;
    if (supplement) {
      profile = service.execute(captured.scope, 'detail', { id: payload.id });
      if (profile.archived || profile.identity?.type !== 'uid') throw createPublicError('请先为当前档案绑定 B 站 UID。');
      selected = profile.identity;
    } else {
      selected = identity({ platform: 'bilibili', type: 'uid', value: payload.uid });
      if (!selected) throw createPublicError('请填写 B 站 UID。');
    }
    const key = JSON.stringify([captured.id, captured.generation, selected.value]);
    let job = formerNameJobs.get(key);
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController();
      job = { controller };
      job.promise = Promise.resolve().then(() => fetchFormerNames(selected.value, { signal: controller.signal }))
        .finally(() => { if (formerNameJobs.get(key) === job) formerNameJobs.delete(key); });
      formerNameJobs.set(key, job);
    }
    const names = await job.promise;
    if (!same(captured) || job.controller.signal.aborted) {
      throw createPublicError(supplement ? '登录状态已变化，本次未补充曾用名。' : '登录状态已变化，请重新查询曾用名。');
    }
    const data = supplement
      ? service.supplementFormerNames(captured.scope, { id: profile.id, identity: selected, names })
      : { uid: selected.value, names };
    return response(captured, data);
  }

  async function readGuardExpiry(captured, service, payload) {
    const roomId = String(getRoomId() || '');
    if (!expiryJob || expiryJob.captured !== captured || expiryJob.roomId !== roomId) {
      expiryJob?.controller.abort();
      const controller = new AbortController();
      const job = { captured, roomId, controller };
      job.promise = Promise.resolve().then(() =>
        licenseManager.getGuardExpiryWarningsInternal({ signal: controller.signal }),
      ).finally(() => {
        expiryOperations.delete(job.promise);
        if (expiryJob === job) expiryJob = null;
      });
      expiryJob = job;
      expiryOperations.add(job.promise);
    }
    let snapshot;
    try { snapshot = await expiryJob.promise; }
    catch (error) {
      if (!same(captured)) throw createPublicError('登录状态已变化，请重新打开粉丝档案。');
      return response(captured, { state: error.code === 'GUARD_EXPIRY_UNSUPPORTED' ? 'unsupported' : 'unavailable', observedAt: null, badges: [] });
    }
    if (!same(captured)) throw createPublicError('登录状态已变化，请重新打开粉丝档案。');
    if (String(getRoomId() || '') !== roomId)
      return response(captured, { state: 'sourceChanged', observedAt: null, badges: [] });
    // Archived rows keep their guard identity but never display expiry days. The header still needs the source status.
    const profiles = payload.archived === true ? [] : service.execute(captured.scope, 'list', payload).profiles;
    return response(captured, projectGuardExpiry(snapshot, profiles, roomId, now()));
  }

  async function syncGuardRoster(captured, service, automaticDate) {
    const roomId = String(getRoomId() || '');
    if (!/^[1-9]\d{0,19}$/.test(roomId)) throw createPublicError('请先在连接设置中填写直播间号。');
    const controller = new AbortController();
    const generation = automaticGeneration;
    rosterAbortController = controller;
    if (automaticDate) automaticRosterController = controller;
    function canImport() {
      if (automaticDate && generation !== automaticGeneration) return false;
      if (!same(captured) || controller.signal.aborted)
        throw createPublicError('登录状态已变化，本次名单没有导入，请重新打开档案。');
      if (String(getRoomId() || '') !== roomId) throw createPublicError('直播间已变化，本次名单没有导入，请重新同步。');
      return !automaticDate || service.execute(captured.scope, 'settings').autoSyncGuardRoster === true;
    }
    try {
      const snapshot = await fetchGuardRoster(roomId, {
        signal: controller.signal,
      });
      if (!canImport()) return null;
      const targets = service.profileRefreshTargets(captured.scope, snapshot.members);
      const refresh = { observations: [], failed: 0 };
      for (const [index, target] of targets.entries()) {
        if (!canImport()) return null;
        if (index > 0) await pause(1000, undefined, { signal: controller.signal });
        if (!canImport()) return null;
        // Timestamp before I/O so a newer realtime observation wins on commit.
        const observedAt = new Date(now()).toISOString();
        try {
          const profile = await fetchUserProfile(target.identity.value, { signal: controller.signal });
          if (!profile.name) throw createPublicError('B 站用户资料读取失败。');
          refresh.observations.push({
            ...target, name: profile.name, avatar: profile.avatarUrl, nameComplete: true, observedAt,
          });
        } catch (_) {
          // Stop this pass on an upstream failure instead of repeatedly hitting a rate limit.
          refresh.failed = targets.length - index;
          break;
        }
      }
      if (!canImport()) return null;
      return response(captured, service.importGuardRoster(captured.scope, snapshot, automaticDate, refresh, roomId));
    } catch (error) {
      if (automaticDate && generation !== automaticGeneration) return null;
      if (typeof error.publicMessage === 'string' && error.publicMessage) throw error;
      throw createPublicError('大航海名单读取失败，本次没有导入，请检查网络后重试。');
    } finally {
      rosterAbortController = null;
      if (automaticRosterController === controller) automaticRosterController = null;
    }
  }

  async function updateAutomatically() {
    const captured = context();
    if (!captured || !isWindowOpen() || rosterAbortController) return;
    const service = getService();
    if (!service || captured.rosterEnabled === false) return;
    let settings;
    if (captured.rosterEnabled === undefined) {
      settings = service.execute(captured.scope, 'settings');
      captured.rosterEnabled = settings?.autoSyncGuardRoster === true;
      if (!captured.rosterEnabled) return;
    }
    const date = dayOf(now());
    const scheduledAt = Date.parse(`${date}T${AUTOMATIC_UPDATE_TIME}`);
    if (now() < scheduledAt) return;
    const roomId = String(getRoomId() || '');
    if (!/^[1-9]\d{0,19}$/.test(roomId)) return;
    const key = `${date}:${roomId}`;
    if (captured.automaticAttempt === key) return;
    settings ??= service.execute(captured.scope, 'settings');
    if (!settings.autoSyncGuardRoster) return;
    captured.automaticAttempt = key;
    const previous = settings.lastGuardRosterAutoUpdate;
    if (previous?.date === date && (previous.roomId === roomId || previous.configuredRoomId === roomId)) return;
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
    if (!automaticOperation) {
      const generation = automaticGeneration;
      automaticOperation = updateAutomatically().finally(() => {
        automaticOperation = null;
        if (generation !== automaticGeneration && current?.rosterEnabled) return runAutomaticUpdate();
        scheduleAutomaticUpdate();
      });
    }
    return automaticOperation;
  }

  function clearAutomaticTimer() {
    timers.clearTimeout(automaticTimer);
    automaticTimer = null;
  }

  function scheduleAutomaticUpdate() {
    if (disposed || automaticTimer || !current?.rosterEnabled || !isWindowOpen()) return;
    const at = now();
    const scheduledAt = Date.parse(`${dayOf(at)}T${AUTOMATIC_UPDATE_TIME}`);
    const wait = (at < scheduledAt ? scheduledAt : scheduledAt + 86400000) - at;
    automaticTimer = timers.setTimeout(() => {
      automaticTimer = null;
      void runAutomaticUpdate().catch(() => null);
    }, wait);
    automaticTimer?.unref?.();
  }

  function invoke(request) {
    const captured = context();
    if (!captured) throw createPublicError('请先登录主播账号。');
    if (!request || typeof request !== 'object') throw createPublicError('档案请求无效。');
    const { action, payload = {}, contextId } = request;
    if (!['open', 'calendar', 'auto-update-status'].includes(action) && contextId !== captured.id)
      throw createPublicError('登录状态已变化，请重新打开粉丝档案。');
    const service = getService();
    if (!service) throw createPublicError('档案存储尚未就绪。');
    if (action === 'preview-identity') return previewIdentity(captured, payload);
    if (action === 'lookup-former-names' || action === 'supplement-former-names') {
      const operation = readFormerNames(captured, service, payload, action === 'supplement-former-names')
        .finally(() => formerNameOperations.delete(operation));
      formerNameOperations.add(operation);
      return operation;
    }
    if (action === 'guard-expiry') return readGuardExpiry(captured, service, payload);
    if (action === 'auto-update-status') {
      return runAutomaticUpdate().then(() => {
        if (!same(captured)) return response(captured, null);
        const notification = current.notification || null;
        current.notification = null;
        return response(captured, notification);
      });
    }
    if (action === 'sync-guard-roster') {
      if (rosterAbortController) throw createPublicError('大航海名单正在同步，请稍候。');
      if (payload.expectedRoomId !== undefined && payload.expectedRoomId !== String(getRoomId() || ''))
        throw createPublicError('直播间已变化，请重新打开同步窗口。');
      rosterOperation = syncGuardRoster(captured, service);
      return rosterOperation;
    }
    const data = service.execute(captured.scope, action === 'open' ? 'list' : action, payload);
    if (['configure', 'restore', 'restore-snapshot'].includes(action)) {
      clearAutomaticTimer();
      if (action !== 'configure' || data.autoSyncGuardRoster !== true) {
        automaticGeneration++;
        automaticRosterController?.abort();
      }
      captured.rosterEnabled = action === 'configure' ? data.autoSyncGuardRoster === true : undefined;
      if (!captured.rosterEnabled) {
        captured.automaticAttempt = null;
        captured.notification = null;
      }
      void run();
      void runAutomaticUpdate().catch(() => {});
    }
    return response(captured, data);
  }

  return {
    invoke,
    start() {
      clearAutomaticTimer();
      return Promise.all([run(), runAutomaticUpdate().catch(() => null)]);
    },
    whenIdle: () => Promise.allSettled([operation, rosterOperation, automaticOperation, ...expiryOperations, ...identityPreviewOperations,
      ...formerNameOperations]),
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.clearTimeout(timer);
      timers.clearTimeout(automaticTimer);
      abortController?.abort();
      rosterAbortController?.abort();
      expiryJob?.controller.abort();
      identityPreviewJob?.controller.abort();
      abortFormerNames();
      unsubscribe?.();
      current = null;
    },
  };
}

module.exports = { createFanProfileController, fanScopeFor };
