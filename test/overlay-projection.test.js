'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  projectOverlayState,
  projectOverlayResponse,
  projectWebSocketPayload,
} = require('../src/server/overlay-projection');

const scopes = ['queue', 'songlist', 'blindbox', 'overtime', 'gift-effects',
  'gift-feed', 'gift-export', 'lyrics', 'games', 'danmaku', 'wheel', 'opening', 'clock'];
const secret = 'PRIVATE_SENTINEL';
const item = { id: 'message', name: '观众', message: '弹幕', kind: 'gift', giftName: '花', giftCount: 2,
  avatarUrl: 'https://i0.hdslb.com/avatar', emotes: [{ text: '[笑]', url: 'https://i0.hdslb.com/emote', width: 10, height: 10, secret }], secret };
const state = {
  secret,
  settings: { roomId: secret, aiApiKey: secret, songBoardTitle: '歌单', overlayTitle: '队列',
    blindboxOverlayTitle: '盲盒', desktopLyricFontSize: '56', danmakuOverlayStyle: 'glow',
    giftEffectDanmakuEnabled: 'true', giftDisplayConfig: secret, unknown: secret },
  queue: { current: { song_name: '歌', requester_name: '观众', requester_uid: secret, secret }, waiting: [], history: secret },
  superChats: [{ message: '留言', price: 30, uid: secret }],
  gifts: { viewRevision: 'revision', activeSource: { secret }, secret },
  liveStatus: { enabled: true, roomId: '123', connected: true, message: '已连接', cookie: secret },
  danmakuFeed: [item],
  overtime: { revision: 2, status: 'running', effectiveRemainingMs: 1000, serverNowMs: 123,
    background: { path: '/img/background.png', fit: 'cover', secret },
    rules: [{ enabled: true, giftId: '1', giftName: '花', fixedEffect: { operation: 'add', value: 30, secret }, outcomes: [{ secret }], secret }], secret },
  lyricState: { status: 'ready', generation: 7, sequence: 8, words: [{ text: '歌', startMs: 0, endMs: 100, secret }], secret },
  lyricTimeline: { status: 'ready', lines: [{ text: '歌', startMs: 0, endMs: 100, translation: 'song', secret }], secret },
};

test('every scope receives only its own snapshot fields and unknown principals fail closed', () => {
  const allowed = {
    queue: ['settings', 'queue', 'superChats'], songlist: ['settings'], blindbox: ['settings'],
    overtime: ['overtime'], 'gift-effects': ['settings'], 'gift-feed': ['gifts'],
    lyrics: ['settings', 'lyricState', 'lyricTimeline'], danmaku: ['settings', 'liveStatus', 'danmakuFeed'],
  };
  for (const scope of scopes) {
    const result = projectWebSocketPayload({ type: 'overlay', scope }, { type: 'snapshot', reason: 'connect', state, secret });
    assert.equal(result.type, 'snapshot');
    assert.equal(result.reason, 'connect');
    assert.deepEqual(Object.keys(result.state).sort(), (allowed[scope] || []).sort(), scope);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/, scope);
    assert.deepEqual(projectOverlayResponse(scope, '/api/state', state), result.state);
  }
  assert.equal(projectWebSocketPayload(null, { type: 'snapshot', state }), null);
  assert.equal(projectWebSocketPayload({ type: 'overlay', scope: 'admin' }, { type: 'snapshot', state }), null);
  assert.equal(projectOverlayResponse('unknown', '/api/state', state), null);
  assert.equal(projectOverlayState('unknown', state), null);
  assert.equal(state.queue.current.secret, secret);
});

