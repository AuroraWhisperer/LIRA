'use strict';

const { randomUUID } = require('node:crypto');
const { RANK_BOARDS } = require('./live-rank-provider');

const REFRESH_MS = 500;

// One demand-driven owner serves the admin, canvas previews and every scene source.
function createLiveRankService({ provider, demand, getScope, getRoomProfile, onUpdate = () => {}, now = Date.now, timers = globalThis }) {
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
    run = { key, abort: new AbortController(), version: randomUUID(), context: null, contextAt: 0,
      boards: RANK_BOARDS.map(({ id, title, limit, unit }) => ({ id, title, limit, unit, status: 'loading', rows: [], current: null })),
      due: new Map(), failures: new Map(), timer: null, error: '', contextFailures: 0 };
    void refresh(run);
  }
  const valid = entry => !disposed && active && run === entry && currentKey() === entry.key && !entry.abort.signal.aborted;
  function retryDelay(failures, error) {
    return Math.max(Math.min(30000, 1000 * 2 ** Math.min(5, failures - 1)), error?.retryAfterMs || 0);
  }
  function schedule(entry, delay) {
    if (!valid(entry)) { ensure(); return; }
    entry.timer = timers.setTimeout(() => { entry.timer = null; void refresh(entry); }, Math.max(0, delay));
    entry.timer?.unref?.();
  }
  async function refresh(entry) {
    if (!valid(entry)) { ensure(); return; }
    try {
      if (!entry.context || now() - entry.contextAt >= 60000) {
        const profile = await getRoomProfile();
        if (!valid(entry)) { ensure(); return; }
        const context = await provider.getContext(profile, entry.abort.signal);
        if (!valid(entry)) { ensure(); return; }
        if (entry.context && JSON.stringify(context.area) !== JSON.stringify(entry.context.area)) {
          entry.boards[3] = { ...entry.boards[3], rows: [], current: null, status: 'loading', updatedAt: null };
          entry.due.delete('popular-area');
        }
        entry.context = context;
        entry.contextAt = now();
        entry.contextFailures = 0;
      }
      entry.error = '';
      await Promise.all(RANK_BOARDS.map(async (definition, index) => {
        if ((entry.due.get(definition.id) || 0) > now()) return;
        const startedAt = now();
        try {
          const board = await provider.getBoard(definition, entry.context, entry.abort.signal);
          if (!valid(entry)) return;
          entry.boards[index] = board;
          entry.failures.delete(definition.id);
          entry.due.set(definition.id, Math.max(startedAt + REFRESH_MS, now()));
        } catch (error) {
          if (!valid(entry)) return;
          const failures = (entry.failures.get(definition.id) || 0) + 1;
          entry.failures.set(definition.id, failures);
          const retryAt = now() + retryDelay(failures, error);
          entry.boards[index] = { ...entry.boards[index], status: 'stale', message: '更新延迟，正在重试', retryAt };
          entry.due.set(definition.id, retryAt);
        }
      }));
      if (!valid(entry)) { ensure(); return; }
      publish(entry);
      schedule(entry, Math.max(0, Math.min(...entry.due.values()) - now()));
    } catch (error) {
      if (!valid(entry)) { ensure(); return; }
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
      boards: run.boards, serverNow: now() }
      : { version: 'unavailable', room: null, boards: [], status: 'unavailable',
        message: '请先登录 LIRA 并配置当前账号的直播间', intervalMs: REFRESH_MS, serverNow: now() };
  }
  return { getSnapshot, touch, dispose() { disposed = true; demand.dispose(); stop(); } };
}

module.exports = { REFRESH_MS, createLiveRankService };
