'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { FakeNode } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('games admin exposes source actions and controls for shared games and the independent wheel', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'games.html'), 'utf8');
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  for (const id of ['gamesOverlayUrl', 'wheelOverlayUrl', 'interactionsUrl']) {
    const matches = buttons.filter((tag) => new RegExp('\\sid="' + id + '"').test(tag));
    assert.equal(matches.length, 1, id + ' must be a unique source action');
    assert.match(matches[0], /\stype="button"/);
    assert.doesNotMatch(matches[0], /\shidden(?:\s|=|>)/);
  }
  for (const game of ['number-bomb', 'gomoku', 'draw-guess']) {
    assert.ok(html.includes('data-game-card="' + game + '"'));
  }
  assert.match(html, /\sdata-wheel-card(?:\s|=|>)/);
  assert.match(html, /\sid="gamesSessionStatus"/);
  assert.doesNotMatch(html, /gamesCopyBaseUrlBtn|wheelCopyUrlBtn|interactionsCopy|interactionsSourceToggle/);
  assert.match(html, /id="drawCardTrigger"/);
  assert.match(html, /id="drawCardDetails"/);
  assert.match(html, /id="drawHostWord"/);
  assert.match(html, /id="drawFinishRoundBtn"/);
  assert.match(html, /id="drawNextRoundBtn"/);
  assert.match(html, /id="drawTotalRounds"[^>]*min="1"[^>]*max="12"/);
  assert.match(html, /id="drawRoundDuration"[^>]*min="15"[^>]*max="300"/);
  assert.match(html, /id="drawWordCategories"/);
  assert.match(html, /id="drawWordCategoryStatus"/);
  assert.match(html, /id="drawSelectAllCategoriesBtn"/);
  assert.match(html, /id="drawClearCategoriesBtn"/);
  assert.match(html, /画板快捷操作：.*B.*画笔.*E.*橡皮擦.*Ctrl\+Z.*撤销/s);
  assert.match(html, /清空画布前会二次确认/);
  assert.doesNotMatch(html, /data-copy-game/);
});

