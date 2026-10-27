'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { allNodes, createFakeDocument, findAllByClass, findByClass } = require('../helpers/fake-dom');

const OVERLAYS = path.join(__dirname, '../../public/js/overlays');

test('desktop adapter retains staggered entrance and undecorated system messages', async () => {
  const render = await createRenderer();
  const item = { kind: 'system', name: 'LIRA', message: '已连接' };
  const message = render(item, 6);
  assert.doesNotMatch(message.className, /(?:^| )is-system(?: |$)/);
  assert.equal(message.style['--danmaku-delay'], '144ms');
  assert.equal(render(item, 30).style['--danmaku-delay'], '192ms');
});

async function createRenderer(options) {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import(
    pathToFileURL(path.join(OVERLAYS, 'danmaku-message-renderer.js')).href);
  return createDanmakuMessageRenderer({ document: createFakeDocument(), classNames: DEFAULT_DANMAKU_CLASSES, ...options });
}

test('notebook keeps real avatars, safe Bilibili emotes and current-room identity', async () => {
  let avatarResolutions = 0;
  const render = await createRenderer({ style: 'notebook',
    resolveAvatarUrl: value => { avatarResolutions++; return `/avatar${value}`; },
    resolveEmoteUrl: value => `/emote${value}` });
  const item = { name: '<b>观众</b>', message: '你好[星]', avatarUrl: '/real.png',
    guardLevel: 1, roomGuardLevel: 0, medalName: '其他房间', medalLevel: 50, roomMedal: { name: '粉丝牌', level: 12 },
    emotes: [{ text: '[星]', url: '/bilibili.png', kind: 'inline' }] };
  const root = render(item);
  assert.equal(root.dataset.notebookRole, 'ordinary');
  assert.equal(findByClass(root, 'notebook-name').textContent, item.name);
  assert.equal(findAllByClass(root, 'notebook-guard').length, 0);
  assert.equal(findByClass(root, 'draw-danmaku-emote').src, '/emote/bilibili.png');
  assert.equal(findByClass(root, 'notebook-avatar').children[0].src, '/avatar/real.png');
  assert.equal(avatarResolutions, 1);
  assert.equal(findByClass(root, 'draw-danmaku-medal-level').textContent, '12');
  const foreign = render({ ...item, roomGuardLevel: undefined, roomMedal: undefined });
  assert.equal(foreign.dataset.notebookRole, 'ordinary');
  assert.equal(findAllByClass(foreign, 'notebook-guard').length, 0);
  assert.equal(findAllByClass(foreign, 'draw-danmaku-medal').length, 0);
  const member = render({ ...item, roomGuardLevel: 2 });
  assert.equal(member.dataset.notebookRole, 'admiral');
  assert.equal(findByClass(member, 'notebook-guard').alt, '提督');
});

test('notebook preserves gift fields and uses the purchased guard identity', async () => {
  const render = await createRenderer({ style: 'notebook', showGiftTotal: true });
  const gift = render({ kind: 'gift', name: '送礼者', guardLevel: 1,
    giftName: '<img>小花', giftCount: 5, giftTotalPrice: 9.9 });
  assert.equal(gift.dataset.notebookKind, 'gift');
  assert.equal(gift.dataset.notebookRole, 'ordinary');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<img>小花');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, 'x5');
  assert.equal(findByClass(gift, 'notebook-amount').textContent, 'CN¥9.9');
  const member = render({ kind: 'gift', name: '开通者', roomGuardLevel: 1,
    giftGuardLevel: 3, guardAction: 'open', giftCount: 2, giftTotalPrice: 396 });
  assert.equal(member.dataset.notebookKind, 'member');
  assert.equal(member.dataset.notebookRole, 'captain');
  assert.equal(findByClass(member, 'notebook-copy').textContent, '感谢开通舰长 ×2');
  assert.equal(findByClass(member, 'notebook-amount').textContent, 'CN¥396.0');
  const renewal = render({ kind: 'gift', name: '续费者', giftGuardLevel: 2, guardAction: 'renew', giftCount: 1 });
  assert.equal(findByClass(renewal, 'notebook-copy').textContent, '感谢续费提督');
  const unknown = render({ kind: 'gift', name: '支持者', giftGuardLevel: 1, giftCount: 1 });
  assert.equal(findByClass(unknown, 'notebook-copy').textContent, '感谢支持总督');
});

test('notebook SC keeps literal full content and respects hidden avatars', async () => {
  const render = await createRenderer({ style: 'notebook', showAvatar: false });
  const message = '<script>完整留言</script>\n'.repeat(12);
  const root = render({ kind: 'superchat', name: '<b>留言者</b>', message, price: 120.5 });
  assert.equal(root.dataset.notebookKind, 'sc');
  assert.equal(findByClass(root, 'notebook-name').textContent, '<b>留言者</b>');
  assert.equal(findByClass(root, 'notebook-copy').textContent, message);
  assert.equal(findByClass(root, 'notebook-copy').children.length, 0);
  assert.equal(findByClass(root, 'notebook-amount').textContent, 'CN¥120.5');
  assert.equal(findAllByClass(root, 'notebook-portrait-float').length, 0);
  assert.equal(root.dataset.liveEntry, undefined);
});

