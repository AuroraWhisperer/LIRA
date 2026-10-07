'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { allNodes, createFakeDocument, findAllByClass, findByClass } = require('../helpers/fake-dom');

const OVERLAYS = path.join(__dirname, '../../public/js/overlays');

async function createRenderer(options) {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import(
    pathToFileURL(path.join(OVERLAYS, 'danmaku-message-renderer.js')).href);
  return createDanmakuMessageRenderer({ document: createFakeDocument(), classNames: DEFAULT_DANMAKU_CLASSES, ...options });
}

const EMOTE_CHAT = { name: '<b>观众</b>', message: '你好[星]', emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };

test('SC uses exact Bilibili tier colors with 2-yuan fallback and validated upstream overrides', async () => {
  const { getSuperChatColors } = await import(pathToFileURL(path.join(OVERLAYS, 'danmaku-superchat-renderer.js')).href);
  for (const [price, surface, accent, label] of [
    [2, '#EDF5FF', '#2A60B2', '#7497CD'],
    [30, '#EDF5FF', '#2A60B2', '#7497CD'],
    [49.99, '#EDF5FF', '#2A60B2', '#7497CD'],
    [50, '#DBFFFD', '#427D9E', '#7DA4BD'],
    [100, '#FFF1C5', '#E2B52B', '#ECCF75'],
    [499, '#FFF1C5', '#E2B52B', '#ECCF75'],
    [500, '#FFEAD2', '#E09443', '#E8AF79'],
    [1000, '#FFE7E4', '#E54D4D', '#EE8B8B'],
    [2000, '#FFD8D8', '#AB1A32', '#C86A7A'],
  ]) {
    assert.deepEqual(getSuperChatColors({ price }), { backgroundColor: surface, accentColor: accent, priceColor: label });
  }
  const colors = { backgroundColor: '#ffeedd', accentColor: '#123456', priceColor: '#abcdef' };
  assert.deepEqual(getSuperChatColors({ price: 2, colors }), {
    backgroundColor: '#FFEEDD', accentColor: '#123456', priceColor: '#ABCDEF',
  });
  for (const invalid of ['red', '#fff', 'url(https://example.com)', '#123456; color:red', '#123456\n', null]) {
    assert.equal(getSuperChatColors({ price: 2, colors: { accentColor: invalid } }).accentColor, '#2A60B2');
  }
  assert.equal(getSuperChatColors({ price: 2, colors: { priceColor: '#ABCDEF' } }).priceColor, '#ABCDEF');
});

test('every SC design preserves full original plain text and owns its optional identity elements', async () => {
  const message = '  <img src=x onerror=alert(1)>\n' + '完整留言，不要截断。'.repeat(70) + '\n  ';
  for (const [style, avatars, value] of [
    ['ranked', 1, '2'], ['bubble', 1, '2'], ['signal', 0, '2'], ['minimal', 0, '2'], ['transparent', 0, '2'],
    ['identity', 1, '2'], ['starlight', 0, '2.00'], ['sketch', 0, '2.00'], ['moonlit', 1, '2'],
  ]) {
    const render = await createRenderer({ style, showAvatar: false, resolveAvatarUrl: (url) => url });
    const root = render({ kind: 'superchat', name: '<b>原名字</b>', message, price: 2 });
    const named = (className) => findAllByClass(root, className);
    assert.equal(named('sc-copy')[0].textContent, message, style);
    assert.equal(named('sc-copy')[0].children.length, 0, style);
    assert.equal(named('sc-avatar').length, avatars, style);
    assert.deepEqual(named('sc-name').map((node) => node.textContent), ['<b>原名字</b>'], style);
    assert.equal(named('sc-money').length, 1, style);
    assert.equal(named('sc-currency')[0].textContent, '¥', style);
    assert.equal(named('sc-value')[0].textContent, value, style);
    assert.equal(root.style['--sc-accent'], '#2A60B2', style);
    assert.equal(named('draw-danmaku-body').length, 0, 'SC must not reuse chat or gift structure');
    assert.equal(named('draw-danmaku-gift').length, 0, style);
    assert.ok(!allNodes(root).some((node) => node.textContent === 'SC' || node.textContent === '谢谢支持'), style);
    assert.ok(!render({ name: '聊天', message: '普通消息' }).className.includes('is-superchat'), style);
    assert.ok(render({ kind: 'gift', name: '送礼人', giftName: '小花花', giftCount: 1 }).className.includes('is-gift'), style);
  }
});

