'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { FakeNode, createFakeDocument, findByClass } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('astral preserves room roles, safe emotes, settled gifts and complete removable SC', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'astral', autoScroll: false,
    resolveEmoteUrl: () => '/approved-emote.png' });
  const original = '  第一行\n<b>完整留言</b>  ';
  feed.render([
    { id: 'chat', name: '<b>观众</b>', guardLevel: 1, roomGuardLevel: 0, message: '[妙]',
      emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
    { id: 'captain', name: '舰长', roomGuardLevel: 3, message: '你好' },
    { id: 'gift', kind: 'gift', name: '送礼者', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
    { id: 'member', kind: 'gift', name: '续订者', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 },
    { id: 'sc', kind: 'superchat', name: '留言者', price: 0, message: original },
  ]);
  const [chat, captain, gift, member, sc] = root.children;
  assert.equal(findByClass(chat, 'astral-name').textContent, '<b>观众</b>');
  assert.equal(findByClass(chat, 'astral-role'), undefined);
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
  assert.equal(findByClass(captain, 'astral-role').textContent, '舰长');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<b>星愿</b>');
  assert.equal(findByClass(gift, 'astral-amount').textContent, '¥12.50');
  assert.equal(findByClass(member, 'astral-event-label').textContent, '续费提督');
  assert.equal(findByClass(member, 'astral-amount').textContent, '—');
  assert.equal(findByClass(sc, 'astral-copy').textContent, original);
  assert.equal(findByClass(sc, 'astral-copy').children.length, 0);
  assert.equal(findByClass(sc, 'astral-amount').textContent, '¥0.00');
  feed.remove(['sc']);
  assert.equal(root.children.includes(sc), false);
  feed.destroy();
});

test('glass bubbles keep safe graphemes, emotes and settled event content through SC removal', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'glass-bubble', layout: 'fullscreen-random', autoScroll: false,
    resolveEmoteUrl: () => '/approved-emote.png' });
  const message = '  第一行👨‍👩‍👧‍👦\n<b>完整留言</b>  ';
  feed.render([
    { id: 'chat', name: '<img onerror=bad>', message: '你好[妙]',
      emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
    { id: 'gift', kind: 'gift', name: '观众', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
    { id: 'member', kind: 'gift', name: '观众', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 },
    { id: 'sc', kind: 'superchat', name: '来信', price: 0, message },
  ]);
  const [chat, gift, member, sc] = root.children;
  const { findAllByClass } = require('../helpers/fake-dom');
  const text = node => findAllByClass(node, 'glass-bubble-glyph').map(glyph => glyph.textContent).join('');
  assert.equal(findByClass(chat, 'glass-bubble-name').textContent, '<img onerror=bad>');
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
  assert.equal(findByClass(gift, 'glass-bubble-amount').textContent, '¥12.5', 'settled total is not multiplied again');
  assert.match(text(gift), /<b>星愿<\/b>/);
  assert.match(text(member), /提督.*续费/);
  assert.equal(findByClass(member, 'glass-bubble-amount').textContent, '—');
  assert.equal(findByClass(sc, 'glass-bubble-amount').textContent, '¥0');
  assert.equal(text(sc), message);
  assert.ok(findAllByClass(sc, 'glass-bubble-glyph').some(glyph => glyph.textContent === '👨‍👩‍👧‍👦'));
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, gift, member]);
  feed.destroy();
});

test('celestial horizontal preserves safe chat, settled gifts, membership actions and removable full SC', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'celestial-horizontal', layout: 'horizontal', autoScroll: false,
    resolveEmoteUrl: () => '/approved-emote.png' });
  const original = '  第一行\n<b>完整留言</b>  ';
  feed.render([
    { id: 'chat', name: '<b>观众</b>', message: '[妙]',
      emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
    { id: 'gift', kind: 'gift', name: '送礼者', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
    { id: 'member', kind: 'gift', name: '续订者', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 },
    { id: 'sc', kind: 'superchat', name: '留言者', price: 0, message: original },
  ]);
  const [chat, gift, member, sc] = root.children;
  assert.equal(findByClass(chat, 'celestial-name').textContent, '<b>观众</b>');
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
  assert.equal(findByClass(gift, 'celestial-copy').textContent, '送出 <b>星愿</b> ×10 · ¥12.50');
  assert.equal(findByClass(member, 'celestial-copy').textContent, '续费 提督 ×1 · —');
  assert.equal(findByClass(sc, 'sc-copy').textContent, original);
  assert.equal(findByClass(sc, 'sc-copy').children.length, 0);
  assert.equal(findByClass(sc, 'celestial-amount').textContent, '¥0.00');
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, gift, member]);
  feed.destroy();
});