test('flower-letter keeps live metadata, safe emotes and current-room identities outside its artwork', async () => {
  const render = await createRenderer({ style: 'flower-letter', resolveEmoteUrl: value => value, resolveAvatarUrl: value => `/resolved${value}` });
  const item = { name: '<b>真实昵称</b>', message: '晚安[星]', avatarUrl: '/avatar.png', timestamp: '2026-10-26T13:28:00+08:00',
    guardLevel: 1, roomGuardLevel: 3, roomMedal: { name: '来信', level: 25 }, emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };
  const letter = render(item);
  assert.equal(letter.dataset.flowerRole, 'captain');
  assert.equal(findByClass(letter, 'flower-nickname').textContent, item.name);
  assert.equal(findByClass(letter, 'flower-medal').textContent, 'lv.25');
  assert.match(findByClass(letter, 'flower-time').textContent, /^\d{2}:\d{2}$/);
  assert.equal(findByClass(letter, 'flower-avatar-image').src, '/resolved/avatar.png');
  assert.equal(findAllByClass(letter, 'draw-danmaku-emote').length, 1);
  assert.equal(findByClass(letter, 'draw-danmaku-text').textContent, '晚安');
  const ordinary = render({ ...item, roomGuardLevel: 0, roomMedal: undefined });
  assert.equal(ordinary.dataset.flowerRole, 'ordinary');
  assert.equal(findByClass(ordinary, 'flower-guard-icon'), undefined);
  assert.equal(findByClass(ordinary, 'flower-medal'), undefined);
  assert.equal(findAllByClass(letter, 'flower-paper').length, 3);
});

test('flower-letter maps gifts, free gifts, guard purchases and SC to separate accepted cards', async () => {
  const render = await createRenderer({ style: 'flower-letter' });
  const gift = render({ kind: 'gift', name: '送礼者', giftName: '<img>小花', giftCount: 10, giftTotalPrice: 12.5 });
  assert.equal(findByClass(gift, 'flower-gift-name').textContent, '<img>小花');
  assert.equal(findByClass(gift, 'flower-gift-count').textContent, '×10');
  assert.equal(findByClass(gift, 'flower-price').textContent, 'CN¥12.5');
  assert.ok(render({ kind: 'gift', giftTotalPrice: 0 }).classList.contains('flower-small-gift'));
  assert.equal(findByClass(render({ kind: 'gift' }), 'flower-price').textContent, '');
  for (const [level, role] of [[1, 'governor'], [2, 'admiral'], [3, 'captain']]) {
    const guard = render({ kind: 'gift', name: '上舰者', roomGuardLevel: 0, giftGuardLevel: level, giftCount: 1, guardAction: 'renew' });
    assert.equal(guard.dataset.flowerRole, role);
    assert.match(findByClass(guard, 'flower-copy').textContent, /^续费了/);
  }
  const sc = render({ kind: 'superchat', name: '留言者', price: 1000, message: '第一行\n<b>第二行</b>' });
  assert.equal(findByClass(sc, 'flower-copy').textContent, '第一行\n<b>第二行</b>');
  assert.equal(findByClass(sc, 'flower-price').textContent, 'CN¥1,000');
  assert.equal(findAllByClass(sc, 'flower-crest-avatar').length, 1);
});

test('spooky retains safe inline emotes and only displays the current room membership', async () => {
  const render = await createRenderer({ style: 'spooky', resolveEmoteUrl: value => value });
  const item = { name: '<b>访客</b>', message: '晚安[星]', guardLevel: 1, roomGuardLevel: 0,
    emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };
  const root = render(item);
  assert.equal(findByClass(root, 'spooky-name').textContent, item.name);
  assert.equal(findAllByClass(root, 'spooky-role').length, 0);
  assert.equal(findAllByClass(root, 'draw-danmaku-emote').length, 1);
  assert.equal(findByClass(root, 'spooky-sticker').src.endsWith('/skull.svg'), true);
  const guard = render({ ...item, roomGuardLevel: 2 });
  assert.equal(findByClass(guard, 'spooky-role').textContent, '提督');
  assert.equal(findByClass(guard, 'spooky-sticker').src.endsWith('/ghost.svg'), true);
});

test('spooky gifts retain counts and totals; guard purchases use the purchased identity', async () => {
  const render = await createRenderer({ style: 'spooky', showGiftTotal: true, resolveAvatarUrl: value => `/resolved${value}` });
  const gift = render({ kind: 'gift', name: '礼物观众', avatarUrl: '/avatar.png', giftName: '<img>小花花', giftCount: 10, giftTotalPrice: 50 });
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, '× 10');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, '<img>小花花');
  assert.equal(findByClass(gift, 'spooky-avatar').src, '/resolved/avatar.png');
  assert.equal(findAllByClass(gift, 'draw-danmaku-gift-amount').length, 1);
  const guard = render({ kind: 'gift', name: '上舰观众', giftGuardLevel: 3, giftCount: 1, giftTotalPrice: 198 });
  assert.match(findByClass(guard, 'spooky-event-copy').textContent, /开通 舰长.*¥198/);
});

test('spooky SC keeps the full body outside the portrait header and preserves literal content and price', async () => {
  const render = await createRenderer({ style: 'spooky' });
  const message = '<script>留言</script>\n'.repeat(20);
  const root = render({ kind: 'superchat', name: '<b>留言者</b>', price: 120.5, message });
  const board = findByClass(root, 'spooky-board');
  const head = findByClass(root, 'spooky-event-head');
  const copy = findByClass(root, 'spooky-sc-copy');
  assert.equal(head.children.includes(copy), false);
  assert.equal(board.children.includes(copy), true);
  assert.equal(copy.textContent, message);
  assert.equal(copy.children.length, 0);
  assert.equal(findByClass(root, 'spooky-event-name').textContent, '<b>留言者</b>');
  assert.match(findByClass(root, 'spooky-event-copy').textContent, /¥120\.5/);
});

