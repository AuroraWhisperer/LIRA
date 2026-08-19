'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ADMIN_FRAGMENT_PATHS,
  composeAdminHtml,
  isAdminPageRoute
} = require('../src/server/admin-page');
const { servePageOrAsset } = require('../src/server/http-utils');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

test('admin routes use one explicit ordered fragment composition', () => {
  assert.deepEqual(
    ['/', '/admin', '/settings', '/songs'].map(isAdminPageRoute),
    [true, true, true, true]
  );
  assert.equal(isAdminPageRoute('/queue'), false);
  assert.ok(Object.isFrozen(ADMIN_FRAGMENT_PATHS));
  assert.equal(ADMIN_FRAGMENT_PATHS[0], 'pages/admin/shell-start.html');
  assert.equal(ADMIN_FRAGMENT_PATHS.at(-1), 'pages/admin/document-end.html');
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'pages', 'admin.html')), false);
});

test('composed admin page is complete, ordered, and has unique ids', () => {
  const html = composeAdminHtml(PUBLIC_DIR);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.ok(html.indexOf('id="songAssistantPage"') < html.indexOf('id="giftAssistantPage"'));
  assert.ok(html.indexOf('id="giftAssistantPage"') < html.indexOf('id="otherAssistantPage"'));
  assert.ok(html.indexOf('id="otherAssistantPage"') < html.indexOf('id="playbackAssistantPage"'));
  assert.ok(html.indexOf('/js/admin/index.js') < html.indexOf('/js/playback.js'));

  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicateIds)], []);
});

test('HTTP admin routes compose before token injection without a legacy page mapping', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'http-utils.js'), 'utf8');

  assert.match(source, /require\('\.\/admin-page'\)/);
  assert.match(source, /isAdminPageRoute\(requestUrl\.pathname\)/);
  assert.match(source, /composeAdminHtml\(publicDir\)/);
  assert.doesNotMatch(source, /\[['"]\/(?:admin|settings|songs)?['"],\s*['"]pages\/admin\.html['"]\]/);
});

test('HTTP admin routes inject the token into the composed document', () => {
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
      }
    };

    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET' },
      response,
      new URL(`http://127.0.0.1${pathname}`),
      'test-token'
    );

    const html = body.toString('utf8');
    assert.equal(status, 200);
    assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
    assert.ok(html.indexOf('window.__API_TOKEN__') < html.indexOf('</head>'));
    assert.match(html, /var t="test-token"/);
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
      end() {}
    };

    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET' },
      response,
      new URL(`http://127.0.0.1${pathname}`),
      'test-token'
    );

    assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'none'");
    assert.equal(headers['X-Frame-Options'], 'DENY');
  }
});

test('overlay pages do not include frame protection headers', () => {
  const overlayPaths = ['/queue', '/songlist', '/blindbox', '/overtime', '/gift-effects', '/lyrics', '/games', '/wheel'];

  for (const pathname of overlayPaths) {
    let headers = {};
    const response = {
      setHeader(name, value) {
        headers[name] = value;
      },
      writeHead(status, nextHeaders) {
        headers = { ...headers, ...nextHeaders };
      },
      end() {}
    };

    servePageOrAsset(
      PUBLIC_DIR,
      { method: 'GET' },
      response,
      new URL(`http://127.0.0.1${pathname}`),
      'test-token'
    );

    assert.equal(headers['Content-Security-Policy'], undefined);
    assert.equal(headers['X-Frame-Options'], undefined);
  }
});
