'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '..');

test('overlay base styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'),
    'utf8'
  );

  assert.match(entry, /@import url\('\.\/base\/identity\.css'\);/);
});

test('queue overlay loads one focused module entrypoint', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'queue.html'),
    'utf8'
  );
  const entrySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'),
    'utf8'
  );

  assert.match(html, /<script type="module" src="\/js\/overlays\/queue\.js\?v=[^"]+"><\/script>/);
  assert.match(entrySource, /from '\.\/queue-render\.js';/);
  assert.match(entrySource, /from '\.\/queue-scroll\.js';/);
});

test('illustrated queues use one contain scale for width- and height-limited browser sources', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  assert.equal(sandbox.calculateIllustratedQueueScale(1920, 1080, 560, 840, 16), 1);
  assert.equal(
    sandbox.calculateIllustratedQueueScale(400, 900, 560, 840, 16),
    368 / 560
  );
  assert.equal(
    sandbox.calculateIllustratedQueueScale(900, 457, 560, 840, 16),
    425 / 840
  );

  const appliedStyles = new Map();
  const panel = {
    offsetWidth: 560,
    offsetHeight: 840,
    ownerDocument: {
      documentElement: { clientWidth: 400, clientHeight: 900 },
      defaultView: {
        innerWidth: 400,
        innerHeight: 900,
        getComputedStyle() {
          return { marginLeft: '8px', marginTop: '8px' };
        }
      }
    },
    style: {
      setProperty(name, value) { appliedStyles.set(name, value); },
      removeProperty(name) { appliedStyles.delete(name); }
    }
  };
  assert.equal(sandbox.syncIllustratedQueueViewport(panel, true), 384 / 560);
  assert.equal(appliedStyles.get('--illustrated-queue-scale'), String(384 / 560));
  sandbox.syncIllustratedQueueViewport(panel, false);
  assert.equal(appliedStyles.has('--illustrated-queue-scale'), false);

  const storybookRule = overlayCss.match(/\.queue-storybook\s*\{[^}]*\}/)?.[0];
  const illustratedRule = overlayCss.match(/\.queue-neon-vinyl,\s*\.queue-cherry-ribbon,\s*\.queue-golden-lily\s*\{[^}]*\}/)?.[0];
  assert.ok(storybookRule);
  assert.ok(illustratedRule);
  [storybookRule, illustratedRule].forEach((rule) => {
    assert.match(rule, /width:\s*560px/);
    assert.match(rule, /transform:\s*scale\(var\(--illustrated-queue-scale,\s*1\)\)/);
    assert.match(rule, /transform-origin:\s*top left/);
    assert.doesNotMatch(rule, /100vw/);
  });
  assert.match(source, /syncIllustratedQueueViewport\(panel,\s*ILLUSTRATED_QUEUE_STYLES\.has\(style\)\)/);
  assert.match(source, /function handleQueueViewportResize\(\)[\s\S]*syncQueueViewport\(normalizeQueueStyle/);
});