test('animated gradient keeps safe chat, room roles and settled event details with complete removable SC', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'animated-gradient', autoScroll: false,
    resolveEmoteUrl: () => '/approved-emote.png' });
  const message = '  第一行\n<b>完整留言</b>  ';
  feed.render([
    { id: 'chat', name: '<b>观众</b>', roomGuardLevel: 0, guardLevel: 1, medalName: '外房间',
      message: '[妙]', emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
    { id: 'captain', name: '舰长', roomGuardLevel: 3, roomMedal: { name: '星旅', level: 12 }, message: '你好' },
    { id: 'gift', kind: 'gift', name: '送礼者', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
    { id: 'member', kind: 'gift', name: '续订者', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 },
    { id: 'sc', kind: 'superchat', name: '留言者', price: 0, message },
  ]);
  const [chat, captain, gift, member, sc] = root.children;
  assert.equal(findByClass(chat, 'gradient-role'), undefined, 'other-room identity is not displayed');
  assert.equal(findByClass(chat, 'gradient-name').textContent, '<b>观众</b>');
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
  assert.equal(findByClass(captain, 'gradient-role').textContent, '舰长 · 星旅 12');
  assert.equal(findByClass(gift, 'gradient-gift-name').textContent, '<b>星愿</b>');
  assert.equal(findByClass(gift, 'gradient-gift-count').textContent, '×10');
  assert.equal(findByClass(gift, 'gradient-amount').textContent, ' · ¥12.5', 'the settled total is not multiplied again');
  assert.equal(findByClass(member, 'gradient-event-action').textContent, '续费 ');
  assert.equal(findByClass(member, 'gradient-gift-name').textContent, '提督');
  assert.equal(findByClass(member, 'gradient-amount').textContent, ' · —');
  assert.equal(findByClass(sc, 'gradient-amount').textContent, ' · ¥0');
  assert.equal(findByClass(sc, 'sc-copy').textContent, message);
  assert.equal(findByClass(sc, 'sc-copy').children.length, 0, 'SC remains literal original text');
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, captain, gift, member]);
  feed.destroy();
});

test('animated gradient retains snapshots and new messages without timed expiration', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const timers = new Map();
  let nextTimer = 0;
  let clock = 20000;
  const feed = module.createDanmakuFeed(root, { style: 'animated-gradient', autoScroll: false, now: () => clock,
    scheduleTimeout(callback, delay) { timers.set(++nextTimer, { callback, at: clock + delay }); return nextTimer; },
    cancelTimeout(id) { timers.delete(id); } });
  feed.render([{ id: 'old', timestamp: 1000, name: '观众', message: '历史消息' }]);
  assert.equal(root.children.length, 1, 'old snapshots remain visible regardless of event age');
  const old = root.children[0];
  feed.append({ id: 'new', timestamp: clock, name: '新观众', message: '新消息' });
  const latest = root.children[1];
  clock += 60000;
  for (const [id, timer] of [...timers]) {
    if (timer.at > clock) continue;
    timers.delete(id);
    timer.callback();
  }
  assert.deepEqual(root.children, [old, latest], 'idle time does not remove fixed messages');
  assert.equal(timers.size, 0);
  feed.destroy();
});