test('floating gifts reuse chat layout and render a complete feeding sentence as safe text', async () => {
  for (const style of ['floating', 'comet']) {
    const render = await createRenderer({ style, fullscreen: true, showAvatar: false });
    for (const gift of [
      { name: '<b>送礼人</b>', giftName: '<img>小花花', giftCount: 10 },
      { name: 'LateNightFM_2026', giftName: '提督', giftCount: 1, giftGuardLevel: 2 },
    ]) {
      const message = `${gift.name}投喂了${gift.giftName}×${gift.giftCount}`;
      const root = render({ ...gift, kind: 'gift', message: '旧的礼物通知' });
      const chat = render({ name: gift.name, message });
      assert.equal(root.className, chat.className, 'gift cards use the ordinary floating nameplate and body');
      assert.equal(root.style['--danmaku-width'], chat.style['--danmaku-width']);
      const body = findByClass(root, 'draw-danmaku-body');
      assert.equal(body.children.length, 2);
      assert.equal(body.children[0].children[0].textContent, gift.name);
      assert.equal(body.children[1].textContent, message);
      assert.equal(body.children[1].children.length, 0, 'names and gifts are literal text');
      assert.equal(findByClass(root, 'draw-danmaku-gift'), undefined);
    }
  }
});

test('mist uses current-room membership, one avatar and safe inline or sticker content', async () => {
  const render = await createRenderer({ style: 'mist', fullscreen: true, showAvatar: true });
  const item = { name: '<b>观众</b>', message: '好听[星]', guardLevel: 1,
    emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };
  for (const roomGuardLevel of [undefined, 0, 1, 2, 3]) {
    const root = render({ ...item, roomGuardLevel });
    assert.equal(root.dataset.roomGuard, String(roomGuardLevel || 0));
    assert.equal(findByClass(root, 'draw-danmaku-identity').children[0].textContent, item.name);
    assert.equal(findAllByClass(root, 'draw-danmaku-avatar').length, 1);
    assert.equal(findAllByClass(root, 'draw-danmaku-emote').length, 1);
    assert.equal(findAllByClass(root, 'draw-danmaku-badge').length, 0);
    assert.deepEqual(root.children.map(node => node.className), ['draw-danmaku-identity', 'draw-danmaku-body']);
  }
  for (const [kind, enlarged] of [['inline', false], ['sticker', true]]) {
    assert.equal(render({ ...item, message: '[星]', emotes: [{ ...item.emotes[0], kind }] }).className.includes('is-emote-only'), enlarged);
  }
});

test('mist gifts, purchased memberships and SC preserve amounts and original content', async () => {
  const render = await createRenderer({ style: 'mist', fullscreen: true, showAvatar: true });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '<img>灯牌', giftCount: 5, giftTotalPrice: 0.5 };
  const gift = render(item);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-action').textContent, '赠送');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, item.giftName);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, '× 5');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, '¥0.5');
  assert.deepEqual(findByClass(gift, 'draw-danmaku-body').children.map(node => node.className), ['draw-danmaku-gift', 'draw-danmaku-identity']);
  for (const [giftGuardLevel, role] of [[3, '舰长'], [2, '提督'], [1, '总督']]) {
    const guard = render({ ...item, giftGuardLevel, giftCount: 1, guardAction: 'renew', guardAccompanyDays: 360 });
    assert.equal(findByClass(guard, 'mist-guard-title').textContent, `续费${role}`);
    assert.equal(findByClass(guard, 'mist-guard-name').textContent, item.name);
    assert.equal(findByClass(guard, 'mist-guard-amount').textContent, '¥0.5');
    assert.equal(findByClass(guard, 'mist-guard-companion').textContent, '已陪伴 360 天');
    assert.equal(findByClass(guard, 'draw-danmaku-gift'), undefined);
    const unknown = render({ ...item, giftGuardLevel, giftTotalPrice: undefined });
    assert.equal(findByClass(unknown, 'mist-guard-title').textContent, `感谢支持${role}`);
    assert.equal(findByClass(unknown, 'mist-guard-companion').textContent, '感谢你的陪伴');
    assert.equal(findByClass(unknown, 'mist-guard-amount').textContent, '—');
  }
  const message = '  保留原文\n<img src=x> 谢谢陪伴  ';
  const sc = render({ kind: 'superchat', name: item.name, message, price: 30.5 });
  assert.equal(findByClass(sc, 'sc-copy').textContent, message);
  assert.equal(findByClass(sc, 'sc-name').textContent, item.name);
  assert.equal(findByClass(sc, 'sc-value').textContent, '30.5');
  assert.equal(findAllByClass(sc, 'sc-avatar').length, 1);
});

test('harbor uses current-room guards and only online top-three badges without exposing chat nicknames', async () => {
  const render = await createRenderer({ style: 'harbor' });
  for (const roomGuardLevel of [0, 1, 2, 3]) {
    const root = render({ name: '<b>观众</b>', message: '今晚好耶', roomGuardLevel, guardLevel: 1, onlineRank: 2 });
    assert.equal(root.dataset.roomGuard, String(roomGuardLevel));
    assert.equal(findAllByClass(root, 'harbor-avatar-frame').length, roomGuardLevel ? 1 : 0);
    assert.equal(findByClass(root, 'draw-danmaku-identity'), undefined);
    assert.equal(findByClass(root, 'harbor-rank').textContent, '榜2');
  }
  for (const onlineRank of [undefined, 0, 4, '1', 1.5]) {
    const root = render({ name: '观众', message: '你好', guardLevel: 1, onlineRank });
    assert.equal(root.dataset.roomGuard, '0');
    assert.equal(findByClass(root, 'harbor-avatar-frame'), undefined);
    assert.equal(findByClass(root, 'harbor-rank'), undefined);
  }
});