test('WS event scope matrix strips nested extras while preserving display and drawing payloads', () => {
  const events = [
    ['danmaku', { type: 'danmaku:message', item }],
    ['gift-feed', { type: 'gift-catalog:update', snapshot: { secret } }],
    ['gift-effects', { type: 'gift:frame', eventId: 'frame', userName: '观众', giftName: '花', num: 2, totalPriceCents: 100, secret }],
    ['gift-effects', { type: 'gift:effect', eventId: 'effect', source: 'danmaku', effect: {
      mp4Url: 'https://i0.hdslb.com/effect.mp4', layout: { videoWidth: 100, videoHeight: 100, rgbFrame: [0, 0, 50, 100], alphaFrame: [50, 0, 50, 100], secret }, secret }, secret }],
    ['games', { type: 'game:draw', operation: { action: 'append', clientId: 'one', revision: 2, strokeId: 'stroke', color: '#fff', width: 4, points: [{ x: 0.1, y: 0.2, secret }], secret } }],
    ['games', { type: 'game:update', session: { game: 'number-bomb', state: { min: 1, max: 100, bomb: secret }, secret } }],
    ['wheel', { type: 'wheel:update', state: { entries: [{ label: '一', weight: 1, secret }], spin: { id: 'spin', index: 0, startedAt: 123, durationMs: 5000, turns: 6, secret }, secret } }],
    ['lyrics', { type: 'lyric-state', state: state.lyricState }],
    ['lyrics', { type: 'lyric-timeline', timeline: state.lyricTimeline }],
    ['overtime', { type: 'overtime:update', state: state.overtime, adjustment: { mode: 'fixed', giftName: '花', effect: { operation: 'add', value: 3, secret }, secret } }],
  ];
  for (const [owner, payload] of events) {
    for (const scope of scopes) {
      const result = projectWebSocketPayload({ type: 'overlay', scope }, payload);
      if (scope === owner) {
        assert.equal(result.type, payload.type);
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
      } else assert.equal(result, null, `${scope} must not receive ${payload.type}`);
    }
  }
  assert.deepEqual(projectWebSocketPayload({ type: 'overlay', scope: 'gift-feed' }, events[1][1]), { type: 'gift-catalog:update' });
  const draw = projectWebSocketPayload({ type: 'overlay', scope: 'games' }, events[4][1]);
  assert.deepEqual(draw.operation.points, [{ x: 0.1, y: 0.2 }]);
  assert.equal(draw.operation.clientId, 'one');
  assert.equal(projectWebSocketPayload({ type: 'overlay', scope: 'wheel' }, events[6][1]).state.spin.index, 0);
});

test('game HTTP and WS projections hide unrevealed answers independently of the owner DTO', () => {
  const session = { game: 'draw-guess', targetUid: secret, secret, danmaku: [item], winner: { uid: 'winner', secret }, state: {
    phase: 'drawing', round: 1, totalRounds: 5, wordLength: 3, answer: secret, answerAliases: [secret],
    revealedAnswer: secret, answerRevealed: false, categoryIds: [secret],
    correct: [{ name: '观众', rank: 1, points: 3, secret }], scores: [{ name: '观众', score: 3, secret }],
    canvas: { revision: 4, totalPoints: 1, strokes: [{ id: 's', color: '#fff', width: 4, points: [{ x: 0.1, y: 0.2, secret }], secret }], secret },
  } };
  const result = projectOverlayResponse('games', '/api/games/session', session);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  assert.equal(result.state.revealedAnswer, '');
  assert.equal(result.danmaku[0].giftCount, 2);
  assert.equal(result.winner.uid, 'winner');
  assert.deepEqual(projectWebSocketPayload({ type: 'overlay', scope: 'games' }, { type: 'game:update', session }).session, result);
  assert.deepEqual(projectOverlayState('games', { games: session }), { games: result });
  session.state.answerRevealed = true;
  session.state.revealedAnswer = '向日葵';
  assert.equal(projectOverlayResponse('games', '/api/games/session', session).state.revealedAnswer, '向日葵');
  assert.equal(projectOverlayResponse('games', '/api/games/session', null), null);
  assert.equal(projectOverlayResponse('games', '/api/games/host-state', { word: secret }), null);
});

