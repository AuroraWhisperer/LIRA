'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.join(__dirname, '..');

test('classic queue starts at its fixed size and follows a resized browser source', () => {
  const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const themeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const queueSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const overlayCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');
  const themeStoreSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'theme-store.js'), 'utf8');

  assert.doesNotMatch(adminHtml, /queueFixedSixRows|固定 6 首歌高度/);
  assert.doesNotMatch(themeSource, /queueFixedSixRows/);
  assert.doesNotMatch(settingsSource, /queueFixedSixRows/);
  assert.doesNotMatch(themeStoreSource, /queueFixedSixRows/);
  assert.doesNotMatch(queueSource, /visibleRows\s*=\s*6|queueFixedSixRows|--classic-window-height/);
  assert.match(overlayCss, /\.queue-classic\s*\{[^}]*width:\s*min\(405px,\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)\)/s);
  assert.match(overlayCss, /\.overlay-body\.queue-viewport-resized \.queue-classic\s*\{[^}]*width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/s);
  assert.match(overlayCss, /\.classic-list-window\s*\{[^}]*height:\s*min\(235px,\s*calc\(100vh - 32px\)\)/s);
  assert.match(overlayCss, /\.overlay-body\.queue-viewport-resized \.classic-list-window\s*\{[^}]*height:\s*auto/s);
  assert.doesNotMatch(overlayCss, /--classic-window-height/);
  assert.doesNotMatch(queueSource, /Math\.min\(6,/);
  assert.match(queueSource, /window\.addEventListener\('resize', handleQueueViewportResize\)/);
  assert.match(queueSource, /document\.body\.classList\.add\('queue-viewport-resized'\)/);
});

test('classic queue animates only when its rendered rows overflow available height', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() { return { textContent: '' }; },
      documentElement: {
        clientHeight: 700,
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  sandbox.window = { innerHeight: 700 };
  vm.runInNewContext(source, sandbox);

  const shortClasses = new Set(['classic-list', 'paused']);
  const shortViewport = {
    clientHeight: 250,
    style: {},
    getBoundingClientRect: () => ({ top: 100 })
  };
  const shortList = {
    scrollHeight: 240,
    classList: {
      add(name) { shortClasses.add(name); },
      remove(name) { shortClasses.delete(name); }
    },
    insertAdjacentHTML() { assert.fail('rows that fit must not be duplicated'); }
  };

  assert.equal(
    sandbox.configureClassicVerticalScroll(shortViewport, shortList, {}, '', 5),
    false
  );
  assert.ok(Number.parseInt(shortViewport.style.maxHeight, 10) >= 580);
  assert.equal(shortClasses.has('scrolling'), false);

  const longClasses = new Set(['classic-list', 'paused']);
  let duplicatedHtml = '';
  const longViewport = {
    clientHeight: 586,
    style: {},
    getBoundingClientRect: () => ({ top: 100 })
  };
  const longList = {
    scrollHeight: 900,
    classList: {
      add(name) { longClasses.add(name); },
      remove(name) { longClasses.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };
  const settings = { queueScrollMode: 'loop', queueScrollSpeed: '42' };

  assert.equal(
    sandbox.configureClassicVerticalScroll(longViewport, longList, settings, '<div>rows</div>', 5),
    true
  );
  assert.equal(styleValues.get('--classic-loop-distance'), '905px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds(settings), 905, 586)}s`
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(longClasses.has('paused'), false);
  assert.equal(longClasses.has('scrolling'), true);
});

test('identity queue starts at its fixed size and follows a resized browser source', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const overlayCss = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() { return { textContent: '' }; },
      documentElement: {
        clientHeight: 500,
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  sandbox.window = { innerHeight: 500 };
  vm.runInNewContext(source, sandbox);

  assert.match(overlayCss, /\.queue-identity\s*\{[^}]*width:\s*min\(430px,\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)\)/s);
  assert.match(overlayCss, /\.overlay-body\.queue-viewport-resized \.queue-identity\s*\{[^}]*width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/s);
  const identityWindowRule = overlayCss.match(/\.identity-list-window\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(identityWindowRule);
  assert.match(identityWindowRule, /height:\s*min\(364px,\s*calc\(100vh - \(2 \* var\(--overlay-edge\)\)\)\)/);
  assert.match(overlayCss, /\.overlay-body\.queue-viewport-resized \.identity-list-window\s*\{[^}]*height:\s*auto/s);

  const classes = new Set(['identity-list', 'paused']);
  const viewport = {
    style: {},
    parentElement: null,
    getBoundingClientRect: () => ({ top: 40 })
  };
  Object.defineProperty(viewport, 'clientHeight', {
    get() { return Number.parseInt(viewport.style.height, 10) || 0; }
  });
  const list = {
    scrollHeight: 240,
    classList: {
      add(name) { classes.add(name); },
      remove(...names) { names.forEach((name) => classes.delete(name)); }
    },
    insertAdjacentHTML() { assert.fail('bounce mode must not duplicate rows'); }
  };
  const settings = { queueScrollMode: 'bounce', identityQueueScrollSpeed: '42' };

  sandbox.window.innerHeight = 200;
  assert.equal(
    sandbox.configureIdentityVerticalScroll(viewport, list, settings, '<div>rows</div>', 4),
    true
  );
  assert.equal(viewport.style.height, '156px');
  assert.equal(styleValues.get('--identity-bounce-distance'), '84px');
  assert.equal(classes.has('scrolling-bounce'), true);

  sandbox.window.innerHeight = 500;
  assert.equal(
    sandbox.configureIdentityVerticalScroll(viewport, list, settings, '<div>rows</div>', 4),
    false
  );
  assert.equal(viewport.style.height, '364px');
  assert.equal(classes.has('scrolling-bounce'), false);
});