test('harbor guard cards use the purchased rank and known facts; SC keeps the original text', async () => {
  const render = await createRenderer({ style: 'harbor' });
  const gift = { kind: 'gift', name: '<img>观众', giftGuardLevel: 3, roomGuardLevel: 1,
    giftTotalPrice: 168, guardAction: 'renew', guardAccompanyDays: 211 };
  const root = render(gift);
  assert.equal(root.dataset.roomGuard, '3');
  assert.equal(findByClass(root, 'harbor-guard-name').textContent, gift.name);
  assert.equal(findByClass(root, 'harbor-guard-amount').textContent, 'CN¥168');
  assert.equal(findByClass(root, 'harbor-guard-copy').textContent, '续费舰长，已陪伴主播 211 天');
  assert.equal(findByClass(render({ ...gift, guardAction: undefined, guardAccompanyDays: undefined }), 'harbor-guard-copy').textContent, '感谢支持舰长');
  const original = '  完整留言\n<img src=x> 好耶  ';
  const sc = render({ kind: 'superchat', name: '观众', price: 2, message: original });
  assert.equal(findByClass(sc, 'sc-copy').textContent, original);
  assert.equal(findByClass(sc, 'sc-currency').textContent, 'CN¥');
  const head = findByClass(sc, 'sc-harbor-head');
  assert.deepEqual(head.children.map(node => node.className), ['sc-avatar', 'sc-harbor-profile']);
});

const EMOTE_CHAT = { name: '<b>观众</b>', message: '你好[星]', emotes: [{ text: '[星]', url: '/star.png', kind: 'inline' }] };

test('snowfox uses current-room identity and preserves safe text and sticker semantics', async () => {
  const render = await createRenderer({ style: 'snowfox' });
  const legacy = render({ ...EMOTE_CHAT, guardLevel: 3, medalName: '其他房间', medalLevel: 40 });
  assert.equal(legacy.dataset.roomGuard, '0');
  assert.equal(legacy.dataset.roomMedal, 'false');
  assert.equal(findByClass(legacy, 'snowfox-medal'), undefined);
  for (const roomGuardLevel of [0, 1, 2, 3]) {
    const root = render({ ...EMOTE_CHAT, roomGuardLevel, roomMedal: { name: '雪狐咕', level: 37 } });
    assert.equal(root.dataset.roomGuard, String(roomGuardLevel));
    assert.equal(findByClass(root, 'draw-danmaku-identity').children[0].textContent, EMOTE_CHAT.name);
    assert.equal(findByClass(root, 'snowfox-medal').textContent, '雪狐咕 37');
    assert.equal(findAllByClass(root, 'snowfox-guard').length, roomGuardLevel ? 1 : 0);
    assert.equal(findAllByClass(root, 'draw-danmaku-emote').length, 1);
  }
  for (const [kind, enlarged] of [['inline', false], ['sticker', true]]) {
    const root = render({ message: '[星]', emotes: [{ ...EMOTE_CHAT.emotes[0], kind }] });
    assert.equal(root.className.includes('is-emote-only'), enlarged);
  }
});

test('snowfox gift, SC and membership each render one distinct card with original values', async () => {
  const render = await createRenderer({ style: 'snowfox' });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '星尘烟花', giftCount: 3, giftTotalPrice: 9 };
  const gift = render(item);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-action').textContent, '投喂');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, 'CN¥9');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, '× 3');
  for (const giftTotalPrice of [undefined, -1, NaN]) assert.equal(findByClass(render({ ...item, giftTotalPrice }), 'draw-danmaku-gift-amount'), undefined);
  for (const giftGuardLevel of [1, 2, 3]) {
    const guard = render({ ...item, giftGuardLevel });
    assert.equal(findByClass(guard, 'snowfox-member-title').textContent, 'NEW MEMBER');
    assert.equal(findByClass(guard, 'snowfox-member-name').textContent, item.name);
    assert.equal(guard.dataset.guard, String(giftGuardLevel));
    assert.equal(findByClass(guard, 'draw-danmaku-gift'), undefined);
  }
  const message = '  <b>原文</b>\n第二行  ';
  const sc = render({ kind: 'superchat', name: '留言人', price: 50.5, message });
  assert.equal(findAllByClass(sc, 'sc-snowfox').length, 1);
  assert.equal(findByClass(sc, 'sc-copy').textContent, message);
  assert.equal(findByClass(sc, 'sc-value').textContent, '50.5');
  assert.equal(findByClass(sc, 'sc-currency').textContent, 'CN¥');
  assert.equal(findAllByClass(sc, 'sc-avatar').length, 1);
});

test('RIPPLOID chat combines current-room medal, honor level and guard badges with safe message content', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const item = { ...EMOTE_CHAT, medalName: '旧灯牌', medalLevel: 40, guardLevel: 3, honorLevel: 99,
    roomMedal: { name: 'BCBCB', level: 22 }, roomGuardLevel: 1 };
  const root = render(item);
  assert.ok(root.className.includes('ripploid-chat'));
  assert.equal(findAllByClass(root, 'draw-danmaku-badge').length, 3);
  assert.deepEqual(findByClass(root, 'draw-danmaku-medal').children.map((node) => node.textContent), ['BCBCB', '·', '22']);
  assert.equal(findByClass(root, 'draw-danmaku-medal').getAttribute('title'), '当前直播间灯牌：BCBCB 22级');
  assert.equal(findByClass(root, 'ripploid-honor-label').textContent, 'UL99');
  assert.equal(findByClass(root, 'ripploid-honor-badge').getAttribute('title'), '荣耀等级 99');
  assert.equal(findByClass(root, 'ripploid-guard-label').textContent, 'GOVERNOR');
  assert.equal(findByClass(root, 'draw-danmaku-guard').getAttribute('title'), '当前直播间大航海：总督');
  const badges = findByClass(root, 'ripploid-badges').children;
  assert.equal(badges[0], findByClass(root, 'draw-danmaku-medal'));
  assert.equal(badges[1], findByClass(root, 'ripploid-honor-badge'));
  assert.equal(badges[2], findByClass(root, 'draw-danmaku-guard'));
  assert.equal(findByClass(root, 'ripploid-username-base').textContent, EMOTE_CHAT.name);
  assert.equal(findByClass(root, 'draw-danmaku-text').textContent, '你好');
  assert.equal(findAllByClass(root, 'draw-danmaku-emote').length, 1);
  assert.equal(findByClass(root, 'draw-danmaku-medal').children.length, 3);
  assert.ok(!allNodes(root).some((node) => /旧灯牌/.test(node.textContent || '')));
  for (const [roomGuardLevel, label] of [[2, 'ADMIRAL'], [3, 'CAPTAIN']]) {
    assert.equal(findByClass(render({ ...item, roomGuardLevel }), 'ripploid-guard-label').textContent, label);
  }
  const legacy = render({ name: '<b>观众</b>', message: '原文', medalName: '其他房间', medalLevel: 40, guardLevel: 1, userLevel: 22, level: 30 });
  assert.equal(findAllByClass(legacy, 'draw-danmaku-badge').length, 0);
  assert.equal(findByClass(legacy, 'ripploid-username-base').textContent, '<b>观众</b>');
  assert.equal(findByClass(legacy, 'ripploid-username-base').children.length, 0);
});

