'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createFakeDocument, findByClass } = require('../helpers/fake-dom');
const shared = pathToFileURL(path.join(__dirname, '../../public/js/shared/bilibili-guard-icons.js')).href;

test('guard icon threshold, room changes and existing images share one selection', async () => {
  const icons = await import(shared);
  for (const level of [1, 2, 3]) {
    for (const count of [null, undefined, -1, 0, 999, '1000', Infinity, 1000.5]) {
      assert.doesNotMatch(icons.getGuardIcon(level, count), /thousand/);
    }
    for (const count of [1000, 10000]) assert.match(icons.getGuardIcon(level, count), /-thousand\.webp$/);
  }
  assert.equal(icons.getGuardIcon(0), '');
  const image = createFakeDocument().createElement('img');
  image.getAttribute = key => key === 'src' ? image.src : image.attributes[key];
  image.removeAttribute = key => { delete image.attributes[key]; };
  image.src = icons.bindGuardImage(image, '/img/admin/gifts/bilibili-guard-captain.webp');
  const root = createFakeDocument().createElement('html');
  const document = { documentElement: root, querySelectorAll: () => [image] };
  const received = [];
  const stop = icons.subscribeRoomGuardState(state => received.push(state));
  icons.applyRoomGuardState({ roomId: '52030', count: 1000 }, document);
  assert.match(image.src, /captain-thousand\.webp$/);
  assert.match(root.style['--bilibili-guard-prefect'], /prefect-thousand\.webp/);
  icons.applyRoomGuardState({ roomId: '52030', count: 1000 }, document);
  assert.equal(received.length, 2, 'identical snapshots do not duplicate preview notifications');
  icons.applyRoomGuardState({ roomId: '42', count: null }, document);
  assert.doesNotMatch(image.src, /thousand/);
  assert.equal(icons.bindGuardImage(image, '/scene-text-images/custom.webp'), '/scene-text-images/custom.webp');
  assert.equal(image.getAttribute('data-guard-icon'), undefined);
  stop();
  icons.applyRoomGuardState(null, document);
  assert.equal(received.length, 3);
});

test('identity and gift renderers bind known guard artwork for later room updates', async () => {
  const icons = await import(shared);
  icons.applyRoomGuardState({ roomId: '52030', count: 1000 });
  try {
    const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES: classNames } = await import(pathToFileURL(path.join(__dirname,
      '../../public/js/overlays/danmaku-message-renderer.js')).href);
    const document = createFakeDocument();
    for (const style of ['prismatic', 'snowfox']) {
      const render = createDanmakuMessageRenderer({ document, classNames, style, resolveEmoteUrl: value => value });
      const bubble = render({ name: '舰长', message: '测试', roomGuardLevel: 3 });
      const image = findByClass(bubble, `${style}-guard`);
      assert.match(image.src, /captain-thousand\.webp$/);
      assert.equal(image.attributes['data-guard-icon'], '3');
    }
    const render = createDanmakuMessageRenderer({ document, classNames, style: 'identity', resolveGiftImageUrl: value => value });
    const gift = render({ kind: 'gift', name: '观众', giftName: '总督', giftCount: 1,
      giftImageUrl: '/img/admin/gifts/bilibili-guard-governor.webp' });
    const image = findByClass(gift, 'draw-danmaku-gift-art').children[0];
    assert.match(image.src, /governor-thousand\.webp$/);
    assert.equal(image.attributes['data-guard-icon'], '1');
  } finally { icons.applyRoomGuardState(null); }
});
