const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.listeners = {};
    this.style = { setProperty() {} };
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
  replaceChildren(...nodes) { this.children.forEach((node) => { node.parent = null; }); this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelector(selector) { return all(this).find((node) => node.className.split(' ').includes(selector.slice(1))); }
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
async function renderer() {
  const { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } = await import(
    pathToFileURL(path.join(__dirname, '../../public/js/overlays/danmaku-message-renderer.js')).href);
  return createDanmakuMessageRenderer({ document: { createElement: (tag) => new Node(tag) },
    classNames: DEFAULT_DANMAKU_CLASSES, style: 'moonlit', showGiftTotal: true,
    getGuardLabel: (level) => ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || '',
    resolveAvatarUrl: (value) => value === 'rejected' ? '' : value });
}

test('moonlit chat retains safe original text and emotes with a rank icon by the avatar', async () => {
  const render = await renderer();
  for (const [guardLevel, identity] of [[0, 'viewer'], [3, 'captain'], [2, 'admiral'], [1, 'governor']]) {
    const root = render({ name: '<b>昵称</b>', message: '晚上好[喝彩]', guardLevel,
      emotes: [{ text: '[喝彩]', url: '/sample.png', kind: 'inline' }] });
    assert.equal(root.dataset.identity, identity);
    assert.equal(root.querySelector('.draw-danmaku-identity').children[0].textContent, '<b>昵称</b>');
    assert.equal(root.querySelector('.draw-danmaku-emote').src, '/sample.png');
    assert.equal(Boolean(root.querySelector('.moonlit-guard-icon')), guardLevel > 0);
    assert.equal(all(root).filter((node) => node.className === 'moonlit-ink-sweep').length, 1);
  }
});

test('gifts retain their avatar in a scroll while purchased ranks use the separate two-stage scene', async () => {
  const render = await renderer();
  const ordinary = { kind: 'gift', name: '晚风', giftName: '小花花', giftCount: 3, giftTotalPrice: 1.2, guardLevel: 3 };
  const gift = render(ordinary);
  assert.match(gift.className, /moonlit-scroll/);
  assert.ok(gift.querySelector('.moonlit-scroll-paper'));
  assert.equal(gift.querySelector('.draw-danmaku-avatar').textContent, '晚');
  assert.equal(gift.querySelector('.draw-danmaku-gift-name').textContent, '小花花');
  assert.equal(gift.querySelector('.draw-danmaku-gift-count').textContent, '× 3');
  assert.equal(gift.querySelector('.moonlit-guard-title'), undefined);
  assert.equal(gift.querySelector('.draw-danmaku-gift-amount').textContent, '¥1.2');
  assert.equal(gift.querySelector('.draw-danmaku-gift-amount').parent.className, 'draw-danmaku-identity');
  for (const [giftGuardLevel, title] of [[3, '舰长'], [2, '提督'], [1, '总督']]) {
    const root = render({ ...ordinary, giftGuardLevel, avatarUrl: 'rejected' });
    assert.equal(root.querySelector('.moonlit-guard-title').children.map((node) => node.textContent).join(''), title);
    assert.equal(root.querySelector('.moonlit-guard-action').children.map((node) => node.textContent).join(''), '上任');
    assert.equal(root.querySelector('.moonlit-guard-icon')['aria-label'], title);
    assert.equal(root.querySelector('.moonlit-guard-name').textContent, '晚风');
    assert.equal(root.querySelector('.draw-danmaku-avatar').textContent, '晚');
    assert.equal(all(root).filter((node) => node.className === 'moonlit-bird').length, 3);
    assert.equal(root.children[0].className, 'moonlit-guard-scene');
    assert.equal(root.children[1].className, 'moonlit-guard-lettering');
    assert.equal(root.querySelector('.draw-danmaku-gift'), undefined);
  }
});

test('moonlit SC shares the gift scroll and preserves the full message and actual value', async () => {
  const render = await renderer();
  const message = '  <script>不是代码</script>\n' + '长留言保留原文。'.repeat(50);
  const root = render({ kind: 'superchat', name: '月色', price: 39.9, message });
  assert.match(root.className, /moonlit-scroll/);
  assert.ok(root.querySelector('.moonlit-scroll-roller'));
  assert.equal(root.querySelector('.sc-copy').textContent, message);
  assert.equal(root.querySelector('.sc-value').textContent, '39.9');
  assert.equal(root.querySelector('.sc-name').textContent, '月色');
  assert.equal(root.querySelector('.sc-avatar').textContent, '月');
  assert.equal(root.querySelector('.draw-danmaku-gift'), undefined);
});