test('RIPPLOID hides each missing identity badge independently without an empty badge row', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  for (let combination = 0; combination < 8; combination += 1) {
    const medal = Boolean(combination & 1);
    const honor = Boolean(combination & 2);
    const guard = Boolean(combination & 4);
    const root = render({ name: '观众', message: '原文',
      roomMedal: medal ? { name: 'BCBCB', level: 22 } : undefined,
      honorLevel: honor ? 22 : 0, roomGuardLevel: guard ? 1 : 0 });
    assert.equal(Boolean(findByClass(root, 'draw-danmaku-medal')), medal);
    assert.equal(Boolean(findByClass(root, 'ripploid-honor-badge')), honor);
    assert.equal(Boolean(findByClass(root, 'draw-danmaku-guard')), guard);
    assert.equal(findAllByClass(root, 'draw-danmaku-badge').length, Number(medal) + Number(honor) + Number(guard));
    assert.equal(Boolean(findByClass(root, 'ripploid-badges')), combination !== 0);
    assert.equal(findByClass(root, 'ripploid-username-base').textContent, '观众');
  }
  for (const honorLevel of [undefined, null, -1, 1.5, '22', NaN]) {
    const root = render({ name: '观众', message: '原文', honorLevel, roomGuardLevel: 3,
      roomMedal: { name: 'BCBCB', level: 22 } });
    assert.equal(findByClass(root, 'ripploid-honor-badge'), undefined);
    assert.equal(findAllByClass(root, 'draw-danmaku-badge').length, 2);
  }
});

test('RIPPLOID gift tickets preserve sender, gift, count and settled total with per-event tiers', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '<img>友谊的大船', giftCount: 510,
    giftTotalPrice: 2992, roomMedal: { name: 'BCBCB', level: 22 }, roomGuardLevel: 1 };
  const gift = render(item);
  assert.ok(gift.className.includes('ripploid-gift'));
  assert.equal(findByClass(gift, 'ripploid-gift-name').textContent, item.giftName);
  assert.equal(findByClass(gift, 'ripploid-gift-name').children.length, 0);
  assert.equal(findByClass(gift, 'ripploid-gift-count').textContent, '×510');
  assert.equal(findByClass(gift, 'ripploid-gift-price-value').textContent, '2,992');
  assert.equal(findByClass(gift, 'ripploid-ticket-signature').textContent, item.name);
  assert.equal(findByClass(gift, 'draw-danmaku-gift'), undefined);
  assert.equal(findAllByClass(gift, 'draw-danmaku-badge').length, 0);
  assert.equal(gift.style['--ripploid-event-accent'], 'var(--ripploid-gift-color2000)');
  for (const [giftTotalPrice, tier] of [[undefined, 0], [-1, 0], [49.99, 0], [50, 50], [99.99, 50],
    [100, 100], [500, 500], [1000, 1000], [2000, 2000]]) {
    assert.equal(render({ ...item, giftTotalPrice }).style['--ripploid-event-accent'], `var(--ripploid-gift-color${tier})`);
  }
  assert.equal(findByClass(render({ ...item, giftTotalPrice: undefined }), 'ripploid-gift-price-value').textContent, '—');
});

test('RIPPLOID system and entry messages keep their text in one safe status row', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  for (const kind of ['system', 'entry']) {
    const root = render({ kind, name: '<b>观众</b>', message: '<script>原始通知</script>', roomGuardLevel: 1 });
    assert.ok(root.className.includes('ripploid-system'));
    assert.ok(!root.className.includes('ripploid-chat'));
    assert.equal(findAllByClass(root, 'draw-danmaku-identity').length, 0);
    assert.equal(findAllByClass(root, 'draw-danmaku-badge').length, 0);
    const copy = findByClass(root, 'ripploid-system-copy');
    assert.equal(copy.children.length, 2);
    assert.equal(copy.children[1].textContent, '<script>原始通知</script>');
    assert.equal(copy.children[1].children.length, 0);
    const label = findByClass(root, 'ripploid-system-label');
    assert.equal(label.textContent, kind === 'entry' ? '[进房]：<b>观众</b> ' : '[系统]：');
    assert.equal(label.children.length, 0);
  }
});