test('wireframe keeps room roles, safe emotes, settled prices and full removable SC in its separate layouts', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'wireframe', autoScroll: false,
    resolveEmoteUrl: () => '/approved-emote.png' });
  const message = '  第一行\n<b>完整留言</b>  ';
  feed.render([
    { id: 'chat', name: '<b>观众</b>', roomGuardLevel: 0, guardLevel: 1, medalLevel: 99,
      message: '[妙]', emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
    { id: 'captain', name: '舰长', roomGuardLevel: 3, message: '你好' },
    { id: 'gift', kind: 'gift', name: '观众', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
    { id: 'member', kind: 'gift', name: '续订者', roomGuardLevel: 3, giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 },
    { id: 'sc', kind: 'superchat', name: '留言者', price: 0, message },
  ]);
  const [chat, captain, gift, member, sc] = root.children;
  assert.equal(findByClass(chat, 'wireframe-guard'), undefined, 'other-room guard status is not displayed');
  assert.equal(findByClass(chat, 'wireframe-medal'), undefined, 'other-room medals are not displayed');
  assert.equal(findByClass(chat, 'wireframe-name').textContent, '<b>观众</b>');
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
  assert.equal(findByClass(captain, 'wireframe-guard').alt, '舰长');
  assert.equal(findByClass(gift, 'wireframe-copy').textContent, '投喂 <b>星愿</b>x10');
  assert.equal(findByClass(gift, 'wireframe-amount').textContent, 'CN¥12.5', 'settled total is not multiplied again');
  assert.equal(member.dataset.role, 'admiral', 'purchased tier wins over a stale room tier');
  assert.match(member.getAttribute('aria-label'), /续费提督/);
  assert.equal(findByClass(member, 'wireframe-member-label').textContent, '提督已入列');
  assert.equal(sc.classList.contains('is-superchat'), true);
  assert.equal(findByClass(sc, 'wireframe-amount').textContent, 'CN¥0.0', 'zero is a known amount');
  assert.equal(findByClass(sc, 'sc-copy').textContent, message);
  assert.equal(findByClass(sc, 'sc-copy').children.length, 0, 'SC is literal original text');
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, captain, gift, member]);
  feed.append({ id: 'unknown', kind: 'gift', name: '观众', giftName: '礼物', giftCount: 1 });
  assert.equal(findByClass(root.children.at(-1), 'wireframe-amount').textContent, '—');
  feed.destroy();
});

for (const style of ['christmas', 'christmas-letter']) {
  test(`${style} preserves room identity, emotes, full SC and settled gift amounts`, async () => {
    const prefix = style === 'christmas' ? 'christmas' : 'xletter';
    const giftAmount = style === 'christmas' ? 'christmas-amount' : 'xletter-gift-amount';
    const root = new FakeNode('div');
    const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
      document: createFakeDocument(),
    });
    const feed = module.createDanmakuFeed(root, { style, autoScroll: false,
      resolveEmoteUrl: () => '/approved-emote.png' });
    feed.render([
      { id: 'chat', name: '<b>冬日来信</b>', roomGuardLevel: 0, guardLevel: 1, message: '[妙]',
        emotes: [{ text: '[妙]', url: 'https://i0.hdslb.com/emote.png', width: 64, height: 64 }] },
      { id: 'gift', kind: 'gift', name: '观众', giftName: '<b>星愿</b>', giftCount: 10, giftTotalPrice: 12.5 },
      { id: 'member', kind: 'gift', name: '舰长', giftGuardLevel: 3, giftCount: 1 },
      { id: 'sc', kind: 'superchat', name: '来信', price: 50, message: '第一行\n<b>完整留言</b>' },
    ]);
    const [chat, gift, member, sc] = root.children;
    assert.equal(findByClass(chat, style === 'christmas' ? 'christmas-role' : 'xletter-role-label'), undefined, 'other-room guard status is not shown');
    assert.equal(findByClass(chat, `${prefix}-name`).textContent, '<b>冬日来信</b>');
    assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/approved-emote.png');
    assert.equal(findByClass(gift, `${prefix}-gift-name`).textContent, '<b>星愿</b>');
    assert.equal(findByClass(gift, giftAmount).textContent, '¥12.50', 'the settled total is not multiplied again');
    assert.equal(findByClass(member, `${prefix}-gift-action`).textContent, '支持 ');
    assert.equal(findByClass(member, `${prefix}-gift-name`).textContent, '舰长');
    assert.equal(findByClass(member, `${prefix}-amount`).textContent, '—', 'unknown prices are not invented');
    const copy = findByClass(sc, `${prefix}-copy`);
    assert.equal(findByClass(sc, `${prefix}-amount`).textContent, '¥50.00');
    assert.equal(copy.textContent, '第一行\n<b>完整留言</b>');
    assert.equal(copy.children.length, 0, 'SC remains literal text');
    feed.remove(['sc']);
    assert.deepEqual(root.children, [chat, gift, member]);
    feed.append({ id: 'renew', kind: 'gift', name: '续订者', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1, giftTotalPrice: 1998 });
    const renewed = root.children.at(-1);
    assert.equal(findByClass(renewed, `${prefix}-gift-action`).textContent, '续费 ');
    assert.equal(findByClass(renewed, `${prefix}-gift-name`).textContent, '提督');
    feed.destroy();
  });
}

