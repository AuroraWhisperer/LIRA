'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('../helpers/css-bundle');
const { readJsModuleBundle: readRawJsModuleBundle } = require('../helpers/js-module-bundle');

const ROOT_DIR = path.join(__dirname, '../..');

function readJsModuleBundle(...relativeSegments) {
  return readRawJsModuleBundle(...relativeSegments).replace(
    /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm,
    '',
  );
}

test('overlay base styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');

  assert.match(entry, /@import url\('\.\/base\/identity\.css'\);/);
});

test('queue overlay loads one focused module entrypoint', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'queue.html'), 'utf8');
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/overlays\/queue\.js\?v=[^"]+"><\/script>/);
  assert.match(entrySource, /from '\.\/queue-render\.js';/);
  assert.match(entrySource, /from '\.\/queue-scroll\.js';/);
});

test('queue styles use contain scaling while identity never grows beyond 100%', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {},
  };
  vm.runInNewContext(source, sandbox);

  assert.equal(sandbox.calculateQueuePanelScale(1920, 1080, 560, 840, 16), 1048 / 840);
  assert.equal(sandbox.calculateQueuePanelScale(400, 900, 560, 840, 16), 368 / 560);
  assert.equal(sandbox.calculateQueuePanelScale(900, 457, 560, 840, 16), 425 / 840);

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
        },
      },
    },
    style: {
      setProperty(name, value) {
        appliedStyles.set(name, value);
      },
      removeProperty(name) {
        appliedStyles.delete(name);
      },
    },
  };
  panel.ownerDocument.documentElement.style = { getPropertyValue: () => '' };
  panel.ownerDocument.defaultView.document = panel.ownerDocument;
  assert.equal(sandbox.syncQueuePanelViewport(panel), 384 / 560);
  assert.equal(appliedStyles.get('--queue-panel-scale'), String(384 / 560));

  const classicRule = overlayCss.match(/\.queue-classic\s*\{[^}]*\}/)?.[0];
  const identityRule = overlayCss.match(/\.queue-identity\s*\{[^}]*\}/)?.[0];
  const storybookRule = overlayCss.match(/\.queue-storybook\s*\{[^}]*\}/)?.[0];
  const illustratedRule = overlayCss.match(
    /\.queue-neon-vinyl,\s*\.queue-cherry-ribbon,\s*\.queue-golden-lily\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(classicRule);
  assert.ok(identityRule);
  assert.ok(storybookRule);
  assert.ok(illustratedRule);
  for (const rule of [classicRule, identityRule, storybookRule, illustratedRule]) {
    assert.ok(Number(rule.match(/\bwidth:\s*([\d.]+)px/)?.[1]) > 0, 'panels need a fixed design width');
  }
  [classicRule, storybookRule, illustratedRule].forEach((rule) => {
    assert.match(rule, /transform:\s*scale\(var\(--queue-panel-scale,\s*1\)\)/);
    assert.match(rule, /transform-origin:\s*top left/);
    assert.doesNotMatch(rule, /100vw/);
  });
  assert.match(identityRule, /transform:\s*scale\(min\(var\(--queue-panel-scale,\s*1\),\s*1\)\)/);
  assert.match(identityRule, /transform-origin:\s*top left/);
  assert.doesNotMatch(identityRule, /100vw/);
  assert.match(source, /syncQueuePanelViewport\(panel\)/);
  assert.match(source, /function handleQueueViewportResize\(\)[\s\S]*syncQueueViewport\(\)/);
});