test('RIPPLOID memberships use the purchased rank, resolved avatar and no invented renewal facts', async () => {
  const render = await createRenderer({ style: 'ripploid', resolveAvatarUrl: (value) => `/resolved${value}` });
  for (const [giftGuardLevel, role, script, color] of [
    [3, '舰长', 'Captain', 'captain'], [2, '提督', 'Admiral', 'admiral'], [1, '总督', 'Governor', 'governor'],
  ]) {
    const root = render({ kind: 'gift', name: '<b>新会员</b>', giftGuardLevel, giftName: role,
      avatarUrl: '/avatar.png', giftTotalPrice: 138 });
    assert.equal(root.dataset.guard, String(giftGuardLevel));
    assert.equal(root.getAttribute('aria-label'), `NEW MEMBER，${role}，<b>新会员</b>`);
    assert.equal(findByClass(root, 'ripploid-member-role').textContent, script);
    assert.equal(findByClass(root, 'ripploid-member-name').textContent, '<b>新会员</b>');
    assert.equal(findByClass(root, 'ripploid-passport-number').textContent, `0${giftGuardLevel}`);
    assert.equal(root.style['--ripploid-event-accent'], `var(--ripploid-guard-color-${color})`);
    assert.equal(findByClass(root, 'draw-danmaku-gift'), undefined);
    assert.ok(!allNodes(root).some((node) => /续费|开通|陪伴/.test(node.textContent || '')));
    const image = findByClass(root, 'ripploid-member-avatar').children[0];
    assert.equal(image.src, '/resolved/avatar.png');
    assert.equal(image.referrerPolicy, 'no-referrer');
    image.listeners.error();
    assert.equal(image.removed, true);
    assert.equal(findByClass(root, 'ripploid-member-name').textContent, '<b>新会员</b>');
  }
  const hiddenAvatar = (await createRenderer({ style: 'ripploid', showAvatar: false }))({
    kind: 'gift', name: '观众', giftGuardLevel: 3, avatarUrl: '/avatar.png',
  });
  assert.equal(findByClass(hiddenAvatar, 'ripploid-member-avatar-clip').children.length, 0);
});

test('RIPPLOID SC keeps the exact original and uses its own amount tier instead of packet colors', async () => {
  const render = await createRenderer({ style: 'ripploid' });
  const message = '  <img src=x>\n完整留言\n  ';
  const root = render({ kind: 'superchat', name: '<b>留言人</b>', message, price: 100.5,
    colors: { accentColor: '#010203', backgroundColor: '#040506', priceColor: '#070809' } });
  assert.ok(root.className.includes('ripploid-superchat'));
  assert.equal(findAllByClass(root, 'sc-ripploid').length, 1);
  assert.equal(findByClass(root, 'sc-copy').textContent, message);
  assert.equal(findByClass(root, 'sc-copy').children.length, 0);
  assert.equal(findByClass(root, 'sc-name').textContent, '<b>留言人</b>');
  assert.equal(findByClass(root, 'sc-value').textContent, '100.5');
  assert.equal(findByClass(root, 'sc-currency').textContent, 'RMB');
  assert.deepEqual(findByClass(root, 'sc-money').children.map((node) => node.getAttribute('class') || node.className), ['sc-value', 'sc-currency', 'ripploid-sc-amount-ring']);
  assert.equal(findByClass(root, 'ripploid-sc-title-outline').textContent, 'SC 100.5RMB');
  assert.equal(root.style['--ripploid-event-accent'], 'var(--ripploid-superchat-color100)');
  assert.equal(findAllByClass(root, 'sc-avatar').length, 0);
  const another = render({ kind: 'superchat', name: '另一位观众', message: '第二张留言卡', price: 50 });
  const title = findByClass(root, 'ripploid-sc-transition-title');
  const anotherTitle = findByClass(another, 'ripploid-sc-transition-title');
  assert.notEqual(title.style.clipPath, anotherTitle.style.clipPath, 'simultaneous cards must not share another card’s tear');
  const definitions = allNodes(root).find(node => node.tag === 'defs');
  assert.equal(title.style.clipPath, `url(#${definitions.children[0].id})`);
  assert.equal(title.style.mask, `url(#${definitions.children[1].id})`);
  for (const [price, tier] of [[2, 0], [50, 50], [100, 100], [500, 500], [1000, 1000], [2000, 2000]]) {
    assert.equal(render({ kind: 'superchat', name: '观众', message: '原文', price }).style['--ripploid-event-accent'],
      `var(--ripploid-superchat-color${tier})`);
  }
});

test('Twitter chat uses current-room SVG verification, safe emotes and four vector actions', async () => {
  const render = await createRenderer({ style: 'twitter', showAvatar: true, resolveAvatarUrl: (value) => `/resolved${value}` });
  for (const [roomGuardLevel, color] of [[0, undefined], [3, 'var(--guard-captain)'], [2, 'var(--guard-admiral)'], [1, 'var(--guard-governor)']]) {
    const root = render({ ...EMOTE_CHAT, avatarUrl: '/avatar.png', uid: '42', roomGuardLevel, guardLevel: 1 });
    assert.equal(root.dataset.roomGuard, String(roomGuardLevel));
    assert.equal(root.style['--twitter-guard-color'], color);
    assert.equal(findByClass(root, 'twitter-name').textContent, EMOTE_CHAT.name);
    assert.equal(findByClass(root, 'twitter-name').children.length, 0);
    assert.equal(findByClass(root, 'draw-danmaku-text').textContent, '你好');
    assert.equal(findAllByClass(root, 'draw-danmaku-emote').length, 1);
    assert.equal(findAllByClass(root, 'twitter-verified').length, roomGuardLevel ? 1 : 0);
    assert.equal(findByClass(root, 'twitter-meta').textContent,
      `@${{ 0: 'Spectator', 1: 'Governor', 2: 'Admiral', 3: 'Captain' }[roomGuardLevel]}`);
    assert.equal(findByClass(root, 'draw-danmaku-avatar').className.includes('twitter-avatar'), true);
    assert.equal(findAllByClass(root, 'twitter-action').length, 4);
    for (const action of findAllByClass(root, 'twitter-action')) {
      assert.equal(findByClass(action, 'twitter-action-icon').tag, 'svg');
      assert.equal(findAllByClass(action, 'twitter-action-icon')[0].children.length > 0, true);
      assert.equal(allNodes(action).some((node) => node.tag === 'img'), false);
    }
    assert.equal(findByClass(root, 'twitter-like-count'), undefined, 'decorative motion does not invent a like count');
  }
  const local = render({ name: '本房舰长', message: '你好', guardLevel: 3 });
  assert.equal(local.style['--twitter-guard-color'], 'var(--guard-captain)');
  assert.equal(findAllByClass(render({ name: '其他房间', message: '你好', roomGuardLevel: 0, guardLevel: 1 }), 'twitter-verified').length, 0);
});