test('SC portrait failure falls back to the name without hiding the original', async () => {
  const render = await createRenderer({ style: 'identity', resolveAvatarUrl: (value) => value });
  const root = render({ kind: 'superchat', price: 30, name: '晚风', message: '原文', avatarUrl: 'https://i0.hdslb.com/avatar.png' });
  const portrait = findByClass(root, 'sc-avatar');
  const image = portrait.children[0];
  assert.equal(image.referrerPolicy, 'no-referrer');
  image.listeners.error();
  assert.equal(portrait.textContent, '晚');
  assert.equal(image.removed, true);
  assert.equal(findByClass(root, 'sc-copy').textContent, '原文');
  const moonlit = (await createRenderer({ style: 'moonlit' }))({ kind: 'superchat', name: '月色', price: 39.9, message: '原文' });
  assert.equal(findByClass(moonlit, 'sc-avatar').textContent, '月', 'moonlit SC keeps a name fallback portrait');
  assert.equal(findByClass(moonlit, 'sc-value').textContent, '39.9');
});

test('avatar backdrops follow each successfully loaded, resolved image independently', async () => {
  const render = await createRenderer({
    resolveAvatarUrl: (source) => (source === 'rejected' ? '' : `/avatar?url=${encodeURIComponent(source)}`),
  });
  const first = render({ name: '晚风', message: '浅色头像', avatarUrl: 'light.webp' });
  const second = render({ name: '夜色', message: '深色头像', avatarUrl: 'dark.webp' });
  assert.equal(first.children[0].children[0].referrerPolicy, 'no-referrer');
  assert.equal(first.children[0].children[0].decoding, 'async');
  assert.equal(first.style['--danmaku-avatar-image'], undefined);
  second.children[0].children[0].listeners.load();
  first.children[0].children[0].listeners.load();
  assert.equal(first.style['--danmaku-avatar-image'], 'url("/avatar?url=light.webp")');
  assert.equal(second.style['--danmaku-avatar-image'], 'url("/avatar?url=dark.webp")');

  const failed = render({ name: '失效', avatarUrl: 'missing.webp' });
  const failedImage = failed.children[0].children[0];
  failedImage.listeners.error();
  assert.equal(failedImage.removed, true);
  assert.equal(failed.children[0].textContent, '失');
  assert.equal(failed.style['--danmaku-avatar-image'], undefined);
  assert.equal(render({ avatarUrl: 'rejected' }).children[0].children.length, 0);
});

test('chat keeps viewer text as text, renders inline emotes and omits hidden or random-layout avatars', async () => {
  for (const [style, options] of [
    ['sketch', { showAvatar: false }], ['starlight', { showAvatar: false }], ['moonlit', {}],
    ['whiteframe', { fullscreen: true }], ['starveil', { fullscreen: true }],
  ]) {
    const render = await createRenderer({ style, resolveAvatarUrl: (url) => url, ...options });
    const chat = render(EMOTE_CHAT);
    assert.equal(findByClass(chat, 'draw-danmaku-identity').children[0].textContent, '<b>观众</b>', style);
    assert.equal(findByClass(chat, 'draw-danmaku-text').textContent, '你好', style);
    assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/star.png', style);
    if (style !== 'moonlit') assert.equal(findByClass(chat, 'draw-danmaku-avatar'), undefined, style);
  }
});

test('gift notices keep name and count separate from the settled total in each style format', async () => {
  for (const [style, giftCount, countText, amounts] of [
    ['sketch', 3, '× 3', [[138.5, '138.50¥'], [0, '0.00¥'], [undefined, '—']]],
    ['starlight', 10, 'x10', [[12450.5, '¥12,450.5'], [undefined, '—']]],
    ['whiteframe', 10, '× 10', [[138, '138¥'], [13.25, '13.25¥'], [0, '0¥'], [undefined, '—']]],
    ['moonlit', 3, '× 3', [[1.2, '¥1.2']]],
  ]) {
    const render = await createRenderer({ style, showAvatar: false, showGiftTotal: true, fullscreen: style === 'whiteframe' });
    for (const [giftTotalPrice, expected] of amounts) {
      const gift = render({ kind: 'gift', name: '<img onerror=alert(1)>', giftName: '<b>礼物</b>', giftCount, giftTotalPrice });
      const name = findByClass(gift, 'draw-danmaku-gift-name');
      assert.equal(name.textContent, '<b>礼物</b>', style);
      assert.equal(name.children.length, 0, style);
      assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, countText, style);
      assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, expected,
        `${style}: the settled total is not multiplied by the gift count`);
      assert.ok(allNodes(gift).some((node) => node.textContent === '<img onerror=alert(1)>'), style);
    }
  }
});

