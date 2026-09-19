'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const html = fs.readFileSync(path.resolve(__dirname, '../public/pages/admin/toolbox/dynamic-lottery.html'), 'utf8');

function element(tagName = 'div') {
  const listeners = new Map();
  let text = '';
  return {
    tagName, children: [], attributes: {}, disabled: false, hidden: false, value: '',
    get textContent() { return text + this.children.map((child) => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    set innerHTML(_) { throw new Error('Untrusted content must not be rendered as HTML'); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { text = ''; this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    focus() { this.focused = true; },
    reportValidity() { return true; },
    reset() {},
    addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: (event) => listeners.delete(event),
    dispatch(event) { if (!this.disabled) listeners.get(event)?.({ preventDefault() {} }); },
  };
}

function task(status = 'collecting') {
  return {
    id: 'task-1', revision: 4, createdAtMs: 1_700_000_000_000, status, ownerUid: '999',
    target: { url: 'https://t.bilibili.com/888', description: '真实活动标题' },
    rules: { version: 2, winnerCount: 10, requiredActions: ['like', 'repost'], requireFollow: true, endsAtMs: 1_700_000_000_000 },
    scan: { sources: {
      comment: { readCount: 80, coverage: 'exhausted' },
      like: { readCount: 30, coverage: 'unknown' },
      repost: { readCount: 20, coverage: 'unknown' },
    } },
    candidateCount: null,
  };
}

function result(count = 7) {
  return {
    roundId: 'round-1', status: 'exhausted', requestedCount: 10, checkedCount: 12,
    excludedCount: 12 - count, shortage: 10 - count, digest: 'abc123', algorithm: 'fisher-yates-crypto-v1',
    winners: Array.from({ length: count }, (_, index) => ({
      uid: String(index + 101), position: index + 1, displayName: `昵称${index + 1}`,
      commentText: `参与评论${index + 1}`, verification: { reason: 'FOLLOWING' },
    })),
  };
}

function state(currentTask = null, currentResult = null, job = null) {
  return {
    tasks: currentTask ? [{ ...currentTask, description: currentTask.target.description }] : [],
    task: currentTask, result: currentResult, job, error: '',
  };
}

async function fixture(initial = state()) {
  const elements = new Map([...html.matchAll(/\bdata-lottery-([\w-]+)/g)].map((match) => [match[1], element()]));
  const get = (name) => elements.get(name);
  const form = get('form');
  form.elements = {
    url: { value: 'https://t.bilibili.com/888', focus() {} },
    winnerCount: { value: '10' }, requireLike: { checked: false },
    requireRepost: { checked: false }, requireFollow: { checked: true },
  };
  get('history-panel').hidden = true;
  let responseState = initial;
  let pending = null;
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  const { initLotteryWorkflow } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/admin/dynamic-lottery-workflow.js'), {
      document: { createElement: element }, AbortController,
      crypto: { randomUUID: () => 'request-1' },
      setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout: (id) => timers.delete(id),
      window: { __API_TOKEN__: 'fixture-token' },
      fetch: async (url, options) => {
        calls.push({ url, ...options });
        const payload = pending ? await pending : { ok: true, data: responseState };
        return { ok: true, text: async () => JSON.stringify(payload) };
      },
    },
  );
  const controller = initLotteryWorkflow({
    querySelector: (selector) => elements.get(selector.match(/data-lottery-([\w-]+)/)[1]),
  });
  controller.setAuth({ available: true, loggedIn: true, busy: false });
  await settle();
  return {
    get, calls, controller, timers,
    setState(next) { responseState = next; },
    setPending(next) { pending = next; },
    async click(name) { get(name).dispatch('click'); await settle(); },
  };
}

test('setup submits the original rule fields and history remains accessible', async (t) => {
  const f = await fixture();
  t.after(() => f.controller.dispose());
  assert.equal(f.get('setup').hidden, false);
  assert.equal(f.get('activity').hidden, true);
  assert.equal(f.get('result-panel').hidden, true);
  await f.click('history-toggle');
  assert.equal(f.get('history-panel').hidden, false);
  assert.equal(f.get('history-empty').hidden, false);
  f.setState(state(null, null, { kind: 'create', taskId: null }));
  f.get('form').dispatch('submit');
  await settle();
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), {
    url: 'https://t.bilibili.com/888', winnerCount: 10,
    requireLike: false, requireRepost: false, requireFollow: true, requestId: 'request-1',
  });
  assert.equal(f.calls.at(-1).headers.Authorization, 'Bearer fixture-token');
  assert.equal(f.get('create').disabled, true);
  assert.equal(f.get('activity').hidden, false);
  assert.equal(f.get('pause').disabled, false);
  assert.match(f.get('task-status').textContent, /确认链接/);
});

test('source counts, exact activity facts and collection pause/resume/draw stay available', async (t) => {
  const current = task();
  const f = await fixture(state(current, null, { kind: 'collect', taskId: current.id }));
  t.after(() => f.controller.dispose());
  assert.equal(f.get('setup').hidden, true);
  assert.equal(f.get('progress').children.length, 3);
  assert.equal(f.get('scan-details').open, true);
  assert.match(f.get('progress').textContent, /评论80 条已完成点赞30 条未采集完转发20 条未采集完/);
  assert.equal(f.get('task-info').textContent, '真实活动标题');
  assert.equal(f.get('task-link').href, current.target.url);
  assert.equal(f.get('task-author').textContent, 'UID 999');
  assert.equal(f.get('task-cutoff').textContent, new Date(current.rules.endsAtMs).toLocaleString());
  assert.equal(f.get('pause').textContent, '暂停获取');
  assert.equal(f.get('draw').disabled, true);
  const paused = { ...current, status: 'paused', revision: 5 };
  f.setState(state(paused));
  await f.click('pause');
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { taskId: current.id, revision: 4, action: 'pause' });
  assert.equal(f.get('resume').disabled, false);
  assert.equal(f.get('resume').hidden, false);
  assert.equal(f.get('history').disabled, false);
  const ready = { ...current, status: 'ready', revision: 6, candidateCount: 0 };
  f.setState(state(ready));
  await f.click('resume');
  assert.equal(JSON.parse(f.calls.at(-1).body).revision, 5);
  assert.equal(f.get('draw').disabled, false);
  assert.match(f.get('candidate-info').textContent, /0 人/);
  assert.equal(f.get('state-refresh').disabled, false);
  await f.click('draw');
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { taskId: current.id, revision: 6, action: 'draw' });
});