test('Twitter gifts preserve artwork and settled totals; memberships use purchased tiers and known facts', async () => {
  const render = await createRenderer({ style: 'twitter', showAvatar: true, showGiftTotal: true,
    resolveGiftImageUrl: (value) => value });
  const item = { kind: 'gift', name: '<b>送礼人</b>', giftName: '<img>小花花', giftCount: 3,
    giftTotalPrice: 12.5, giftImageUrl: '/overtime-gift-images/synthetic.webp', avatarUrl: '/avatar.png' };
  const gift = render(item);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-name').textContent, item.giftName);
  assert.equal(findByClass(gift, 'draw-danmaku-gift-count').textContent, '× 3');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-amount').textContent, '¥12.5');
  assert.equal(findByClass(gift, 'draw-danmaku-gift-art').children[0].src, item.giftImageUrl);
  assert.equal(findAllByClass(gift, 'twitter-gift-panel').length, 1);
  assert.equal(findAllByClass(gift, 'twitter-gift-total').length, 1);
  assert.equal(findByClass(gift, 'twitter-meta').textContent, '@Gift');
  assert.equal(findByClass(gift, 'twitter-guard-steps'), undefined);
  for (const [giftGuardLevel, role, color] of [
    [3, '舰长', 'var(--guard-captain)'], [2, '提督', 'var(--guard-admiral)'], [1, '总督', 'var(--guard-governor)'],
  ]) {
    const guard = render({ ...item, giftGuardLevel, giftName: role, giftCount: 1, roomGuardLevel: 0,
      guardAction: 'renew', guardAccompanyDays: 360 });
    assert.equal(guard.dataset.guard, String(giftGuardLevel));
    assert.equal(guard.style['--twitter-guard-color'], color);
    assert.equal(findByClass(guard, 'draw-danmaku-gift-action').textContent, '续费');
    assert.equal(findByClass(guard, 'twitter-guard-companion').textContent, '已陪伴主播 360 天');
    assert.equal(findAllByClass(guard, 'twitter-guard-step').length, 3);
    assert.equal(findAllByClass(guard, 'twitter-step-icon').every((icon) => icon.tag === 'svg'), true);
    const unknown = render({ ...item, giftGuardLevel, giftName: role, guardAction: undefined, guardAccompanyDays: undefined });
    assert.equal(findByClass(unknown, 'draw-danmaku-gift-action').textContent, '感谢支持');
    assert.equal(findByClass(unknown, 'twitter-guard-companion'), undefined);
    assert.equal(findByClass(render({ ...unknown, guardAccompanyDays: '360' }), 'twitter-guard-companion'), undefined);
  }
});

test('Twitter SC keeps its exact message, amount, avatar and current-room identity', async () => {
  const render = await createRenderer({ style: 'twitter', resolveAvatarUrl: (value) => `/resolved${value}` });
  const message = '  <img src=x>\n完整留言\n  ';
  const root = render({ kind: 'superchat', name: '<b>留言人</b>', message, price: 30.5,
    avatarUrl: '/sc.png', roomGuardLevel: 2, guardLevel: 1 });
  assert.ok(root.className.includes('twitter-superchat'));
  assert.equal(root.style['--twitter-guard-color'], 'var(--guard-admiral)');
  assert.equal(findByClass(root, 'sc-copy').textContent, message);
  assert.equal(findByClass(root, 'sc-copy').children.length, 0);
  assert.equal(findByClass(root, 'sc-value').textContent, '30.5');
  assert.equal(findByClass(root, 'twitter-avatar-image').children[0].src, '/resolved/sc.png');
  assert.equal(findAllByClass(root, 'twitter-verified').length, 1);
  assert.equal(findAllByClass(root, 'twitter-action').length, 4);
});

test('prismatic uses official honor and verified room medal while preserving safe plain text', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  const item = { id: '1', name: '<b>名字</b>', message: '你好', honorLevel: 28, roomGuardLevel: 3,
    roomMedal: { name: '葵绮士', level: 38, guardLevel: 3, isLight: true,
      colorStart: '#4C7DFF99', colorEnd: '#4C7DFF99', colorBorder: '#58A1F8', colorText: '#FFFFFF' } };
  const root = render(item);
  const identity = findByClass(root, 'draw-danmaku-identity');
  assert.deepEqual(identity.children.map((node) => node.className || node.tag), ['prismatic-honor', 'prismatic-medal', 'strong']);
  assert.match(identity.children[0].src, /62fe89aef112353cfd97016b4b2cc653438642ac/);
  assert.equal(identity.children[2].textContent, item.name);
  assert.equal(findAllByClass(root, 'prismatic-guard').length, 1);
  assert.equal(findByClass(root, 'prismatic-medal').style['--medal-start'], '#4C7DFF99');
  const old = render({ ...item, honorLevel: 999, roomMedal: undefined, roomGuardLevel: undefined, guardLevel: 1, medalName: '其他房间' });
  assert.equal(old.dataset.roomGuard, '0');
  assert.equal(findByClass(old, 'prismatic-medal'), undefined);
  assert.equal(findByClass(old, 'prismatic-honor'), undefined);
  assert.equal(findByClass(old, 'prismatic-guard'), undefined);
  const invalid = render({ ...item, roomMedal: { ...item.roomMedal, colorStart: 'url(javascript:alert(1))' } });
  assert.equal(findByClass(invalid, 'prismatic-medal').style['--medal-start'], undefined);
  const honor = findByClass(root, 'prismatic-honor');
  honor.listeners.error();
  assert.equal(findByClass(root, 'prismatic-honor'), undefined);
});

