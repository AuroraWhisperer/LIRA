'use strict';

const { randomUUID } = require('node:crypto');
const { RANK_BOARDS } = require('./live-rank-provider');

const REFRESH_MS = 500;

// One demand-driven owner serves the admin, canvas previews and every scene source.
function createLiveRankService({ provider, demand, getScope, getRoomProfile, onUpdate = () => {},
  now = Date.now, monotonicNow = () => performance.now(), timers = globalThis }) {
  let run;
  let active = false;
  let disposed = false;
  const scopeKey = scope => scope?.owner && scope.roomId ? JSON.stringify([scope.owner, scope.roomId]) : '';
  const currentKey = () => scopeKey(getScope());
  function stop() {
    if (!run) return;
    timers.clearTimeout(run.timer);
    run.abort.abort();
    run = null;
  }
  function publish(entry) {
    if (run !== entry || currentKey() !== entry.key) return;
    entry.version = randomUUID();
    onUpdate();
  }
  function ensure() {
    const key = currentKey();
    if (run?.key !== key) stop();
    if (!key || !active || disposed || run) return;
    run = { key, abort: new AbortController(), version: randomUUID(), context: null, contextAt: 0, loadingContext: false,
      boards: RANK_BOARDS.map(({ id, title, limit, unit }) => ({ id, title, limit, unit, status: 'loading', rows: [], current: null })),
      due: new Map(), pending: new Set(), failures: new Map(), timer: null, error: '', contextFailures: 0 };
    void refresh(run);
  }
  const valid = entry => !disposed && active && run === entry && currentKey() === entry.key && !entry.abort.signal.aborted;
  function retryDelay(failures, error) {
    return Math.max(Math.min(30000, 1000 * 2 ** Math.min(5, failures - 1)), error?.retryAfterMs || 0);
  }
  function schedule(entry, delay) {
    if (!valid(entry)) { ensure(); return; }
    timers.clearTimeout(entry.timer);
    entry.timer = timers.setTimeout(() => { entry.timer = null; void refresh(entry); }, Math.max(0, Math.ceil(delay)));
    entry.timer?.unref?.();
  }
  function scheduleNext(entry) {
    if (entry.loadingContext || entry.error) return;
    const next = Math.min(...RANK_BOARDS.filter(({ id }) => !entry.pending.has(id)).map(({ id }) => entry.due.get(id) ?? 0));
    if (Number.isFinite(next)) schedule(entry, next - monotonicNow());
  }
  async function refreshBoard(entry, definition, index) {
    const { id } = definition;
    const startedAt = monotonicNow();
    entry.pending.add(id);
    try {
      const board = await provider.getBoard(definition, entry.context, entry.abort.signal);
      if (!valid(entry)) { ensure(); return; }
      entry.boards[index] = board;
      entry.failures.delete(id);
      entry.due.set(id, startedAt + REFRESH_MS);
    } catch (error) {
      if (!valid(entry)) { ensure(); return; }
      const failures = (entry.failures.get(id) || 0) + 1;
      const delay = retryDelay(failures, error);
      entry.failures.set(id, failures);
      entry.boards[index] = { ...entry.boards[index], status: 'stale', message: '更新延迟，正在重试', retryAt: now() + delay };
      entry.due.set(id, monotonicNow() + delay);
    } finally {
      entry.pending.delete(id);
    }
    publish(entry);
    scheduleNext(entry);
  }
  async function refresh(entry) {
    if (!valid(entry)) { ensure(); return; }
    try {
      // Only the area board depends on the selected area; other boards can keep refreshing while it finishes.
      if (!entry.context || (monotonicNow() - entry.contextAt >= 60000 && !entry.pending.has('popular-area'))) {
        entry.loadingContext = true;
        const profile = await getRoomProfile();
        if (!valid(entry)) { ensure(); return; }
        const context = await provider.getContext(profile, entry.abort.signal);
        if (!valid(entry)) { ensure(); return; }
        if (entry.context && JSON.stringify(context.area) !== JSON.stringify(entry.context.area)) {
          entry.boards[3] = { ...entry.boards[3], rows: [], current: null, status: 'loading', updatedAt: null };
          entry.due.delete('popular-area');
        }
        entry.context = context;
        entry.contextAt = monotonicNow();
        entry.contextFailures = 0;
        entry.loadingContext = false;
        entry.error = '';
        publish(entry);
      }
      RANK_BOARDS.forEach((definition, index) => {
        if (!entry.pending.has(definition.id) && (entry.due.get(definition.id) ?? 0) <= monotonicNow()) {
          void refreshBoard(entry, definition, index);
        }
      });
      scheduleNext(entry);
    } catch (error) {
      if (!valid(entry)) { ensure(); return; }
      entry.loadingContext = false;
      entry.error = '直播间或榜单连接暂不可用，正在重试';
      entry.boards = entry.boards.map(board => ({ ...board, status: 'stale' }));
      publish(entry);
      schedule(entry, retryDelay(++entry.contextFailures, error));
    }
  }
  demand.subscribe(value => {
    active = value;
    if (active) ensure();
    else stop();
  });
  function touch() {
    if (disposed) return;
    demand.touch();
    ensure();
  }
  function getSnapshot() {
    touch();
    return run ? { version: run.version, room: run.context?.room || null, intervalMs: REFRESH_MS,
      status: run.error ? 'stale' : run.context ? 'ready' : 'loading', message: run.error,
      boards: run.boards.slice(), serverNow: now() }
      : { version: 'unavailable', room: null, boards: [], status: 'unavailable',
        message: '请先登录 LIRA 并配置当前账号的直播间', intervalMs: REFRESH_MS, serverNow: now() };
  }
  return { getSnapshot, touch, dispose() { disposed = true; demand.dispose(); stop(); } };
}

module.exports = { REFRESH_MS, createLiveRankService };
