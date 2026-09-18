'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ADMIN_FRAGMENT_PATHS,
  composeAdminHtml,
  isAdminPageRoute,
} = require('../src/server/admin-page');
const { servePageOrAsset } = require('../src/server/http-utils');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

test('admin routes use one explicit ordered fragment composition', () => {
  assert.deepEqual(
    ['/', '/admin', '/settings', '/songs'].map(isAdminPageRoute),
    [true, true, true, true],
  );
  assert.equal(isAdminPageRoute('/queue'), false);
  assert.ok(Object.isFrozen(ADMIN_FRAGMENT_PATHS));
  assert.equal(ADMIN_FRAGMENT_PATHS[0], 'pages/admin/shell-start.html');
  assert.equal(ADMIN_FRAGMENT_PATHS.at(-1), 'pages/admin/document-end.html');
  assert.equal(
    fs.existsSync(path.join(PUBLIC_DIR, 'pages', 'admin.html')),
    false,
  );
});

test('admin composition expands the complete danmaku AI subfragment in place', () => {
  const parentPath = 'pages/admin/toolbox/danmaku.html';
  const aiPath = 'pages/admin/toolbox/danmaku-ai.html';
  const parent = fs.readFileSync(path.join(PUBLIC_DIR, parentPath), 'utf8');

  assert.match(
    parent,
    /<!-- admin-fragment: pages\/admin\/toolbox\/danmaku-ai\.html -->/,
  );
  assert.doesNotMatch(parent, /id="xiaomiAiSection"/);
  assert.equal(ADMIN_FRAGMENT_PATHS.includes(aiPath), false);

  const ai = fs.readFileSync(path.join(PUBLIC_DIR, aiPath), 'utf8');
  assert.match(ai, /^\s*<section\b[^>]*id="xiaomiAiSection"/);
  assert.match(ai, /<form id="xiaomiAiForm"/);
  assert.match(ai, /<\/section>\s*$/);

  const html = composeAdminHtml(PUBLIC_DIR);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
  assert.ok(html.indexOf('id="danmakuSendForm"') < html.indexOf(ai.trim()));
  assert.ok(
    html.indexOf(ai.trim()) < html.indexOf('id="danmakuFixedReplyTitle"'),
  );
});

test('admin composition expands complete desktop lyric regions in order', () => {
  const parentPath = 'pages/admin/song/desktop-lyric.html';
  const fragmentPaths = [
    'pages/admin/song/desktop-lyric-appearance.html',
    'pages/admin/song/desktop-lyric-behavior.html',
    'pages/admin/song/desktop-lyric-layout.html',
    'pages/admin/song/desktop-lyric-rendering.html',
    'pages/admin/song/desktop-lyric-preview.html',
  ];
  const parent = fs.readFileSync(path.join(PUBLIC_DIR, parentPath), 'utf8');
  const markers = Array.from(
    parent.matchAll(/<!-- admin-fragment: ([^ ]+\.html) -->/g),
    (match) => match[1],
  );

  assert.deepEqual(markers, fragmentPaths);
  assert.match(parent, /^\s*<div id="desktopLyricPage"[\s\S]*<\/div>\s*$/);
  assert.doesNotMatch(
    parent,
    /is-basic|is-effect|is-content|is-visibility|is-layout|is-render|id="desktopLyricLivePreview"/,
  );
  for (const fragmentPath of fragmentPaths) {
    assert.equal(ADMIN_FRAGMENT_PATHS.includes(fragmentPath), false);
  }

  const fragments = fragmentPaths.map((fragmentPath) =>
    fs.readFileSync(path.join(PUBLIC_DIR, fragmentPath), 'utf8'),
  );
  assert.match(
    fragments[0],
    /^\s*<details\b[^>]*is-basic[\s\S]*is-effect[\s\S]*<\/details>\s*$/,
  );
  assert.match(
    fragments[1],
    /^\s*<details\b[^>]*is-content[\s\S]*is-visibility[\s\S]*<\/details>\s*$/,
  );
  assert.match(
    fragments[2],
    /^\s*<details\b[^>]*is-layout[\s\S]*<\/details>\s*$/,
  );
  assert.match(
    fragments[3],
    /^\s*<details\b[^>]*is-render[\s\S]*desktopLyricResetBtn[\s\S]*<\/section>\s*$/,
  );
  assert.match(
    fragments[4],
    /^\s*<section\b[^>]*id="desktopLyricLivePreview"[\s\S]*<\/section>\s*$/,
  );

  const html = composeAdminHtml(PUBLIC_DIR);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
  let previousIndex = html.indexOf(
    'class="theme-section desktop-lyric-source-settings"',
  );
  for (const fragment of fragments) {
    const index = html.indexOf(fragment.trim());
    assert.ok(index > previousIndex);
    previousIndex = index;
  }
  for (const source of [parent, ...fragments]) {
    assert.ok(source.trimEnd().split(/\r?\n/).length < 800);
  }
});