test('christmas letter applies room medal levels to every guard tier and uses the shared SC path', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'christmas-letter', autoScroll: false });
  const message = '  普通文字也可以写 SC ¥50\n但类型由事件决定。  ';
  const tiers = [
    { guard: 3, role: 'captain', label: '舰长', level: 28 },
    { guard: 2, role: 'admiral', label: '提督', level: 38 },
    { guard: 1, role: 'governor', label: '总督', level: 50 },
  ];
  feed.render([
    { id: 'viewer', name: '普通观众', message, price: 50, medalLevel: 99, medalName: '其他房间' },
    { id: 'fan', name: '团员', message, roomMedal: { name: '小铃铛', level: 12 } },
    ...tiers.map(tier => ({ id: tier.role, name: '本房间成员', message,
      roomGuardLevel: tier.guard, roomMedal: { name: '小铃铛', level: tier.level } })),
    ...tiers.map(tier => ({ id: `join-${tier.role}`, kind: 'gift', name: '新成员',
      roomGuardLevel: 3, giftGuardLevel: tier.guard, guardAction: 'open', giftCount: 1,
      roomMedal: { name: '小铃铛', level: tier.level } })),
    { id: 'sc', kind: 'superchat', name: '留言者', message, price: 50 },
  ]);
  const [viewer, fan] = root.children;
  const sc = root.children.at(-1);
  assert.equal(viewer.dataset.letterKind, 'chat');
  assert.equal(findByClass(viewer, 'xletter-medal'), undefined, 'other-room medals are not presented as this fan club');
  assert.equal(findByClass(viewer, 'xletter-amount'), undefined, 'text and price alone never turn chat into SC');
  assert.match(findByClass(fan, 'xletter-medal').textContent, /12$/);
  assert.match(findByClass(fan, 'xletter-medal').title, /小铃铛/);
  tiers.forEach((tier, index) => {
    const chat = root.children[index + 2];
    const joined = root.children[index + 5];
    assert.equal(findByClass(chat, 'xletter-guard-label').textContent, `${tier.label} ${tier.level}`);
    assert.equal(findByClass(joined, 'xletter-guard-label').textContent, `${tier.label} ${tier.level}`);
    assert.equal(joined.dataset.letterTier, tier.role, 'purchased tier selects the scene even when room identity is stale');
  });
  assert.equal(sc.classList.contains('is-superchat'), true);
  assert.equal(findByClass(sc, 'sc-copy').textContent, message, 'the SC module retains the complete original text');
  feed.destroy();
});

test('supported random SC styles retain snapshots, increments, removal and timed expiry', async () => {
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document: createFakeDocument() });
  for (const style of ['mist', 'comic', 'stardust', 'sea-breeze-random', 'glass-bubble', 'outline']) {
    const root = new FakeNode('div');
    const timers = new Map();
    let nextTimer = 0;
    const feed = module.createDanmakuFeed(root, {
      style, layout: 'fullscreen-random', itemLifetimeMs: 6000, now: () => 1000, autoScroll: false,
      scheduleTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback() { timers.delete(id); callback(); }, delay });
        return id;
      },
      cancelTimeout(id) { timers.delete(id); },
    });
    const sc = { id: 'sc', kind: 'superchat', price: 30, message: '留言', timestamp: 1000 };
    feed.render([{ id: 'chat', name: '观众', message: '弹幕', timestamp: 1000 }, sc]);
    const chat = root.children[0];
    assert.equal(root.children.length, style === 'outline' ? 1 : 2);
    feed.append({ ...sc, id: 'second' });
    assert.equal(root.children.length, style === 'outline' ? 1 : 3);
    feed.remove(['sc']);
    assert.equal(root.children.length, style === 'outline' ? 1 : 2);
    assert.equal(root.children[0], chat);
    assert.equal([...timers.values()][0].delay, 6000);
    assert.ok([...timers.values()].slice(1).every(timer => timer.delay === (style === 'glass-bubble' ? 9000 : 6000)));
    for (const { callback } of [...timers.values()]) callback();
    assert.equal(root.children.length, 0);
    feed.destroy();
    assert.equal(timers.size, 0);
  }
});

