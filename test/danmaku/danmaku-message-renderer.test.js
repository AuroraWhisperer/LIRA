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

test('sinking keeps native safe text and emotes, and complete settled event content', async () => {
  const render = await createRenderer({ style: 'sinking', fullscreen: true, showAvatar: false,
    resolveEmoteUrl: value => `/emote${value}` });
  const chat = render({ name: '<b>观众</b>', message: '晚安[星]', emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] });
  assert.equal(findByClass(chat, 'draw-danmaku-identity').children[0].textContent, '<b>观众</b>');
  assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/emote/star.png');
  const gift = render({ kind: 'gift', giftName: '<花>', giftCount: 5, giftTotalPrice: 12.5 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<花>');
  assert.equal(findByClass(gift, 'sinking-amount').textContent, '¥12.5');
  const member = render({ kind: 'gift', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 });
  assert.equal(findByClass(member, 'draw-danmaku-gift-action').textContent, '续费');
  const message = '  第一行\n<script>完整留言</script>  ';
  const sc = render({ kind: 'superchat', message, price: 30 });
  assert.equal(findByClass(sc, 'sinking-message').textContent, message);
  assert.equal(findByClass(sc, 'sinking-message').children.length, 0);
  assert.equal(findByClass(sc, 'sinking-amount').textContent, '¥30');
});

test('window recomposes safe sender, avatar and emotes using room identity', async () => {
  const render = await createRenderer({ style: 'window', fullscreen: true, showAvatar: true,
    resolveAvatarUrl: value => `/avatar${value}`, resolveEmoteUrl: value => `/emote${value}` });
  const item = { name: '<b>原昵称</b>', avatarUrl: '/real.png', message: '你好[星]', guardLevel: 1, roomGuardLevel: 0,
    emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };
  const root = render(item);
  assert.equal(findByClass(root, 'window-nameplate').children[1].textContent, item.name);
  assert.equal(findByClass(root, 'draw-danmaku-avatar').children[0].src, '/avatar/real.png');
  assert.equal(findByClass(root, 'draw-danmaku-emote').src, '/emote/star.png');
  assert.equal(findByClass(root, 'window-role'), undefined, 'other-room guard is not a room badge');
  assert.equal(findByClass(render({ ...item, roomGuardLevel: 3 }), 'window-role').textContent, '舰长');
});

test('window retains settled gift totals, actual membership action and literal complete SC', async () => {
  const render = await createRenderer({ style: 'window', fullscreen: true });
  const gift = render({ kind: 'gift', giftName: '<花>', giftCount: 10, giftTotalPrice: 12.5 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<花>');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, '× 10');
  assert.equal(findByClass(gift, 'window-amount').textContent, '¥12.50');
  const member = render({ kind: 'gift', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 });
  assert.equal(findByClass(member, 'draw-danmaku-gift-action').textContent, '续费');
  assert.equal(findByClass(member, 'window-amount').textContent, '—');
  const message = '  第一行\n<script>保留完整留言</script>  ';
  const sc = render({ kind: 'superchat', message, price: 30 });
  assert.equal(findByClass(sc, 'window-copy').textContent, message);
  assert.equal(findByClass(sc, 'window-copy').children.length, 0);
  assert.equal(findByClass(sc, 'window-amount').textContent, '¥30.00');
});

test('comic preserves safe chat content and room identity with a stable silhouette', async () => {
  const render = await createRenderer({ style: 'comic', fullscreen: true, showAvatar: true,
    resolveAvatarUrl: value => `/avatar${value}`, resolveEmoteUrl: value => `/emote${value}` });
  const item = { id: 'same-message', name: '<b>观众</b>', message: '你好[星]', avatarUrl: '/real.png',
    guardLevel: 1, roomGuardLevel: 0, emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };
  const root = render(item, 0);
  assert.equal(findByClass(root, 'comic-name').textContent, item.name);
  assert.equal(findByClass(root, 'draw-danmaku-emote').src, '/emote/star.png');
  assert.equal(findByClass(root, 'comic-avatar').children[0].src, '/avatar/real.png');
  assert.equal(findByClass(root, 'comic-role'), undefined, 'other-room rank does not become a room badge');
  assert.equal(root.dataset.comicShape, render(item, 99).dataset.comicShape, 'rebuilding does not shuffle the same message');
  const member = render({ ...item, roomGuardLevel: 3 });
  assert.equal(findByClass(member, 'comic-role').textContent, '舰长');
});

test('comic uses settled gift totals and preserves complete literal SC', async () => {
  const render = await createRenderer({ style: 'comic', fullscreen: true, showGiftTotal: true });
  const gift = render({ kind: 'gift', giftName: '<花>', giftCount: 10, giftTotalPrice: 12.5 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<花>');
  assert.equal(findByClass(gift, 'comic-amount').textContent, '¥12.50');
  const member = render({ kind: 'gift', giftGuardLevel: 2, giftCount: 1 });
  assert.equal(findByClass(member, 'draw-danmaku-gift-name').textContent, '提督');
  assert.equal(findByClass(member, 'draw-danmaku-gift-action').textContent, '支持 ');
  assert.equal(findByClass(member, 'comic-amount').textContent, '—');
  const text = '  第一行\n<script>第二行</script>  ';
  const sc = render({ kind: 'superchat', message: text, price: 30 });
  assert.equal(findByClass(sc, 'comic-copy').textContent, text);
  assert.equal(findByClass(sc, 'comic-copy').children.length, 0);
  assert.equal(findByClass(sc, 'comic-amount').textContent, '¥30.00');
});

test('notebook keeps viewer names literal and resolves avatars and emotes', async () => {
  const render = await createRenderer({ style: 'notebook',
    resolveAvatarUrl: value => `/avatar${value}`,
    resolveEmoteUrl: value => `/emote${value}` });
  const item = { name: '<b>观众</b>', message: '你好[星]', avatarUrl: '/real.png',
    emotes: [{ text: '[星]', url: '/bilibili.png', kind: 'inline' }] };
  const root = render(item);
  assert.equal(findByClass(root, 'notebook-name').textContent, item.name);
  assert.equal(findByClass(root, 'draw-danmaku-emote').src, '/emote/bilibili.png');
  assert.equal(findByClass(root, 'notebook-avatar').children[0].src, '/avatar/real.png');
});

test('notebook keeps gift names literal and shows the settled total', async () => {
  const render = await createRenderer({ style: 'notebook', showGiftTotal: true });
  const gift = render({ kind: 'gift', name: '送礼者', giftName: '<img>小花', giftCount: 5, giftTotalPrice: 9.9 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<img>小花');
  assert.equal(findByClass(gift, 'notebook-amount').textContent, 'CN¥9.9');
});

test('notebook SC keeps literal full content, sender and amount', async () => {
  const render = await createRenderer({ style: 'notebook' });
  const message = '<script>完整留言</script>\n'.repeat(12);
  const root = render({ kind: 'superchat', name: '<b>留言者</b>', message, price: 120.5 });
  assert.equal(findByClass(root, 'notebook-name').textContent, '<b>留言者</b>');
  assert.equal(findByClass(root, 'notebook-copy').textContent, message);
  assert.equal(findByClass(root, 'notebook-copy').children.length, 0);
  assert.equal(findByClass(root, 'notebook-amount').textContent, 'CN¥120.5');
});

test('flower-letter keeps viewer names literal and resolves avatars', async () => {
  const render = await createRenderer({ style: 'flower-letter', resolveAvatarUrl: value => `/resolved${value}` });
  const item = { name: '<b>真实昵称</b>', message: '晚安', avatarUrl: '/avatar.png', roomGuardLevel: 3 };
  const letter = render(item);
  assert.equal(findByClass(letter, 'flower-nickname').textContent, item.name);
  assert.equal(findByClass(letter, 'flower-avatar-image').src, '/resolved/avatar.png');
});

test('flower-letter keeps gift and SC content literal with settled amounts', async () => {
  const render = await createRenderer({ style: 'flower-letter' });
  const gift = render({ kind: 'gift', name: '送礼者', giftName: '<img>小花', giftCount: 10, giftTotalPrice: 12.5 });
  assert.equal(findByClass(gift, 'flower-gift-name').textContent, '<img>小花');
  assert.equal(findByClass(gift, 'flower-price').textContent, 'CN¥12.5');
  const sc = render({ kind: 'superchat', name: '留言者', price: 1000, message: '第一行\n<b>第二行</b>' });
  assert.equal(findByClass(sc, 'flower-copy').textContent, '第一行\n<b>第二行</b>');
  assert.equal(findByClass(sc, 'flower-price').textContent, 'CN¥1,000');
});

test('spooky keeps viewer names literal', async () => {
  const render = await createRenderer({ style: 'spooky' });
  const item = { name: '<b>访客</b>', message: '晚安' };
  assert.equal(findByClass(render(item), 'spooky-name').textContent, item.name);
});

test('spooky gifts keep the gift name literal and resolve avatars', async () => {
  const render = await createRenderer({ style: 'spooky', showGiftTotal: true, resolveAvatarUrl: value => `/resolved${value}` });
  const gift = render({ kind: 'gift', name: '礼物观众', avatarUrl: '/avatar.png', giftName: '<img>小花花', giftCount: 10, giftTotalPrice: 50 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<img>小花花');
  assert.equal(findByClass(gift, 'spooky-avatar').src, '/resolved/avatar.png');
});

test('spooky SC preserves literal content, sender and price', async () => {
  const render = await createRenderer({ style: 'spooky' });
  const message = '<script>留言</script>\n'.repeat(20);
  const root = render({ kind: 'superchat', name: '<b>留言者</b>', price: 120.5, message });
  const copy = findByClass(root, 'spooky-sc-copy');
  assert.equal(copy.textContent, message);
  assert.equal(copy.children.length, 0);
  assert.equal(findByClass(root, 'spooky-event-name').textContent, '<b>留言者</b>');
  assert.match(findByClass(root, 'spooky-event-copy').textContent, /¥120\.5/);
});

test('aurora preserves one sender and the settled gift total with the actual membership action', async () => {
  const render = await createRenderer({ style: 'aurora', fullscreen: true, showAvatar: false });
  const gift = render({ kind: 'gift', name: '送礼者', giftName: '<b>星愿</b>', giftCount: 5, giftTotalPrice: 12.5 });
  assert.equal(findAllByClass(gift, 'draw-danmaku-identity').length, 1);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<b>星愿</b>');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, '¥12.5');
  const renew = render({ kind: 'gift', name: '续订者', giftName: '舰长', giftGuardLevel: 3, guardAction: 'renew', giftCount: 1 });
  assert.equal(findByClass(renew, 'draw-danmaku-gift-action').textContent, '续费');
  assert.equal(findByClass(renew, 'draw-danmaku-gift-amount').textContent, '—');
});

test('floating gifts render a complete feeding sentence as safe text', async () => {
  const render = await createRenderer({ style: 'floating', fullscreen: true, showAvatar: false });
  const gift = { name: '<b>送礼人</b>', giftName: '<img>小花花', giftCount: 10 };
  const root = render({ ...gift, kind: 'gift', message: '旧的礼物通知' });
  const body = findByClass(root, 'draw-danmaku-body');
  assert.equal(body.children[0].children[0].textContent, gift.name);
  assert.equal(body.children[1].textContent, `${gift.name}投喂了${gift.giftName}×${gift.giftCount}`);
  assert.equal(body.children[1].children.length, 0, 'names and gifts are literal text');
});

test('mist guard cards keep the purchaser name literal with the settled amount', async () => {
  const render = await createRenderer({ style: 'mist', fullscreen: true, showAvatar: true });
  const guard = render({ kind: 'gift', name: '<b>送礼人</b>', giftGuardLevel: 3, giftCount: 1, giftTotalPrice: 0.5 });
  assert.equal(findByClass(guard, 'mist-guard-name').textContent, '<b>送礼人</b>');
  assert.equal(findByClass(guard, 'mist-guard-amount').textContent, '¥0.5');
});

test('harbor guard cards keep the purchaser name literal with the settled amount', async () => {
  const render = await createRenderer({ style: 'harbor' });
  const gift = { kind: 'gift', name: '<img>观众', giftGuardLevel: 3, giftTotalPrice: 168 };
  const root = render(gift);
  assert.equal(findByClass(root, 'harbor-guard-name').textContent, gift.name);
  assert.equal(findByClass(root, 'harbor-guard-amount').textContent, 'CN¥168');
});

const EMOTE_CHAT = { name: '<b>观众</b>', message: '你好[星]', emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };

test('snowfox gift and membership cards keep the settled amount and purchaser name', async () => {
  const render = await createRenderer({ style: 'snowfox' });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '星尘烟花', giftCount: 3, giftTotalPrice: 9 };
  assert.equal(findByClass(render(item), 'draw-danmaku-gift-amount').textContent, 'CN¥9');
  assert.equal(findByClass(render({ ...item, giftGuardLevel: 3 }), 'snowfox-member-name').textContent, item.name);
});

test('RIPPLOID keeps chat usernames literal', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const root = render({ ...EMOTE_CHAT, roomMedal: { name: 'BCBCB', level: 22 }, roomGuardLevel: 1 });
  assert.equal(findByClass(root, 'ripploid-username-base').textContent, EMOTE_CHAT.name);
  assert.equal(findByClass(root, 'ripploid-username-base').children.length, 0);
});

test('RIPPLOID gift tickets keep sender and gift literal with the settled total', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '<img>友谊的大船', giftCount: 510, giftTotalPrice: 2992 };
  const gift = render(item);
  assert.equal(findByClass(gift, 'ripploid-gift-name').textContent, item.giftName);
  assert.equal(findByClass(gift, 'ripploid-gift-name').children.length, 0);
  assert.equal(findByClass(gift, 'ripploid-gift-price-value').textContent, '2,992');
  assert.equal(findByClass(gift, 'ripploid-ticket-signature').textContent, item.name);
});

test('RIPPLOID system and entry messages keep their text literal', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  for (const kind of ['system', 'entry']) {
    const root = render({ kind, name: '<b>观众</b>', message: '<script>原始通知</script>', roomGuardLevel: 1 });
    const copy = findByClass(root, 'ripploid-system-copy');
    assert.equal(copy.children[1].textContent, '<script>原始通知</script>');
    assert.equal(copy.children[1].children.length, 0);
    const label = findByClass(root, 'ripploid-system-label');
    assert.equal(label.children.length, 0);
    if (kind === 'entry') assert.ok(label.textContent.includes('<b>观众</b>'));
  }
});

test('RIPPLOID memberships keep the member name literal and resolve the avatar', async () => {
  const render = await createRenderer({ style: 'ripploid', resolveAvatarUrl: (value) => `/resolved${value}` });
  const root = render({ kind: 'gift', name: '<b>新会员</b>', giftGuardLevel: 3, giftName: '舰长',
    avatarUrl: '/avatar.png', giftTotalPrice: 138 });
  assert.equal(findByClass(root, 'ripploid-member-name').textContent, '<b>新会员</b>');
  const image = findByClass(root, 'ripploid-member-avatar').children[0];
  assert.equal(image.src, '/resolved/avatar.png');
  assert.equal(image.referrerPolicy, 'no-referrer');
});

test('RIPPLOID SC keeps the exact original, sender and amount', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const message = '  <img src=x>\n完整留言\n  ';
  const root = render({ kind: 'superchat', name: '<b>留言人</b>', message, price: 100.5 });
  assert.equal(findByClass(root, 'sc-copy').textContent, message);
  assert.equal(findByClass(root, 'sc-copy').children.length, 0);
  assert.equal(findByClass(root, 'sc-name').textContent, '<b>留言人</b>');
  assert.equal(findByClass(root, 'sc-value').textContent, '100.5');
});

test('Twitter chat keeps viewer names literal', async () => {
  const render = await createRenderer({ style: 'twitter' });
  const root = render({ ...EMOTE_CHAT, roomGuardLevel: 1 });
  assert.equal(findByClass(root, 'twitter-name').textContent, EMOTE_CHAT.name);
  assert.equal(findByClass(root, 'twitter-name').children.length, 0);
});

test('Twitter gifts keep the gift name literal and the settled total', async () => {
  const render = await createRenderer({ style: 'twitter', showGiftTotal: true });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '<img>小花花', giftCount: 3, giftTotalPrice: 12.5 };
  const gift = render(item);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, item.giftName);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, '¥12.5');
});