test('whiteframe shows only the sender name and keeps the amount outside the framed gift copy', async () => {
  const render = await createRenderer({ style: 'whiteframe', fullscreen: true, showGiftTotal: true });
  const item = render({ kind: 'gift', name: '老板', giftName: '心动盲盒', giftCount: 10, giftTotalPrice: 138 });
  assert.equal(item.children.length, 1, 'random messages have no avatar');
  const [identity, gift] = item.children[0].children;
  assert.equal(identity.children.length, 1, 'only the sender name is shown');
  const [, copy, amount] = gift.children;
  assert.ok(!copy.children.includes(amount));
  assert.equal(amount.textContent, '138¥');
});

test('sketch marks membership frames only for current-room guard levels and hides ornaments from assistive tech', async () => {
  const render = await createRenderer({ style: 'sketch', showAvatar: false });
  const item = { id: 'a', ...EMOTE_CHAT };
  const chat = render(item);
  assert.equal(findByClass(chat, 'sketch-ornaments').attributes['aria-hidden'], 'true');
  assert.equal(chat.dataset.sketchVariant, '0');
  for (const guardLevel of [1, 2, 3, '3']) assert.equal(render({ ...item, guardLevel }, 20).dataset.sketchVariant, '1');
  for (const extra of [{ guardLevel: 0 }, { guardLevel: 4 }, { medalName: '粉丝牌' }, { isStreamer: true }, { id: 'b', message: '另一条弹幕' }]) {
    assert.equal(render({ ...item, ...extra }, 20).dataset.sketchVariant, '0');
  }
});

test('starveil colors vary per message and survive reordering and identity changes', async () => {
  const render = await createRenderer({ style: 'starveil', fullscreen: true });
  const item = { id: 'one', timestamp: 1000, name: '晚风', message: '你好，今晚的烟花很好看' };
  const palette = render(item, 0).dataset.palette;
  assert.equal(render({ ...item, guardLevel: 1, isStreamer: true }, 50).dataset.palette, palette);
  const palettes = new Set(Array.from({ length: 60 }, (_, id) => render({ ...item, id }).dataset.palette));
  assert.ok(palettes.size > 1, 'different messages receive different palettes');
  const glow = await createRenderer({ style: 'glow', fullscreen: true });
  assert.equal(glow(item).dataset.palette, undefined);
});

test('moonlit chat shows a labelled rank icon only for guards', async () => {
  const render = await createRenderer({ style: 'moonlit',
    getGuardLabel: (level) => ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || '' });
  for (const [guardLevel, identity] of [[0, 'viewer'], [3, 'captain'], [2, 'admiral'], [1, 'governor']]) {
    const root = render({ ...EMOTE_CHAT, guardLevel });
    assert.equal(root.dataset.identity, identity);
    assert.equal(Boolean(root.querySelector('.moonlit-guard-icon')), guardLevel > 0);
  }
});

test('moonlit purchased ranks use the separate guard scene with an accessible title and avatar fallback', async () => {
  const render = await createRenderer({ style: 'moonlit', showGiftTotal: true,
    getGuardLabel: (level) => ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || '',
    resolveAvatarUrl: (value) => (value === 'rejected' ? '' : value) });
  const ordinary = { kind: 'gift', name: '晚风', giftName: '小花花', giftCount: 3, giftTotalPrice: 1.2, guardLevel: 3 };
  const gift = render(ordinary);
  assert.equal(gift.querySelector('.draw-danmaku-avatar').textContent, '晚');
  assert.equal(gift.querySelector('.moonlit-guard-title'), undefined);
  for (const [giftGuardLevel, title] of [[3, '舰长'], [2, '提督'], [1, '总督']]) {
    const root = render({ ...ordinary, giftGuardLevel, avatarUrl: 'rejected' });
    assert.equal(root.querySelector('.moonlit-guard-title').children.map((node) => node.textContent).join(''), title);
    assert.equal(root.querySelector('.moonlit-guard-icon')['aria-label'], title);
    assert.equal(root.querySelector('.moonlit-guard-name').textContent, '晚风');
    assert.equal(root.querySelector('.draw-danmaku-avatar').textContent, '晚');
    assert.equal(root.querySelector('.draw-danmaku-gift'), undefined);
  }
});