test('stardust gift and membership anchors place cards at opposite centered edges and can swap', async () => {
  const root = Object.assign(new FakeNode('div'), { clientWidth: 1000, clientHeight: 800 });
  const document = createFakeDocument();
  document.body = { dataset: {} };
  document.createElement = tag => Object.assign(new FakeNode(tag), {
    offsetWidth: tag === 'article' ? 120 : 0,
    offsetHeight: tag === 'article' ? 42 : 0,
  });
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document });
  const feed = module.createDanmakuFeed(root, {
    style: 'stardust', layout: 'fullscreen-random', expireItems: false, autoScroll: false,
  });
  for (const swapped of [false, true]) {
    document.body.dataset.stardustSwapAnchors = swapped ? 'on' : 'off';
    feed.render([
      { id: 'gift', kind: 'gift', name: '赠送者', giftName: '花', giftCount: 1, giftTotalPrice: 10 },
      { id: 'member', kind: 'gift', name: '守护者', giftGuardLevel: 3, giftCount: 1 },
    ]);
    assert.equal(root.children.length, 2);
    const [gift, member] = root.children;
    for (const card of root.children) {
      assert.ok(Math.abs(Number.parseFloat(card.style.left) + card.offsetWidth / 2 - root.clientWidth / 2) < 1,
        'highlighted events remain horizontally centered');
    }
    assert.equal(Number.parseFloat(gift.style.top) < root.clientHeight / 2, !swapped);
    assert.equal(Number.parseFloat(member.style.top) < root.clientHeight / 2, swapped);
  }
  feed.destroy();
});

test('harbor gift minimum filters snapshots and increments by total and never filters SC', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'harbor', minGiftAmount: 10, autoScroll: false });
  const small = { id: 'small', kind: 'gift', giftName: '花', giftCount: 100, giftTotalPrice: 9.99 };
  const boundary = { ...small, id: 'boundary', giftCount: 1, giftTotalPrice: 10 };
  feed.render([small, boundary, { id: 'sc', kind: 'superchat', price: 2, message: '保留' }]);
  assert.equal(root.children.length, 2);
  feed.append(small);
  feed.append({ ...small, giftTotalPrice: undefined });
  assert.equal(root.children.length, 2);
  feed.append({ ...boundary, id: 'guard', giftGuardLevel: 3, giftTotalPrice: 168 });
  assert.equal(root.children.length, 3);
  feed.destroy();
  const unfiltered = module.createDanmakuFeed(root, { style: 'harbor', minGiftAmount: 0, autoScroll: false });
  unfiltered.render([small, { ...small, giftTotalPrice: undefined }]);
  assert.equal(root.children.length, 2);
  unfiltered.destroy();
});

test('fixed feed removes selected SC nodes without rebuilding retained messages', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { autoScroll: false });
  feed.render([
    { id: 'chat', message: '聊天' },
    { id: 'sc', kind: 'superchat', message: '撤下', price: 30 },
    { id: 'kept-sc', kind: 'superchat', message: '保留', price: 50 },
  ]);
  const [chat, deleted, kept] = root.children;
  feed.remove(['sc', 'unknown']);
  assert.deepEqual(root.children, [chat, kept]);
  assert.equal(deleted.parent, null);
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, kept]);
  feed.append({ id: 'next', message: '后续消息' });
  assert.equal(root.children[0], chat);
  assert.equal(root.children[1], kept);
  feed.destroy();
});