test('Twitter SC keeps its exact message, amount and resolved avatar', async () => {
  const render = await createRenderer({ style: 'twitter', resolveAvatarUrl: (value) => `/resolved${value}` });
  const message = '  <img src=x>\n完整留言\n  ';
  const root = render({ kind: 'superchat', name: '<b>留言人</b>', message, price: 30.5, avatarUrl: '/sc.png' });
  assert.equal(findByClass(root, 'sc-copy').textContent, message);
  assert.equal(findByClass(root, 'sc-copy').children.length, 0);
  assert.equal(findByClass(root, 'sc-value').textContent, '30.5');
  assert.equal(findByClass(root, 'twitter-avatar-image').children[0].src, '/resolved/sc.png');
});

test('prismatic applies only valid room medal colors', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  const item = { id: '1', name: '<b>名字</b>', message: '你好', roomGuardLevel: 3,
    roomMedal: { name: '葵绮士', level: 38, guardLevel: 3, isLight: true,
      colorStart: '#4C7DFF99', colorEnd: '#4C7DFF99', colorBorder: '#58A1F8', colorText: '#FFFFFF' } };
  assert.equal(findByClass(render(item), 'prismatic-medal').style['--medal-start'], '#4C7DFF99');
  const invalid = render({ ...item, roomMedal: { ...item.roomMedal, colorStart: 'url(javascript:alert(1))' } });
  assert.equal(findByClass(invalid, 'prismatic-medal').style['--medal-start'], undefined);
});