test('prismatic colors belong to individual events and remain stable after reconstruction', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  const recipe = (root) => Object.entries(root.style).filter(([name]) => name.startsWith('--prismatic-'));
  const recipes = new Set();
  for (let id = 1; id <= 100; id += 1) {
    const item = { id: String(id), uid: 'same-viewer', name: '同一人', message: '同一句话', roomGuardLevel: (id % 3) + 1 };
    const root = render(item, id);
    assert.equal(root.dataset.roomGuard, String(item.roomGuardLevel));
    assert.deepEqual(recipe(root), recipe(render({ ...item }, 99 - id)));
    recipes.add(JSON.stringify(recipe(root)));
  }
  assert.equal(recipes.size, 100);
});

test('prismatic preserves stickers, hides single gift quantity, and uses settled totals', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  for (const roomGuardLevel of [0, 1, 2, 3, undefined]) {
    const item = { name: '观众', roomGuardLevel, message: '打call', emotes: [{ text: '打call', url: '/sticker.png', kind: 'sticker' }] };
    assert.ok(render(item).className.includes('is-emote-only'));
    for (const [kind, message] of [['inline', '打call'], ['inline', '打call打call'], ['inline', '你好打call'], [undefined, '打call']]) {
      assert.ok(!render({ ...item, message, emotes: [{ ...item.emotes[0], kind }] }).className.includes('is-emote-only'), `${roomGuardLevel}: ${kind}: ${message}`);
    }
  }
  for (const [giftCount, giftTotalPrice, expected] of [[1, 0.1, '¥0.1'], [3, 12.34, '¥12.34'], [1, undefined, '—']]) {
    const root = render({ kind: 'gift', name: '送礼人', honorLevel: 45, giftName: '<b>礼物</b>', giftCount, giftTotalPrice });
    assert.equal(findByClass(root, 'draw-danmaku-avatar'), undefined);
    assert.equal(findByClass(root, 'draw-danmaku-gift-art'), undefined);
    assert.equal(findByClass(root, 'draw-danmaku-gift-action').textContent, '赠送了');
    assert.equal(findByClass(root, 'draw-danmaku-gift-amount').textContent, expected);
    assert.equal(findAllByClass(root, 'draw-danmaku-gift-count').length, giftCount > 1 ? 1 : 0);
    assert.equal(findAllByClass(root, 'prismatic-honor').length, 1);
  }
});

test('prismatic guard thanks uses purchased ranks and actual companion days with honest missing-data fallbacks', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  for (const [giftGuardLevel, role] of [[3, '舰长'], [2, '提督'], [1, '总督']]) {
    for (const [guardAction, action] of [['open', '开通'], ['renew', '续费'], [undefined, '感谢支持']]) {
      const item = { kind: 'gift', giftGuardLevel, guardAction, name: '<b>送礼人</b>', guardAccompanyDays: 360 };
      const root = render(item);
      assert.equal(root.dataset.guard, String(giftGuardLevel));
      assert.equal(findAllByClass(root, 'draw-danmaku-avatar').length, 1);
      assert.equal(findByClass(root, 'prismatic-guard-name').textContent, item.name);
      assert.equal(findByClass(root, 'prismatic-guard-copy').textContent, `${action}${role}，已陪伴主播 360 天`);
      assert.equal(findByClass(root, 'draw-danmaku-gift-copy'), undefined);
      for (const guardAccompanyDays of [undefined, -1, '360', NaN]) {
        assert.equal(findByClass(render({ ...item, guardAccompanyDays }), 'prismatic-guard-copy').textContent, `${action}${role}`);
      }
    }
  }
  assert.equal(findByClass(render({ kind: 'gift', guardLevel: 3, giftName: '小花花' }), 'prismatic-guard-card'), undefined);
  const guardGift = { kind: 'gift', giftGuardLevel: 3, giftCount: 3 };
  for (const [giftTotalPrice, expected] of [[138, '138'], [19998.5, '19,998.5'], [0, '0']]) {
    assert.equal(findByClass(render({ ...guardGift, giftTotalPrice }), 'prismatic-guard-amount').textContent, expected);
  }
  for (const giftTotalPrice of [undefined, -1, '138', NaN, Infinity]) {
    assert.equal(findByClass(render({ ...guardGift, giftTotalPrice }), 'prismatic-guard-amount'), undefined);
  }
});

test('prismatic SC retains exact original, sender and amount in its two-row card', async () => {
  const render = await createRenderer({ style: 'prismatic' });
  const message = '  <b>原文</b>\n第二行  ';
  const root = render({ kind: 'superchat', message, name: '留言人', price: 50.5 });
  assert.ok(findByClass(root, 'sc-prismatic'));
  assert.equal(findByClass(root, 'sc-name').textContent, '留言人');
  assert.equal(findByClass(root, 'sc-copy').textContent, message);
  assert.equal(findByClass(root, 'sc-currency').textContent, 'CN¥');
  assert.equal(findByClass(root, 'sc-value').textContent, '50.5');
  assert.equal(findByClass(root, 'sc-avatar'), undefined);
});

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
