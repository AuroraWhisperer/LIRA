'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

class Node {
  constructor(tagName = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = '';
    this.textContent = '';
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.offsetWidth = 120;
    this.offsetHeight = 42;
    this.replacements = 0;
    const values = new Map();
    this.style = {
      setProperty: (key, value) => values.set(key, value),
      getPropertyValue: (key) => values.get(key),
    };
    this.classList = { add() {}, toggle() {} };
  }
  append(...nodes) {
    for (const node of nodes.flatMap((item) => (item.isFragment ? item.children : [item]))) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.replacements += 1;
    this.children.forEach((node) => {
      node.parentNode = null;
    });
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

async function fixture() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Node('section'));
    return elements.get(id);
  };
  const frames = new Map();
  const timers = new Map();
  const sockets = [];
  let sequence = 0;
  let now = 10000;
  let ready;
  class Socket {
    constructor() {
      this.listeners = {};
      sockets.push(this);
    }
    addEventListener(name, callback) {
      this.listeners[name] = callback;
    }
    emit(name, value) {
      this.listeners[name]?.(value);
    }
  }
  await loadModuleExports(path.resolve(__dirname, '../public/js/overlays/danmaku.js'), {
    document: {
      body: new Node('body'),
      documentElement: new Node('html'),
      getElementById: element,
      addEventListener: (_, callback) => {
        ready = callback;
      },
      createElement: (tag) => new Node(tag),
      createDocumentFragment: () => Object.assign(new Node(), { isFragment: true }),
    },
    window: { innerWidth: 1280, addEventListener() {}, __API_TOKEN__: 'synthetic-token' },
    location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
    URL,
    URLSearchParams,
    WebSocket: Socket,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    requestAnimationFrame(callback) {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  ready();
  sockets[0].emit('open');
  return {
    root: element('danmakuFeed'),
    timers,
    frames,
    sockets,
    snapshot(items, style = 'signal', duration = 6) {
      sockets.at(-1).emit('message', {
        data: JSON.stringify({
          type: 'snapshot',
          state: {
            danmakuFeed: items,
            settings: { danmakuOverlayStyle: style, danmakuFullscreenDurationSeconds: duration },
            liveStatus: { enabled: true, roomId: '1', connected: true },
          },
        }),
      });
    },
    append(item) {
      sockets.at(-1).emit('message', { data: JSON.stringify({ type: 'danmaku:message', item }) });
    },
    flush() {
      while (frames.size) {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback());
      }
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.deadline <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

const message = (id, extra = {}) => ({ id, name: '合成观众', message: `消息 ${id}`, timestamp: 10000, ...extra });

test('unchanged snapshots preserve actual nodes and expiration timers in all nine styles', async () => {
  for (const style of [
    'bubble',
    'signal',
    'minimal',
    'ranked',
    'transparent',
    'identity',
    'outline',
    'cream',
    'glow',
  ]) {
    const f = await fixture();
    const items = [message('one')];
    f.snapshot(items, style);
    f.flush();
    const node = f.root.children[0];
    const replacements = f.root.replacements;
    const timerIds = [...f.timers.keys()];
    f.advance(1000);
    f.snapshot(items, style);
    f.flush();
    assert.equal(f.root.children[0], node, style);
    assert.equal(f.root.replacements, replacements, style);
    assert.deepEqual([...f.timers.keys()], timerIds, style);
    if (['outline', 'cream', 'glow'].includes(style)) {
      f.advance(5000);
      assert.equal(f.root.children.length, 0);
      f.snapshot(items, style);
      f.flush();
      assert.equal(f.root.children.length, 0, 'expired items must stay expired');
    }
  }
});

test('matching snapshot preserves queued incremental append and does not duplicate it', async () => {
  const f = await fixture();
  const first = message('one');
  const second = message('two');
  f.snapshot([first]);
  f.flush();
  const retained = f.root.children[0];
  f.append(second);
  const pending = [...f.frames.keys()];
  f.snapshot([first, second]);
  assert.deepEqual([...f.frames.keys()], pending);
  assert.equal(f.root.children[0], retained);
  f.flush();
  assert.equal(f.root.children.length, 2);
  f.append(second);
  f.flush();
  assert.equal(f.root.children.length, 2);
});

test('first empty snapshot, content corrections, clear and feed configuration changes still render', async () => {
  const f = await fixture();
  f.snapshot([]);
  f.flush();
  assert.equal(f.root.children[0].textContent, '等待直播消息…');
  const first = message('one');
  f.snapshot([first]);
  f.flush();
  let node = f.root.children[0];
  f.snapshot([message('one', { message: '更正正文' })]);
  f.flush();
  assert.notEqual(f.root.children[0], node);
  f.snapshot([first], 'outline');
  f.flush();
  node = f.root.children[0];
  f.snapshot([first], 'outline', 8);
  f.flush();
  assert.notEqual(f.root.children[0], node);
  assert.equal([...f.timers.values()][0].deadline, 18000);
  f.snapshot([], 'outline', 8);
  f.flush();
  assert.equal(f.root.children[0].textContent, '等待直播消息…');
  assert.equal(f.timers.size, 0);
});

test('reconnect restores new snapshot contents, and the message window remains bounded and deduplicated', async () => {
  const f = await fixture();
  const first = message('one');
  f.snapshot([first]);
  f.flush();
  f.sockets[0].emit('close');
  f.advance(800);
  f.sockets.at(-1).emit('open');
  f.snapshot([first, message('two')]);
  f.flush();
  assert.equal(f.root.children.length, 2);
  f.root.clientHeight = 10000;
  const items = Array.from({ length: 55 }, (_, index) => message(index + 1));
  f.snapshot([...items, items[0]]);
  f.flush();
  assert.equal(f.root.children.length, 50);
  const retained = f.root.children.at(-1);
  f.snapshot(items);
  f.flush();
  assert.equal(f.root.children.at(-1), retained);
});