test('prismatic guard thanks keeps the purchaser name literal and the settled total', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  const root = render({ kind: 'gift', giftGuardLevel: 3, guardAction: 'open', name: '<b>送礼人</b>',
    giftCount: 3, giftTotalPrice: 19998.5 });
  assert.equal(findByClass(root, 'prismatic-guard-name').textContent, '<b>送礼人</b>');
  assert.equal(findByClass(root, 'prismatic-guard-amount').textContent, '19,998.5');
});

test('SC accepts only six-digit upstream color overrides', async () => {
  const { getSuperChatColors } = await import(pathToFileURL(path.join(OVERLAYS, 'danmaku-superchat-renderer.js')).href);
  const colors = { backgroundColor: '#ffeedd', accentColor: '#123456', priceColor: '#abcdef' };
  assert.deepEqual(getSuperChatColors({ price: 2, colors }), {
    backgroundColor: '#FFEEDD', accentColor: '#123456', priceColor: '#ABCDEF',
  });
  const fallback = getSuperChatColors({ price: 2 }).accentColor;
  for (const invalid of ['red', '#fff', 'url(https://example.com)', '#123456; color:red', '#123456\n', null]) {
    assert.equal(getSuperChatColors({ price: 2, colors: { accentColor: invalid } }).accentColor, fallback);
  }
});