test('verification can pause and resume while confirmed winners remain visible', async (t) => {
  const current = task('drawing');
  const partial = { ...result(1), status: 'drawing', shortage: 0 };
  const f = await fixture(state(current, partial, { kind: 'draw', taskId: current.id }));
  t.after(() => f.controller.dispose());
  assert.equal(f.get('pause').textContent, '暂停核验');
  assert.equal(f.get('result-panel').hidden, false);
  assert.equal(f.get('scan-details').open, false);
  assert.equal(f.get('task-actions').hidden, false);
  assert.equal(f.get('winners').children.length, 1);
  f.setState(state({ ...current, status: 'paused' }, { ...partial, status: 'paused', reason: 'LOTTERY_RELATION_UNKNOWN' }));
  await f.click('pause');
  assert.match(f.get('message').textContent, /当前候选人/);
  assert.equal(f.get('resume').textContent, '继续原顺序核验');
  assert.equal(f.get('resume').disabled, false);
  assert.equal(f.get('winners').children.length, 1);
  await f.click('resume');
  assert.equal(JSON.parse(f.calls.at(-1).body).action, 'resume');
});

test('results render full untrusted text, legacy fallback, all pages and shortage without losing proof', async (t) => {
  const completed = result();
  const text = '<img src=x onerror=alert(1)>\n长评论'.repeat(100);
  completed.winners[0].displayName = '<script>昵称</script>';
  completed.winners[0].commentText = text;
  completed.winners[1].displayName = null;
  completed.winners[1].commentText = null;
  const f = await fixture(state(task('exhausted'), completed));
  t.after(() => f.controller.dispose());
  const [first, second] = f.get('winners').children;
  assert.equal(first.children[1].children[1].children[1].textContent, text);
  assert.equal(first.children[1].children[0].children[0].textContent, '<script>昵称</script>');
  assert.equal(first.children[1].children[0].children[0].href, 'https://space.bilibili.com/101');
  assert.match(second.textContent, /UID 102.*该记录未保存评论内容/);
  assert.equal(f.get('winners').children.length, 5);
  assert.equal(f.get('task-actions').hidden, true);
  f.get('scan-details').open = true;
  assert.match(f.get('result-note').textContent, /已确认 7 \/ 10 人.*已核验 12 人.*不符合 5 人.*缺额 3 人/);
  assert.match(f.get('draw-proof').textContent, /abc123.*fisher-yates-crypto-v1.*不会重排/);
  await f.click('next');
  assert.equal(f.get('winners').children.length, 2);
  assert.equal(f.get('winners').children[0].children[0].textContent, '6');
  assert.equal(f.get('next').disabled, true);
  await f.click('state-refresh');
  assert.equal(f.get('scan-details').open, true);
  assert.match(f.get('page-info').textContent, /2 \/ 2 页/);
  f.setState(state({ ...task('completed'), id: 'task-2' }, { ...result(1), roundId: 'round-2' }));
  f.get('history').value = 'task-2';
  f.get('history').dispatch('change');
  await settle();
  assert.match(f.calls.at(-1).url, /taskId=task-2/);
  assert.equal(f.get('winners').children[0].children[0].textContent, '1');
  assert.equal(f.get('pager').hidden, true);
  await f.click('new');
  assert.equal(f.get('setup').hidden, false);
  assert.equal(f.get('result-panel').hidden, true);
});

test('errors before task creation are visible and old-rule records remain read-only', async (t) => {
  const f = await fixture({ ...state(), error: 'LOTTERY_DYNAMIC_LINK_INVALID' });
  t.after(() => f.controller.dispose());
  assert.equal(f.get('setup').hidden, false);
  assert.equal(f.get('activity').hidden, false);
  assert.equal(f.get('task-details').hidden, true);
  assert.match(f.get('message').textContent, /HTTPS 链接/);
  const legacy = task('ready');
  legacy.rules.version = 1;
  f.setState(state(legacy));
  f.get('history').disabled = false;
  f.get('history').value = legacy.id;
  f.get('history').dispatch('change');
  await settle();
  assert.match(f.get('message').textContent, /仅供查看/);
  assert.equal(f.get('draw').disabled, true);
  assert.equal(f.get('resume').disabled, true);
});

test('authorization reset discards late results and dispose stops polling and handlers', async () => {
  const f = await fixture(state(task('drawing'), result(1), { kind: 'draw', taskId: 'task-1' }));
  const pending = Promise.withResolvers();
  f.setPending(pending.promise);
  f.get('state-refresh').dispatch('click');
  const request = f.calls.at(-1);
  f.controller.reset();
  assert.equal(request.signal.aborted, true);
  pending.resolve({ ok: true, data: state(task('completed'), result()) });
  await settle();
  assert.equal(f.get('result-panel').hidden, true);
  assert.equal(f.get('history').children.length, 0);
  assert.equal(f.timers.size, 0);
  const callCount = f.calls.length;
  f.controller.dispose();
  await f.click('state-refresh');
  assert.equal(f.calls.length, callCount);
});