test('shared danmaku renderer proxies emotes, keeps viewer text literal and shows settled gift totals', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, {
    maxItems: 2,
    autoScroll: false,
    resolveEmoteUrl: (url) => `/proxy?url=${encodeURIComponent(url)}`,
  });

  feed.render([
    {
      name: '观众',
      message: '你好[妙][打call]',
      emotes: [
        {
          text: '[妙]',
          url: 'https://i0.hdslb.com/bfs/emote/miao.png',
          width: 64,
          height: 64,
        },
        {
          text: '[打call]',
          url: 'https://i0.hdslb.com/bfs/emote/call.gif',
          width: 180,
          height: 90,
        },
      ],
    },
  ]);

  const message = root.children[0].children[1].children[1];
  assert.equal(message.children[0].textContent, '你好');
  assert.equal(message.children[1].tagName, 'IMG');
  assert.equal(message.children[1].alt, '[妙]');
  assert.match(message.children[1].src, /^\/proxy\?url=/);
  assert.equal(message.children[2].tagName, 'IMG');
  assert.equal(message.children[2].alt, '[打call]');

  const firstBubble = root.children[0];
  feed.append({ name: '第二位', message: '第二条' });
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0], firstBubble, 'incremental append must preserve existing message nodes');
  feed.append({ name: '第三位', message: '第三条' });
  assert.equal(root.children.length, 2);
  assert.notEqual(root.children[0], firstBubble, 'incremental append must trim only the oldest node');

  feed.render([
    {
      message: '[打call]',
      emotes: [{ text: '[打call]', url: 'https://i0.hdslb.com/bfs/emote/call.gif' }],
    },
  ]);
  const emoteMessage = root.children[0].children[1].children[1];
  assert.equal(emoteMessage.children.length, 1);
  const emoteImage = emoteMessage.children[0];
  assert.equal(emoteImage.tagName, 'IMG');
  assert.equal(emoteImage.alt, '[打call]');
  emoteImage.listeners.error();
  assert.notEqual(emoteMessage.children[0], emoteImage);
  assert.equal(emoteMessage.children[0].textContent, '[打call]');

  feed.render([
    {
      kind: 'gift',
      name: '<img src=x onerror=alert(1)>',
      message: '送出 小花花 × 10',
      giftName: '<b>小花花</b>',
      giftCount: 10,
    },
  ]);
  const giftBody = root.children[0].children[1];
  assert.equal(giftBody.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  const giftMessage = giftBody.children[1];
  assert.equal(giftMessage.children[1].children[1].textContent, '<b>小花花</b>');
  assert.equal(giftMessage.children[1].children[1].children.length, 0);
  const transparentRoot = new FakeNode('div');
  const transparentFeed = module.createDanmakuFeed(transparentRoot, { autoScroll: false, showGiftTotal: true });
  for (const [giftTotalPrice, expected] of [
    [12.5, '¥12.5'],
    [0, '¥0'],
    [undefined, '—'],
  ]) {
    transparentFeed.render([
      {
        kind: 'gift',
        name: '观众',
        message: '送出 小花花 × 10',
        giftName: '<b>小花花</b>',
        giftCount: 10,
        giftTotalPrice,
      },
    ]);
    const content = transparentRoot.children[0].children[1].children[1];
    assert.equal(content.children[2].textContent, expected);
  }
});

test('fixed danmaku feed retains partially visible messages and prunes only fully clipped nodes', async () => {
  const root = new FakeNode('div');
  root.clientHeight = 130;
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
    getComputedStyle: (node) => ({ zoom: String(node.zoom || 1) }),
  });
  const feed = module.createDanmakuFeed(root, {
    maxItems: 50,
    offscreenViewports: 0,
    autoScroll: false,
  });

  feed.render([
    { name: '第一位', message: '第一条' },
    { name: '第二位', message: '第二条' },
  ]);
  const firstBubble = root.children[0];
  feed.append({ name: '第三位', message: '第三条' });

  assert.equal(root.children.length, 3, 'the first bubble still has four visible pixels');
  assert.equal(root.children[0], firstBubble);

  root.children[0].offsetHeight = 100;
  root.children[1].offsetHeight = 80;
  feed.append({ name: '第四位', message: '图片加载后高度变大' });
  assert.equal(root.children.length, 3, 'only the fully clipped first bubble is removed after image growth');
  assert.equal(root.children[0].children[1].children[0].children[0].textContent, '第二位');

  root.clientHeight = 150;
  root.children[2].offsetHeight = 80;
  root.children[2].zoom = 1.5;
  feed.append({ name: '第五位', message: '放大卡片占用实际高度' });
  assert.equal(root.children.length, 2, 'the scaled fourth card remains partially visible');
  assert.equal(root.children[0].children[1].children[0].children[0].textContent, '第四位');
  const scaledBubble = root.children[0];
  feed.append({ name: '第六位', message: '仍然保留剩余部分' });
  assert.equal(root.children[0], scaledBubble);
  feed.append({ name: '第七位', message: '完全越界后移除' });
  assert.equal(root.children.length, 3);
  assert.notEqual(root.children[0], scaledBubble);
  feed.destroy();

  const defaultRoot = new FakeNode('div');
  defaultRoot.clientHeight = 100;
  Object.defineProperty(defaultRoot, 'scrollHeight', { get: () => defaultRoot.children.reduce(
    (height, node) => height + (Number.parseFloat(node.style['--danmaku-height']) || 0),
    22 + Math.max(0, defaultRoot.children.length - 1) * 11,
  ) });
  const defaultFeed = module.createDanmakuFeed(defaultRoot);
  defaultFeed.render(Array.from({ length: 30 }, (_, index) => ({ message: `消息 ${index}` })));
  assert.ok(defaultRoot.children.length <= 10, 'the default feed bounds a burst to its visible window');
  assert.equal(defaultRoot.scrollTop, defaultRoot.scrollHeight);
  defaultFeed.destroy();
});