test('admin game styles keep shared, wheel, draw, and responsive ownership', () => {
  const readGameStyle = (name) =>
    fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox', name), 'utf8');
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox.css'), 'utf8');
  const imports = [
    "@import url('./toolbox/games.css');",
    "@import url('./toolbox/games-wheel.css');",
    "@import url('./toolbox/games-draw.css');",
    "@import url('./toolbox/games-responsive.css');",
    "@import url('./toolbox/start-animation.css');",
  ];
  const positions = imports.map((statement) => entry.indexOf(statement));

  assert.equal(
    positions.every((position) => position >= 0),
    true,
    'the admin entry should import every game style owner',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );

  const shared = readGameStyle('games.css');
  const wheel = readGameStyle('games-wheel.css');
  const draw = readGameStyle('games-draw.css');
  const responsive = readGameStyle('games-responsive.css');

  assert.match(shared, /\.game-admin-card\s*\{/);
  assert.doesNotMatch(shared, /\.wheel-card-trigger\s*\{/);
  assert.doesNotMatch(shared, /\.draw-word-library\s*\{/);
  assert.doesNotMatch(shared, /@media/);
  assert.match(wheel, /\.wheel-card-trigger\s*\{/);
  assert.doesNotMatch(wheel, /\.draw-card-trigger\s*\{/);
  assert.match(draw, /\.draw-card-trigger\s*\{/);
  assert.match(draw, /\.draw-word-library\s*\{/);
  assert.doesNotMatch(draw, /\.wheel-card-trigger\s*\{/);
  assert.match(responsive, /\.wheel-card-trigger\s*\{/);
  assert.match(responsive, /\.draw-card-trigger\s*\{/);
  assert.match(responsive, /\.games-category\s*\{/);
});

test('games admin uses one base URL and never opens a game-specific URL', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');
  assert.doesNotMatch(script, /data-copy-game|overlayUrl\(game\)/);
  assert.match(script, /byId\('gamesOverlayUrl'\)\.addEventListener\('click', \(\) => copyUrl\(overlayBaseUrl\(\)\)/);
});

test('games word library styles expose selected and keyboard focus states', () => {
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toolbox', 'games-draw.css'), 'utf8');

  assert.match(styles, /\.draw-word-category:has\(input:checked\)/);
  assert.match(styles, /\.draw-word-category input:focus-visible/);
});

test('wheel admin applies entry, label and weight limits from server state', async () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new FakeNode('div'), { classList: { toggle() {} } }));
    return nodes.get(id);
  };
  const limits = { minEntries: 2, maxEntries: 3, minWeight: 1, maxWeight: 7, maxLabelLength: 9 };
  const wheel = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games-wheel.js'), {
    document: {
      getElementById: node,
      querySelector: () => node('wheelCard'),
      createElement: (tag) => new FakeNode(tag),
    },
    window: { addEventListener() {} },
    location: { protocol: 'http:', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    fetch: async (url) => {
      assert.equal(url, '/api/wheel');
      const body = {
        ok: true,
        data: { entries: [{ label: '唱歌', weight: 2 }], totalWeight: 2, spin: null, lastResult: null, limits },
      };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  });
  wheel.renderWheelState({ entries: [], totalWeight: 0, spin: null, lastResult: null }, { syncEntries: true });
  assert.equal(node('wheelEntries').children.length, 0, 'no editor rows before the server reports limits');
  assert.equal(node('wheelAddEntryBtn').disabled, true);
  assert.equal(node('wheelSpinBtn').disabled, true);

  await wheel.initWheelAdmin();
  const rows = () => node('wheelEntries').children;
  const input = (row, className) => row.querySelector(`.${className}`);
  assert.equal(rows().length, 1);
  assert.equal(input(rows()[0], 'wheel-label-input').maxLength, 9);
  assert.equal(input(rows()[0], 'wheel-weight-input').min, '1');
  assert.equal(input(rows()[0], 'wheel-weight-input').max, '7');
  assert.equal(node('wheelSpinBtn').disabled, true, 'spinning needs the minimum entry count');
  for (const expected of [2, 3, 3]) {
    node('wheelAddEntryBtn').listeners.click();
    assert.equal(rows().length, expected, 'adding stops at the server maximum');
  }
  assert.ok(rows().every((row) => input(row, 'wheel-remove-entry').disabled === false));
  assert.equal(input(rows()[2], 'wheel-weight-input').value, '1', 'new entries start at the minimum weight');

  wheel.renderWheelState(
    {
      entries: [
        { label: 'a', weight: 1 },
        { label: 'b', weight: 1 },
      ],
      totalWeight: 2,
      spin: null,
      lastResult: null,
      limits: { ...limits, maxEntries: 2, maxWeight: 3 },
    },
    { syncEntries: true },
  );
  assert.equal(node('wheelAddEntryBtn').disabled, true);
  assert.equal(node('wheelSpinBtn').disabled, false);
  assert.equal(input(rows()[0], 'wheel-weight-input').max, '3');
  assert.ok(
    rows().every((row) => input(row, 'wheel-remove-entry').disabled),
    'the minimum entry count cannot be removed',
  );
});

test('games admin retries an empty viewer list with backoff and fills both viewer pickers once', async () => {
  const nodes = new Map();
  // Elements are created on first lookup; parents stop after one level so ancestor walks terminate.
  class PageNode extends FakeNode {
    constructor(tag, id = '') {
      super(tag);
      Object.assign(this, { id, value: '', hidden: false, disabled: false, checked: false });
      this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
    }
    get options() {
      return this.children;
    }
    get parentElement() {
      return this.id.endsWith(':parent') ? null : node(`${this.id}:parent`);
    }
    closest() {
      return null;
    }
    querySelector(selector) {
      return node(`${this.id} ${selector}`);
    }
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
    focus() {}
    after() {}
    prepend(child) {
      this.children.unshift(child);
    }
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, new PageNode('div', id));
    return nodes.get(id);
  }
  const viewerBodies = [];
  let viewerRequests = 0;
  const timers = [];
  const fetch = async (url) => {
    if (url === '/api/games/viewers') viewerRequests += 1;
    const body =
      url === '/api/games/viewers'
        ? viewerBodies.shift()
        : url.startsWith('/api/interactions/')
          ? { ok: true, data: { runtimeId: 'runtime', revision: 0, session: null } }
          : { ok: true, data: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const location = { origin: 'http://127.0.0.1:3000', protocol: 'http:', host: '127.0.0.1:3000', search: '' };
  const games = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), {
    document: {
      hidden: false,
      getElementById: node,
      querySelector: (selector) => node(selector),
      querySelectorAll: () => [],
      createElement: (tag) => new PageNode(tag),
      addEventListener() {},
    },
    window: { addEventListener() {}, removeEventListener() {}, open() {}, location },
    location,
    fetch,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });
  const settle = async () => {
    for (let index = 0; index < 30; index += 1) await new Promise(setImmediate);
  };
  const runRetry = async (delay) => {
    const timer = timers.findLast((item) => item.delay === delay);
    assert.ok(timer, `a ${delay} ms retry is scheduled`);
    timers.splice(timers.indexOf(timer), 1);
    timer.callback();
    await settle();
  };
  const pickerTexts = (id) => node(id).children.map((option) => option.textContent);

  viewerBodies.push({ ok: true, data: [] }, { ok: true, data: [] }, { ok: true, data: [{ uid: '7', name: '观众' }] });
  games.initGames();
  await settle();
  assert.equal(viewerRequests, 1);
  assert.deepEqual(pickerTexts('numberBombViewer'), [], 'an empty first answer is not rendered while retrying');
  await runRetry(250);
  assert.equal(viewerRequests, 2);
  node('gamesRefreshViewersBtn').listeners.click();
  await settle();
  assert.equal(viewerRequests, 2, 'a manual refresh joins the retry already in flight');
  const pendingTimers = timers.length;
  await runRetry(500);
  assert.equal(viewerRequests, 3);
  for (const id of ['numberBombViewer', 'gomokuViewer']) {
    assert.deepEqual(pickerTexts(id), ['请选择观众', '观众']);
    assert.equal(node(id).children[1].value, '7');
  }
  assert.equal(timers.length, pendingTimers - 1, 'a non-empty answer schedules no further retry');

  viewerBodies.push(...Array.from({ length: 5 }, () => ({ ok: true, data: [] })));
  node('gamesRefreshViewersBtn').listeners.click();
  await settle();
  for (const delay of [250, 500, 1000, 2000]) await runRetry(delay);
  assert.equal(viewerRequests, 8, 'an empty room stops after the last backoff step');
  assert.equal(viewerBodies.length, 0);
  assert.deepEqual(pickerTexts('gomokuViewer'), ['暂无当前在线观众']);
});

test('games admin marks stale data once after a failed refresh and clears it on recovery', async () => {
  const nodes = new Map();
  class PageNode extends FakeNode {
    constructor(tag, id = '') {
      super(tag);
      Object.assign(this, { id, value: '', hidden: false, disabled: false, checked: false });
      this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false };
    }
    get options() {
      return this.children;
    }
    get parentElement() {
      return this.id.endsWith(':parent') ? null : node(`${this.id}:parent`);
    }
    closest() {
      return null;
    }
    querySelector(selector) {
      return node(`${this.id} ${selector}`);
    }
    querySelectorAll() {
      return [];
    }
    getBoundingClientRect() {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
    focus() {}
    after() {}
    prepend(child) {
      this.children.unshift(child);
    }
  }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, new PageNode('div', id));
    return nodes.get(id);
  }
  let sessionReadsFail = true;
  const fetch = async (url) => {
    if (sessionReadsFail && (url === '/api/games/session' || url === '/api/games/host-state')) {
      return { ok: false, status: 503, text: async () => JSON.stringify({ ok: false, error: '游戏状态读取失败' }) };
    }
    const body = url.startsWith('/api/interactions/')
      ? { ok: true, data: { runtimeId: 'runtime', revision: 0, session: null } }
      : { ok: true, data: null };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const location = { origin: 'http://127.0.0.1:3000', protocol: 'http:', host: '127.0.0.1:3000', search: '' };
  const sandbox = {
    document: {
      hidden: false,
      getElementById: node,
      querySelector: (selector) => node(selector),
      querySelectorAll: () => [],
      createElement: (tag) => new PageNode(tag),
      addEventListener() {},
    },
    window: { addEventListener() {}, removeEventListener() {}, open() {}, location },
    location,
    fetch,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  };
  const games = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), sandbox);
  const settle = async () => {
    for (let index = 0; index < 30; index += 1) await new Promise(setImmediate);
  };
  games.initGames();
  await settle();

  const status = node('gamesSessionStatus');
  sandbox.window.AdminApp.eventBus.emit('ws:connected');
  await settle();
  assert.match(status.textContent, /数据可能已过期/, 'a failed auto refresh tells the user the data may be stale');
  const staleText = status.textContent;
  sandbox.window.AdminApp.eventBus.emit('ws:connected');
  await settle();
  assert.equal(status.textContent, staleText, 'a repeated failure must not stack another warning');

  sessionReadsFail = false;
  sandbox.window.AdminApp.eventBus.emit('ws:connected');
  await settle();
  assert.doesNotMatch(status.textContent, /数据可能已过期/, 'a successful refresh clears the warning');
  assert.equal(status.textContent, '当前没有进行中的游戏');
});