test('illustrated frame decorations sandwich queue cards above the center fill', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const backgroundRule = [
    ...overlayCss.matchAll(/\.queue-neon-vinyl::before,[\s\S]*?\.queue-golden-lily::before\s*\{[^}]*\}/g),
  ]
    .map((match) => match[0])
    .find((rule) => /z-index:/.test(rule));
  const foregroundRule = [
    ...overlayCss.matchAll(/\.queue-neon-vinyl::after,[\s\S]*?\.queue-golden-lily::after\s*\{[^}]*\}/g),
  ]
    .map((match) => match[0])
    .find((rule) => /z-index:/.test(rule));
  const contentRule = overlayCss.match(
    /\.queue-neon-vinyl \.overlay-content,[\s\S]*?\.queue-golden-lily \.overlay-content\s*\{[^}]*\}/,
  )?.[0];

  assert.ok(backgroundRule);
  assert.ok(foregroundRule);
  assert.ok(contentRule);
  const backgroundZ = Number(backgroundRule.match(/z-index:\s*(-?\d+)/)?.[1]);
  const contentZ = Number(contentRule.match(/z-index:\s*(-?\d+)/)?.[1]);
  const foregroundZ = Number(foregroundRule.match(/z-index:\s*(-?\d+)/)?.[1]);
  assert.ok(backgroundZ < contentZ && contentZ < foregroundZ, 'queue cards must sit between the artwork layers');
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
    assert.match(
      background,
      /background:\s*url\(\s*['"][^'"]+\/frame\.webp['"]\s*\)\s*center\s*\/\s*100%\s+100%\s+no-repeat/,
    );
    assert.match(foreground, /border-image-source:\s*url\(\s*['"][^'"]+\/frame\.webp['"]\s*\)/);
    assert.match(foreground, /border-image-slice:\s*[\d.% ]+/);
    assert.doesNotMatch(foreground, /\bfill\b/);
  }
});

test('illustrated queue cards display their full artwork without clipping decorations', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const expectedRows = {
    storybook: {
      aspectRatio: /aspect-ratio:\s*1237\s*\/\s*304/,
    },
    'neon-vinyl': {
      aspectRatio: /aspect-ratio:\s*2172\s*\/\s*517\.5/,
      backgroundSize: /background-size:\s*100%\s+100%/,
    },
    'cherry-ribbon': {
      aspectRatio: /aspect-ratio:\s*1623\s*\/\s*371\.2/,
      backgroundSize: /background-size:\s*100%\s+100%/,
    },
    'golden-lily': {
      aspectRatio: /aspect-ratio:\s*2139\s*\/\s*539/,
      backgroundSize: /background-size:\s*100%\s+100%/,
    },
  };

  for (const [style, expected] of Object.entries(expectedRows)) {
    const rowRule = overlayCss.match(new RegExp(`\\.${style}-row\\s*\\{[^}]*\\}`))?.[0];
    assert.ok(rowRule, `${style} needs a card layout rule`);
    assert.match(rowRule, expected.aspectRatio);
    if (expected.backgroundSize) assert.match(rowRule, expected.backgroundSize);
    assert.match(rowRule, /min-height:\s*0/);
    assert.doesNotMatch(rowRule, /height:\s*clamp\(/);
    assert.doesNotMatch(rowRule, /background-size:\s*[^;]*\bauto\b/);
  }
});

test('style 4 keeps its original frame proportions', () => {
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const frameRule = overlayCss.match(/\.queue-neon-vinyl\s*\{[^}]*\}/)?.[0];

  assert.ok(frameRule);
  assert.match(frameRule, /aspect-ratio:\s*1122\s*\/\s*1402/);
});