test('every SC design preserves full original plain text, sender and amount', async () => {
  const message = '  <img src=x onerror=alert(1)>\n' + '完整留言，不要截断。'.repeat(70) + '\n  ';
  for (const [style, value] of [
    ['ranked', '2'], ['bubble', '2'], ['signal', '2'], ['minimal', '2'], ['transparent', '2'],
    ['identity', '2'], ['starlight', '2.00'], ['sketch', '2.00'], ['moonlit', '2'],
  ]) {
    const render = await createRenderer({ style, showAvatar: false, resolveAvatarUrl: (url) => url });
    const root = render({ kind: 'superchat', name: '<b>原名字</b>', message, price: 2 });
    const named = (className) => findAllByClass(root, className);
    assert.equal(named('sc-copy')[0].textContent, message, style);
    assert.equal(named('sc-copy')[0].children.length, 0, style);
    assert.deepEqual(named('sc-name').map((node) => node.textContent), ['<b>原名字</b>'], style);
    assert.equal(named('sc-value')[0].textContent, value, style);
  }
});

test('avatars load only resolver-approved URLs without a referrer', async () => {
  const render = await createRenderer({
    resolveAvatarUrl: (source) => (source === 'rejected' ? '' : `/avatar?url=${encodeURIComponent(source)}`),
  });
  const image = render({ name: '晚风', message: '浅色头像', avatarUrl: 'light.webp' }).children[0].children[0];
  assert.equal(image.src, '/avatar?url=light.webp');
  assert.equal(image.referrerPolicy, 'no-referrer');
  assert.equal(render({ avatarUrl: 'rejected' }).children[0].children.length, 0);
});