test('composed admin page is complete, ordered, and has unique ids', () => {
  const html = composeAdminHtml(PUBLIC_DIR);
  const shellStart = fs.readFileSync(
    path.join(PUBLIC_DIR, 'pages/admin/shell-start.html'),
    'utf8',
  );
  const songShellStart = fs.readFileSync(
    path.join(PUBLIC_DIR, 'pages/admin/song/shell-start.html'),
    'utf8',
  );
  const toolboxShellStart = fs.readFileSync(
    path.join(PUBLIC_DIR, 'pages/admin/toolbox/shell-start.html'),
    'utf8',
  );

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.match(shellStart, /<\/header>\s*$/);
  assert.match(songShellStart, /<\/button>\s*<\/div>\s*$/);
  assert.match(toolboxShellStart, /<div class="other-feature-content">\s*$/);
  assert.ok(
    html.indexOf('id="songAssistantPage"') <
      html.indexOf('id="giftAssistantPage"'),
  );
  assert.ok(
    html.indexOf('id="giftAssistantPage"') <
      html.indexOf('id="otherAssistantPage"'),
  );
  assert.ok(
    html.indexOf('id="otherAssistantPage"') <
      html.indexOf('id="playbackAssistantPage"'),
  );
  for (const pageId of [
    'songAssistantPage',
    'giftAssistantPage',
    'otherAssistantPage',
    'playbackAssistantPage',
  ]) {
    assert.ok(html.indexOf(`id="${pageId}"`) < html.indexOf('</main>'));
  }
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  assert.equal((html.match(/<\/body>/g) || []).length, 1);
  assert.equal((html.match(/<\/html>/g) || []).length, 1);
  assert.ok(
    html.indexOf('/js/admin/index.js') < html.indexOf('/js/playback.js'),
  );

  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicateIds)], []);
});

test('HTTP admin routes compose after authentication without a legacy page mapping', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'server', 'http-utils.js'),
    'utf8',
  );

  assert.match(source, /require\('\.\/admin-page'\)/);
  assert.match(source, /isAdminPageRoute\(requestUrl\.pathname\)/);
  assert.match(source, /composeAdminHtml\(publicDir\)/);
  assert.doesNotMatch(
    source,
    /\[['"]\/(?:admin|settings|songs)?['"],\s*['"]pages\/admin\.html['"]\]/,
  );
});

test('authenticated admin routes never expose credentials to the composed document', () => {
  for (const pathname of ['/', '/admin', '/settings', '/songs']) {
    let status;
    let headers = {};
    let body;
    const response = {
      setHeader(name, value) {
        headers[name] = value;
      },
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = { ...headers, ...nextHeaders };
      },
      end(nextBody) {
        body = nextBody;
      },
    };

    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET', headers: { authorization: 'Bearer test-token' } },
      response,
      new URL(`http://127.0.0.1${pathname}`),
      'test-token',
    );

    const html = body.toString('utf8');
    assert.equal(status, 200);
    assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
    assert.doesNotMatch(html, /window\.__API_TOKEN__|test-token|lira-overlay-bootstrap/);
    assert.match(html, /<script type="module" src="\/js\/admin\/index\.js/);
    assert.match(html, /id="wheelCardResult"/);
  }
});

test('admin pages include frame protection headers', () => {
  for (const pathname of ['/', '/admin', '/settings', '/songs']) {
    let headers = {};
    const response = {
      setHeader(name, value) {
        headers[name] = value;
      },
      writeHead(status, nextHeaders) {
        headers = { ...headers, ...nextHeaders };
      },
      end() {},
    };

    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET', headers: { authorization: 'Bearer test-token' } },
      response,
      new URL(`http://127.0.0.1${pathname}`),
      'test-token',
    );

    assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'; worker-src 'none'");
    assert.equal(headers['X-Frame-Options'], 'DENY');
  }
});

test('overlay pages allow embedding while sandboxing their scripts', async () => {
  const overlayPaths = [
    '/queue',
    '/songlist',
    '/blindbox',
    '/overtime',
    '/gift-effects',
    '/lyrics',
    '/games',
    '/wheel',
    '/opening',
    '/danmaku',
    '/clock',
  ];

  for (const pathname of overlayPaths) {
    let status;
    let headers = {};
    const body = await new Promise((resolve) => {
      const response = {
        setHeader(name, value) {
          headers[name] = value;
        },
        writeHead(nextStatus, nextHeaders) {
          status = nextStatus;
          headers = { ...headers, ...nextHeaders };
        },
        end: resolve,
      };

      servePageOrAsset(
        PUBLIC_DIR,
        { method: 'GET', headers: { authorization: 'Bearer test-token' } },
        response,
        new URL(`http://127.0.0.1${pathname}`),
        'test-token',
      );
    });

    assert.equal(status, 200, pathname);
    assert.equal(headers['Content-Type'], 'text/html; charset=utf-8', pathname);
    const html = body.toString('utf8');
    assert.match(html, /<!doctype html>/i, pathname);
    assert.match(html, /<\/html>\s*$/, pathname);
    assert.equal(headers['Content-Security-Policy'], 'sandbox allow-scripts', pathname);
    assert.equal(headers['X-Frame-Options'], undefined, pathname);
  }
});