test('REST projections retain display fields, strip nested ledger/config metadata and deny cross-page paths', () => {
  const cases = [
    ['songlist', '/api/songs', [{ id: 1, name: '歌', artist: '人', name_initial: 'G', mediaPath: secret }]],
    ['blindbox', '/api/gifts/blind-box-stats', { summary: { boxCount: 2, totalCost: 5, totalProfit: 3, secret }, perUser: [{ userName: '人', boxCount: 1, totalProfit: 3, uid: secret }] }],
    ['gift-feed', '/api/gifts/history', { items: [{ eventId: 'gift', gift: { giftId: '1', giftName: '花', giftVariantId: 'variant', coinType: 'gold', unitPrice: 1, num: 2, avatarUrl: 'https://i0.hdslb.com/avatar', guardLevel: 3, userName: '人', secret }, sourceId: secret }], nextCursor: 'cursor', viewRevision: 'revision', partial: true, secret }],
    ['gift-feed', '/api/gifts/display-settings', { thresholds: [100, 200, 300], visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: true, secret }],
    ['gift-feed', '/api/overtime/gifts/catalog', { gifts: [{ id: 1, name: '花', imagePath: '/overtime-gift-images/1.webp', giftIdentity: { variantId: 'variant', secret }, secret }], sourceId: secret }],
    ['games', '/api/games/winner-profile', { avatarUrl: 'https://i0.hdslb.com/avatar', cookie: secret }],
    ['games', '/api/games/session/draw', { revision: 7, secret }],
    ['clock', '/api/clock/config', { style: 'digital', showDate: true, showSeconds: true, hourFormat: '24', label: '时钟', secret }],
    ['opening', '/api/opening/config', { enabled: true, audioUrl: '/opening-media/current.mp3', characterUrl: '/opening-character/current.png', audioName: secret, secret }],
    ['wheel', '/api/wheel/spin', { entries: [{ label: '一', weight: 1, secret }], spin: null, lastResult: { index: 0, secret }, secret }],
  ];
  for (const [owner, pathname, data] of cases) {
    const projected = projectOverlayResponse(owner, pathname, data);
    assert.notEqual(projected, null, `${owner} ${pathname}`);
    assert.doesNotMatch(JSON.stringify(projected), /PRIVATE_SENTINEL/);
    for (const scope of scopes.filter((scope) => scope !== owner))
      assert.equal(projectOverlayResponse(scope, pathname, data), null, `${scope} ${pathname}`);
  }
  assert.equal(projectOverlayResponse('queue', '/api/settings', {}), null);
  assert.equal(projectOverlayResponse('gift-export', '/api/gifts/selection', {}), null);
});