test('style 6 wires its row renderer without overlapping adjacent entries', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  assert.doesNotMatch(overlayCss, /\.golden-lily-row:not\(:first-child\)\s*\{[^}]*margin-top:\s*-[\d.]+px/);
  assert.match(
    source,
    /renderIllustratedAssetQueue\(\s*settings\s*,\s*current\s*,\s*waiting\s*,\s*content\s*,\s*['"]golden-lily['"]\s*,\s*[^,]+,\s*renderGoldenLilyRow\s*,?\s*\)/,
  );
});

test('classic queue keeps fixed design coordinates while the whole panel scales', () => {
  const queueSource = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  assert.doesNotMatch(queueSource, /visibleRows\s*=\s*6|queueFixedSixRows|--classic-window-height/);
  const windowRule = overlayCss.match(/\.classic-list-window\s*\{[^}]*\}/)?.[0];
  const height = Number(windowRule?.match(/(?:^|[;{])\s*height:\s*([\d.]+)px/)?.[1]);
  const maxHeight = Number(windowRule?.match(/max-height:\s*([\d.]+)px/)?.[1]);
  assert.ok(height > 0);
  assert.equal(maxHeight, height, 'the viewport should keep its design height while the panel scales');
  assert.doesNotMatch(overlayCss, /--classic-window-height/);
  assert.doesNotMatch(queueSource, /Math\.min\(6,/);
  assert.match(queueSource, /window\.addEventListener\('resize', handleQueueViewportResize\)/);
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
      getElementById() {
        return { textContent: '' };
      },
      documentElement: {
        clientHeight: 700,
        style: {
          setProperty(name, value) {
            styleValues.set(name, value);
          },
        },
      },
    },
  };
  sandbox.window = { innerHeight: 700 };
  vm.runInNewContext(source, sandbox);

  const shortClasses = new Set(['classic-list', 'paused']);
  const shortViewport = {
    clientHeight: 235,
    style: {},
    getBoundingClientRect: () => ({ top: 100 }),
  };
  const shortList = {
    scrollHeight: 230,
    classList: {
      add(name) {
        shortClasses.add(name);
      },
      remove(name) {
        shortClasses.delete(name);
      },
    },
    insertAdjacentHTML() {
      assert.fail('rows that fit must not be duplicated');
    },
  };

  assert.equal(sandbox.configureClassicVerticalScroll(shortViewport, shortList, {}, '', 5), false);
  assert.equal(shortViewport.style.height, undefined);
  assert.equal(shortViewport.style.maxHeight, undefined);
  assert.equal(shortClasses.has('scrolling'), false);

  const longClasses = new Set(['classic-list', 'paused']);
  let duplicatedHtml = '';
  const longViewport = {
    clientHeight: 235,
    style: {},
    getBoundingClientRect: () => ({ top: 100 }),
  };
  const longList = {
    scrollHeight: 900,
    classList: {
      add(name) {
        longClasses.add(name);
      },
      remove(name) {
        longClasses.delete(name);
      },
    },
    insertAdjacentHTML(_position, html) {
      duplicatedHtml += html;
    },
  };
  const settings = { queueScrollMode: 'loop', queueScrollSpeed: '42' };

  assert.equal(sandbox.configureClassicVerticalScroll(longViewport, longList, settings, '<div>rows</div>', 5), true);
  assert.equal(styleValues.get('--classic-loop-distance'), '905px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.window.OverlayUtils.scrollTravelSeconds(sandbox.queueScrollSeconds(settings), 905, 235)}s`,
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(longClasses.has('paused'), false);
  assert.equal(longClasses.has('scrolling'), true);
});

test('identity queue keeps fixed design coordinates and never grows beyond its default canvas', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayCss = readCssBundle('public', 'css', 'overlays', 'base.css');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: {
      addEventListener() {},
      getElementById() {
        return { textContent: '' };
      },
      documentElement: {
        clientHeight: 500,
        style: { setProperty() {} },
      },
    },
  };
  sandbox.window = { innerHeight: 500 };
  vm.runInNewContext(source, sandbox);

  const identityWindowRule = overlayCss.match(/\.identity-list-window\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(identityWindowRule);
  const height = Number(identityWindowRule.match(/(?:^|[;{])\s*height:\s*([\d.]+)px/)?.[1]);
  const maxHeight = Number(identityWindowRule.match(/max-height:\s*([\d.]+)px/)?.[1]);
  assert.ok(height > 0);
  assert.equal(maxHeight, height);

  const classes = new Set(['identity-list', 'paused']);
  const viewport = {
    clientHeight: 364,
    style: {},
    parentElement: null,
    getBoundingClientRect: () => ({ top: 40 }),
  };
  const list = {
    scrollHeight: 240,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
    },
    insertAdjacentHTML() {
      assert.fail('bounce mode must not duplicate rows');
    },
  };
  const settings = {
    queueScrollMode: 'bounce',
    identityQueueScrollSpeed: '42',
  };

  assert.equal(sandbox.configureIdentityVerticalScroll(viewport, list, settings, '<div>rows</div>', 4), false);
  assert.equal(viewport.style.height, undefined);
  assert.equal(viewport.style.maxHeight, undefined);
  assert.equal(classes.has('scrolling-bounce'), false);
});