test('illustrated frame decorations sandwich queue cards above the center fill', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const backgroundRule = [...overlayCss.matchAll(/\.queue-neon-vinyl::before,[\s\S]*?\.queue-golden-lily::before\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .find((rule) => /z-index:\s*0/.test(rule));
  const foregroundRule = [...overlayCss.matchAll(/\.queue-neon-vinyl::after,[\s\S]*?\.queue-golden-lily::after\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .find((rule) => /z-index:\s*3/.test(rule));
  const contentRule = overlayCss.match(/\.queue-neon-vinyl \.overlay-content,[\s\S]*?\.queue-golden-lily \.overlay-content\s*\{[^}]*\}/)?.[0];

  assert.ok(backgroundRule);
  assert.ok(foregroundRule);
  assert.ok(contentRule);
  assert.match(backgroundRule, /z-index:\s*0/);
  assert.match(contentRule, /z-index:\s*2/);
  assert.match(foregroundRule, /z-index:\s*3/);
  assert.match(foregroundRule, /border-style:\s*solid/);

  for (const style of ['neon-vinyl', 'cherry-ribbon', 'golden-lily']) {
    const background = [...overlayCss.matchAll(new RegExp(`\\.queue-${style}::before\\s*\\{[^}]*\\}`, 'g'))]
      .map((match) => match[0])
      .find((rule) => /background:/.test(rule));
    const foreground = [...overlayCss.matchAll(new RegExp(`\\.queue-${style}::after\\s*\\{[^}]*\\}`, 'g'))]
      .map((match) => match[0])
      .find((rule) => /border-image-source:/.test(rule));
    assert.ok(background, `${style} needs a full-frame background layer`);
    assert.ok(foreground, `${style} needs a decorative foreground layer`);
    assert.match(background, /background:\s*url\('[^']+\/frame\.webp'\) center \/ 100% 100% no-repeat/);
    assert.match(foreground, /border-image-source:\s*url\('[^']+\/frame\.webp'\)/);
    assert.match(foreground, /border-image-slice:\s*[\d.% ]+/);
    assert.doesNotMatch(foreground, /\bfill\b/);
  }

  assert.match(source, /ILLUSTRATED_QUEUE_ROW_GAPS\s*=\s*\{[\s\S]*'golden-lily':\s*4/);
  assert.match(source, /const rowGap = ILLUSTRATED_QUEUE_ROW_GAPS\[style\]/);
});

test('illustrated queue cards display their full artwork without clipping decorations', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const expectedRows = {
    storybook: {
      aspectRatio: /aspect-ratio:\s*1237\s*\/\s*304/,
      backgroundSize: /background-size:\s*124\.171%\s+336\.842%/,
      backgroundPosition: /background-position:\s*44\.482%\s+45\.972%/
    },
    'neon-vinyl': {
      aspectRatio: /aspect-ratio:\s*2172\s*\/\s*450/,
      width: /width:\s*94%/,
      backgroundSize: /background-size:\s*100%\s+100%/
    },
    'cherry-ribbon': {
      aspectRatio: /aspect-ratio:\s*1623\s*\/\s*371\.2/,
      width: /width:\s*94%/,
      backgroundSize: /background-size:\s*100%\s+100%/
    },
    'golden-lily': {
      aspectRatio: /aspect-ratio:\s*2139\s*\/\s*490/,
      width: /width:\s*72%/,
      backgroundSize: /background-size:\s*100%\s+100%/
    }
  };

  for (const [style, expected] of Object.entries(expectedRows)) {
    const rowRule = overlayCss.match(new RegExp(`\\.${style}-row\\s*\\{[^}]*\\}`))?.[0];
    assert.ok(rowRule, `${style} needs a card layout rule`);
    assert.match(rowRule, expected.aspectRatio);
    if (expected.width) assert.match(rowRule, expected.width);
    assert.match(rowRule, expected.backgroundSize);
    assert.match(rowRule, /min-height:\s*0/);
    assert.doesNotMatch(rowRule, /height:\s*clamp\(/);
    assert.doesNotMatch(rowRule, /background-size:\s*[^;]*\bauto\b/);
    if (expected.backgroundPosition) {
      assert.match(rowRule, expected.backgroundPosition);
    }
  }
});

test('style 4 keeps its frame height and displays compressed full entries', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const frameRule = overlayCss.match(/\.queue-neon-vinyl\s*\{[^}]*\}/)?.[0];
  const rowRule = overlayCss.match(/\.neon-vinyl-row\s*\{[^}]*\}/)?.[0];

  assert.ok(frameRule);
  assert.ok(rowRule);
  assert.match(frameRule, /aspect-ratio:\s*1122\s*\/\s*1402/);
  assert.match(rowRule, /width:\s*94%/);
  assert.match(rowRule, /aspect-ratio:\s*2172\s*\/\s*450/);
  assert.match(rowRule, /background-size:\s*100%\s+100%/);
  assert.doesNotMatch(rowRule, /\bcover\b|\bcontain\b/);
});

test('style 5 displays full entries at 80% height', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const rowRule = overlayCss.match(/\.cherry-ribbon-row\s*\{[^}]*\}/)?.[0];

  assert.ok(rowRule);
  assert.match(rowRule, /width:\s*94%/);
  assert.match(rowRule, /aspect-ratio:\s*1623\s*\/\s*371\.2/);
  assert.match(rowRule, /background-size:\s*100%\s+100%/);
  assert.doesNotMatch(rowRule, /\bcover\b|\bcontain\b/);
});

test('style 6 reveals the first entry decoration and separates adjacent entries', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const contentRule = overlayCss.match(/\.queue-golden-lily \.overlay-content\s*\{(?=[^}]*inset:)[^}]*\}/)?.[0];
  const listRule = overlayCss.match(/\.golden-lily-list\.identity-list\s*\{[^}]*\}/)?.[0];

  assert.ok(contentRule);
  assert.ok(listRule);
  assert.match(contentRule, /inset:\s*16\.5%\s+8\.5%\s+13\.5%/);
  assert.match(listRule, /gap:\s*4px/);
  assert.doesNotMatch(overlayCss, /\.golden-lily-row:not\(:first-child\)\s*\{[^}]*margin-top:\s*-[\d.]+px/);
  assert.match(source, /renderIllustratedAssetQueue\(settings, current, waiting, content, 'golden-lily', 4, renderGoldenLilyRow\)/);
  assert.match(source, /ILLUSTRATED_QUEUE_ROW_GAPS\s*=\s*\{[\s\S]*'golden-lily':\s*4/);
});

test('classic queue starts at its fixed size and follows a resized browser source', () => {
  const adminHtml = readAdminHtml();
  const themeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const queueSource = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
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
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
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
