const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function rendererModule() {
  return import(pathToFileURL(path.join(__dirname, '../../public/js/overlays/danmaku-message-renderer.js')).href);
}

function documentFixture() {
  return {
    createElement(tag) {
      return {
        tag, children: [], dataset: {}, textContent: '', listeners: {},
        style: { setProperty(key, value) { this[key] = value; } },
        append(...nodes) { this.children.push(...nodes); },
        setAttribute(key, value) { this[key] = value; },
        addEventListener(key, handler) { this.listeners[key] = handler; },
        remove() { this.removed = true; },
      };
    },
  };
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

test('SC uses exact Bilibili tier colors with 2-yuan fallback and validated upstream overrides', async () => {
  const { getSuperChatColors } = await import(
    pathToFileURL(path.join(__dirname, '../../public/js/overlays/danmaku-superchat-renderer.js')).href
  );
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
    assert.deepEqual(getSuperChatColors({ price }), {
      backgroundColor: surface, accentColor: accent, priceColor: label,
    });
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

test('all six SC designs preserve full original plain text and own their optional identity elements', async () => {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await rendererModule();
  const message = '  <img src=x onerror=alert(1)>\n' + '完整留言，不要截断。'.repeat(70) + '\n  ';
  for (const style of ['ranked', 'bubble', 'signal', 'minimal', 'transparent', 'identity']) {
    const render = createDanmakuMessageRenderer({
      document: documentFixture(), classNames: DEFAULT_DANMAKU_CLASSES, style,
      showAvatar: false, resolveAvatarUrl: (value) => value,
    });
    const root = render({ kind: 'superchat', name: '<b>原名字</b>', message, price: 2 });
    const nodes = descendants(root);
    const named = (value) => nodes.filter((node) => (node.className || '').split(' ').includes(value));
    assert.equal(named('sc-copy')[0].textContent, message, style);
    assert.equal(named('sc-copy')[0].children.length, 0);
    assert.equal(named('sc-avatar').length, ['ranked', 'identity'].includes(style) ? 1 : 0, style);
    assert.equal(named('sc-name').length, ['ranked', 'bubble', 'identity'].includes(style) ? 1 : 0, style);
    assert.equal(named('sc-money').length, 1, style);
    assert.equal(root.style['--sc-accent'], '#2A60B2');
    assert.equal(named('draw-danmaku-body').length, 0, 'SC must not reuse chat or gift structure');
    assert.equal(named('draw-danmaku-gift').length, 0);
    assert.ok(!nodes.some((node) => node.textContent === 'SC' || node.textContent === '谢谢支持'));
    const ordinary = render({ name: '聊天', message: '普通消息' });
    assert.ok(!ordinary.className.includes('is-superchat'));
    const gift = render({ kind: 'gift', name: '送礼人', giftName: '小花花', giftCount: 1 });
    assert.ok(gift.className.includes('is-gift'));
  }
});

test('SC portrait failure falls back to the name without hiding the original', async () => {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await rendererModule();
  const render = createDanmakuMessageRenderer({
    document: documentFixture(), classNames: DEFAULT_DANMAKU_CLASSES, style: 'identity',
    resolveAvatarUrl: (value) => value,
  });
  const root = render({ kind: 'superchat', price: 30, name: '晚风', message: '原文', avatarUrl: 'https://i0.hdslb.com/avatar.png' });
  const portrait = descendants(root).find((node) => node.className === 'sc-avatar');
  const image = portrait.children[0];
  assert.equal(image.referrerPolicy, 'no-referrer');
  image.listeners.error();
  assert.equal(portrait.textContent, '晚');
  assert.equal(image.removed, true);
  assert.equal(descendants(root).find((node) => node.className === 'sc-copy').textContent, '原文');
});