test('chat keeps viewer text as text and renders inline emotes', async () => {
  for (const [style, options] of [
    ['sketch', { showAvatar: false }], ['starlight', { showAvatar: false }], ['moonlit', {}],
    ['whiteframe', { fullscreen: true }], ['starveil', { fullscreen: true }],
    ['startrail', { fullscreen: true, showAvatar: false }],
  ]) {
    const render = await createRenderer({ style, resolveAvatarUrl: (url) => url, ...options });
    const chat = render(EMOTE_CHAT);
    assert.equal(findByClass(chat, 'draw-danmaku-identity').children[0].textContent, '<b>观众</b>', style);
    assert.equal(findByClass(chat, 'draw-danmaku-text').textContent, '你好', style);
    assert.equal(findByClass(chat, 'draw-danmaku-emote').src, '/star.png', style);
  }
});

test('gift notices keep name and count separate from the settled total in each style format', async () => {
  for (const [style, giftCount, countText, giftTotalPrice, expected] of [
    ['sketch', 3, '× 3', 138.5, '138.50¥'],
    ['starlight', 10, 'x10', 12450.5, '¥12,450.5'],
    ['whiteframe', 10, '× 10', 13.25, '13.25¥'],
    ['moonlit', 3, '× 3', 1.2, '¥1.2'],
  ]) {
    const render = await createRenderer({ style, showAvatar: false, showGiftTotal: true, fullscreen: style === 'whiteframe' });
    const gift = render({ kind: 'gift', name: '<img onerror=alert(1)>', giftName: '<b>礼物</b>', giftCount, giftTotalPrice });
    const name = findByClass(gift, 'draw-danmaku-gift-name');
    assert.equal(name.textContent, '<b>礼物</b>', style);
    assert.equal(name.children.length, 0, style);
    assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, countText, style);
    assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, expected,
      `${style}: the settled total is not multiplied by the gift count`);
    assert.ok(allNodes(gift).some((node) => node.textContent === '<img onerror=alert(1)>'), style);
  }
});