test('dynamic queue styles, songboard theme fallback and lyric settings survive explicit key projection', () => {
  const context = vm.createContext({});
  vm.runInContext(readJsModuleBundle('public', 'js', 'shared', 'queue-style-settings.js'), context);
  const input = { unknown: secret, roomId: secret, overlayRuleColor6: '#abcdef', identityQueueScrollMode: 'loop' };
  for (const prefix of ['storybook', 'neonVinyl', 'cherryRibbon', 'goldenLily']) {
    Object.assign(input, { [`${prefix}QueueFontSize`]: '39', [`${prefix}QueueFontFamily`]: 'Serif',
      [`${prefix}QueueFontWeight`]: '600', [`${prefix}QueueUseCustomTextColor`]: 'true',
      [`${prefix}QueueTextColor`]: '#123456', [`${prefix}QueueScrollMode`]: 'loop', [`${prefix}QueueScrollSpeed`]: '45' });
  }
  const projected = projectOverlayState('queue', { settings: input }).settings;
  for (const style of ['identity', 'storybook', 'neon-vinyl', 'cherry-ribbon', 'golden-lily']) {
    assert.deepEqual(context.readQueueStyleSettings(projected, style), context.readQueueStyleSettings(input, style));
  }
  assert.equal(projected.overlayRuleColor6, '#abcdef');
  assert.equal(projected.unknown, undefined);
  const songsSource = fs.readFileSync(path.join(__dirname, '../public/js/overlays/songs.js'), 'utf8');
  const themeKeys = [...songsSource.matchAll(/resolve\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].flatMap((match) => [match[1], match[2]]);
  const theme = Object.fromEntries(themeKeys.map((key) => [key, 'fixture']));
  assert.deepEqual(projectOverlayState('songlist', { settings: theme }).settings, theme);
  const lyricSource = fs.readFileSync(path.join(__dirname, '../public/js/lyrics/desktop-lyric-defaults.js'), 'utf8');
  const lyricKeys = [...lyricSource.matchAll(/\b(desktopLyric\w+):/g)].map((match) => match[1]);
  const lyricSettings = Object.fromEntries(lyricKeys.map((key) => [key, 'fixture']));
  assert.deepEqual(projectOverlayState('lyrics', { settings: lyricSettings }).settings, lyricSettings);
});

test('allowlisted scalar names cannot smuggle nested objects and admin messages remain unchanged', () => {
  const result = projectOverlayState('queue', { settings: { overlayTitle: { secret } }, queue: { current: { song_name: { secret } }, waiting: [] } });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  const payload = { type: 'admin-only', state };
  assert.equal(projectWebSocketPayload({ type: 'admin' }, payload), payload);
  for (const scope of scopes) {
    assert.equal(projectWebSocketPayload({ type: 'overlay', scope }, payload), null);
    assert.deepEqual(projectWebSocketPayload({ type: 'overlay', scope }, { type: 'shutdown', reason: 'restart', state, secret }), { type: 'shutdown', reason: 'restart' });
  }
});

test('real game owner retains moves, canvas recovery, results and restart through the projection', (t) => {
  const { createGameSessionService } = require('../src/games/game-session-service');
  t.mock.method(Math, 'random', () => 0);
  const service = createGameSessionService({ random: () => 0,
    drawGuessWords: [{ word: '独立答案', category: '测试' }] });
  const project = () => projectOverlayResponse('games', '/api/games/session', service.getSession());
  try {
    service.start({ game: 'number-bomb', mode: 'multi' });
    assert.equal(Object.hasOwn(project().state, 'bomb'), false);
    const result = service.move({ value: 1 }, 'host');
    assert.equal(result.accepted, true);
    assert.equal(project().state.winner, 'viewer');
    assert.equal(project().state.lastGuess, 1);
    service.restart();
    assert.equal(project().state.winner, '');
    service.stop();
    service.start({ game: 'gomoku', mode: 'multi' });
    service.move({ value: 'A1' }, 'host');
    assert.equal(project().state.board[0][0], 'black');
    assert.equal(project().state.turn, 'viewer');
    service.stop();
    service.start({ game: 'draw-guess' });
    assert.equal(service.getHostState().word, '独立答案');
    assert.doesNotMatch(JSON.stringify(project()), /独立答案/);
    const operation = { action: 'append', clientId: 'client', strokeId: 'stroke',
      color: '#222034', width: 4, points: [{ x: 0.2, y: 0.3 }] };
    assert.equal(service.draw(operation).accepted, true);
    assert.deepEqual(project().state.canvas.strokes[0].points, operation.points);
    assert.equal(service.draw({ action: 'undo', clientId: 'client' }).accepted, true);
    assert.deepEqual(project().state.canvas.strokes, []);
    service.move({ action: 'finish-round' }, 'host');
    assert.equal(project().state.revealedAnswer, '');
    service.move({ action: 'reveal-answer' }, 'host');
    assert.equal(project().state.revealedAnswer, '独立答案');
    service.stop();
    assert.equal(project(), null);
  } finally {
    service.dispose();
  }
});

test('actual shared gift banner renders the same avatar, guard, artwork, amount and text from projected REST data', () => {
  function element(tag) {
    const node = { tag, children: [], dataset: {}, properties: {}, textContent: '',
      append(...items) { this.children.push(...items); }, setAttribute() {}, addEventListener() {} };
    node.style = { setProperty(key, value) { node.properties[key] = value; } };
    return node;
  }
  const context = vm.createContext({ document: { createElement: element }, window: { __API_TOKEN__: 'scoped-token' } });
  vm.runInContext(readJsModuleBundle('public', 'js', 'shared', 'gift-banner.js'), context);
  const data = { items: [{ eventId: 'one', gift: { giftId: '1', giftName: '花', giftVariantId: 'v1', coinType: 'gold',
    userName: '观众', unitPrice: 23, num: 42, avatarUrl: 'https://i0.hdslb.com/avatar', guardLevel: 3, secret }, secret }] };
  const catalog = { gifts: [{ id: 1, name: '花', variantId: 'v1', imagePath: '/overtime-gift-images/1.webp', secret }] };
  const config = { palette: 'bilibili-four', thresholds: [10000, 50000, 100000], visibleRows: 3, intervalSeconds: 4, paused: false, lowPower: false, secret };
  const projected = projectOverlayResponse('gift-feed', '/api/gifts/history', data);
  const projectedCatalog = projectOverlayResponse('gift-feed', '/api/overtime/gifts/catalog', catalog);
  const projectedConfig = projectOverlayResponse('gift-feed', '/api/gifts/display-settings', config);
  assert.equal(
    JSON.stringify(context.createGiftBanner(projected.items[0], projectedConfig, projectedCatalog.gifts)),
    JSON.stringify(context.createGiftBanner(data.items[0], config, catalog.gifts)),
  );
});
