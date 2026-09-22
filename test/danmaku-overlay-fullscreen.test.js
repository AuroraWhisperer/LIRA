'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('fullscreen random danmaku positions are stable, bounded, and expire from timers', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.offsetWidth = tagName === 'article' ? 120 : 0;
      this.offsetHeight = tagName === 'article' ? 42 : 0;
      this.clientWidth = 0;
      this.clientHeight = 0;
      const values = new Map();
      this.style = {
        values,
        setProperty(name, value) {
          values.set(name, String(value));
        },
        getPropertyValue(name) {
          return values.get(name) || '';
        },
      };
    }

    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) {
          node.children.forEach((child) => {
            child.parentNode = this;
          });
          this.children.push(...node.children);
        } else {
          node.parentNode = this;
          this.children.push(node);
        }
      });
    }

    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }

    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
      node.parentNode = null;
    }

    addEventListener() {}
    setAttribute() {}
  }

  const root = new FakeNode('section');
  root.clientWidth = 400;
  root.clientHeight = 240;
  const scheduled = [];
  const cancelled = [];
  let now = 1000;
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: {
      createElement: (tagName) => new FakeNode(tagName),
      createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true }),
    },
    ResizeObserver: FakeResizeObserver,
  });
  const feed = module.createDanmakuFeed(root, {
    layout: 'fullscreen-random',
    maxItems: 5,
    itemLifetimeMs: 500,
    expireItems: true,
    autoScroll: false,
    now: () => now,
    scheduleTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    cancelTimeout(timer) {
      cancelled.push(timer);
    },
  });
  const item = {
    id: 'stable',
    uid: '17',
    timestamp: 700,
    name: '发送者',
    message: '全屏消息',
    guardLevel: 3,
    medalName: '夜航',
  };

  feed.render([item]);
  const firstNode = root.children[0];
  const firstLeft = firstNode.style.getPropertyValue('left');
  const firstTop = firstNode.style.getPropertyValue('top');
  assert.match(firstLeft, /^\d+(?:\.\d+)?px$/);
  assert.match(firstTop, /^\d+(?:\.\d+)?px$/);
  assert.ok(Number.parseFloat(firstLeft) >= 8);
  assert.ok(Number.parseFloat(firstLeft) <= root.clientWidth - firstNode.offsetWidth - 8);
  assert.ok(Number.parseFloat(firstTop) >= 8);
  assert.ok(Number.parseFloat(firstTop) <= root.clientHeight - firstNode.offsetHeight - 8);
  assert.equal(scheduled[0].delay, 200);

  now = 1100;
  feed.render([{ ...item, guardLevel: 1, medalName: '新牌' }]);
  assert.equal(root.children[0].style.getPropertyValue('left'), firstLeft);
  assert.equal(root.children[0].style.getPropertyValue('top'), firstTop);
  assert.equal(scheduled.at(-1).delay, 100);
  assert.ok(cancelled.length >= 1);

  const timer = scheduled.at(-1);
  timer.callback();
  assert.equal(root.children.length, 0);

  feed.render([{ ...item, timestamp: 1100 }]);
  const activeTimer = scheduled.at(-1);
  feed.destroy();
  assert.ok(cancelled.includes(activeTimer));
  assert.equal(root.children.length, 0);
  assert.ok(resizeObservers.length > 0);

  const collisionFeed = module.createDanmakuFeed(root, {
    layout: 'fullscreen-random',
    maxItems: 50,
    expireItems: false,
    autoScroll: false,
  });
  const assertClearLayout = () => {
    const boxes = root.children.map((node) => ({
      left: Number.parseFloat(node.style.getPropertyValue('left')),
      top: Number.parseFloat(node.style.getPropertyValue('top')),
      width: node.offsetWidth,
      height: node.offsetHeight,
    }));
    for (const [index, box] of boxes.entries()) {
      assert.ok(box.left >= 16 && box.top >= 16);
      assert.ok(box.left + box.width <= root.clientWidth - 16);
      assert.ok(box.top + box.height <= root.clientHeight - 16);
      for (const other of boxes.slice(index + 1)) {
        assert.ok(
          box.left >= other.left + other.width + 10 ||
            box.left + box.width + 10 <= other.left ||
            box.top >= other.top + other.height + 10 ||
            box.top + box.height + 10 <= other.top,
          'simultaneous messages must have a visible gap',
        );
      }
    }
  };
  collisionFeed.render(
    Array.from({ length: 8 }, (_, index) => ({
      id: `crowded-${index}`,
      name: `观众 ${index}`,
      message: '连续图片弹幕',
    })),
  );
  assert.ok(root.children.length > 1);
  assertClearLayout();
  const retainedNode = root.children.at(-1);
  const retainedPosition = retainedNode.style.getPropertyValue('left');
  collisionFeed.append({ id: 'newest', name: '最新消息', message: '新弹幕' });
  if (root.children.includes(retainedNode)) assert.equal(retainedNode.style.getPropertyValue('left'), retainedPosition);
  assertClearLayout();
  root.children.at(-1).offsetHeight = 90;
  resizeObservers.at(-1).trigger();
  assertClearLayout();
  root.clientWidth = 220;
  root.clientHeight = 140;
  resizeObservers.at(-1).trigger();
  assert.equal(root.children.length, 1, 'a full viewport must make room for the latest message');
  assert.equal(root.children[0].children[0].children[0].children[0].textContent, '最新消息');
  assertClearLayout();
  root.clientWidth = 400;
  root.clientHeight = 240;
  collisionFeed.render([
    { id: 'fits', name: '能放下', message: '保留这条' },
    { id: 'oversized', name: '超高', message: '图片加载后超高' },
  ]);
  const fittingNode = root.children[0];
  root.children.at(-1).offsetHeight = 400;
  resizeObservers.at(-1).trigger();
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], fittingNode, 'an oversized item must not evict fitting messages');
  collisionFeed.destroy();
});

test('fullscreen random preview keeps rendered items without expiration timers', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.style = { setProperty() {} };
    }
    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) this.children.push(...node.children);
        else this.children.push(node);
      });
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
    }
    addEventListener() {}
    setAttribute() {}
  }
  const root = new FakeNode('section');
  const scheduled = [];
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: {
      createElement: (tagName) => new FakeNode(tagName),
      createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true }),
    },
  });
  const feed = module.createDanmakuFeed(root, {
    layout: 'fullscreen-random',
    itemLifetimeMs: 500,
    expireItems: false,
    scheduleTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });
  feed.render([{ id: 'preview', timestamp: 1, message: '预览' }]);
  assert.equal(root.children.length, 1);
  assert.equal(scheduled.length, 0);
});

test('fullscreen random live items without a timestamp still expire from arrival time', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.clientWidth = 0;
      this.clientHeight = 0;
      this.style = { setProperty() {} };
      this.tagName = tagName.toUpperCase();
    }
    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) this.children.push(...node.children);
        else {
          node.parentNode = this;
          this.children.push(node);
        }
      });
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
    }
    addEventListener() {}
    setAttribute() {}
  }
  const root = new FakeNode('section');
  const scheduled = [];
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: {
      createElement: (tagName) => new FakeNode(tagName),
      createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true }),
    },
  });
  const feed = module.createDanmakuFeed(root, {
    layout: 'fullscreen-random',
    itemLifetimeMs: 500,
    now: () => 1000,
    scheduleTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });

  feed.append({ id: 'arrival-only', message: '没有时间戳' });
  assert.equal(root.children.length, 1);
  assert.equal(scheduled[0].delay, 500);
});
