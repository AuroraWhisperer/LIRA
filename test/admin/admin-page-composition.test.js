'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ADMIN_FRAGMENT_PATHS, composeAdminHtml, isAdminPageRoute } = require('../../src/server/admin-page');
const { servePageOrAsset } = require('../../src/server/page-assets');

const ROOT_DIR = path.join(__dirname, '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

function composeFixture(t, fragments) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-admin-fragments-'));
  t.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));
  for (const relativePath of new Set([...ADMIN_FRAGMENT_PATHS, ...Object.keys(fragments)])) {
    const file = path.join(publicDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fragments[relativePath] || '');
  }
  return composeAdminHtml(publicDir);
}

test('nested admin fragments preserve order, repeated includes and the path allowlist', (t) => {
  const html = composeFixture(t, {
    'pages/admin/shell-start.html': '<main><!-- admin-fragment: pages/admin/toolbox/chapter.html -->',
    'pages/admin/toolbox/chapter.html':
      '<section><!-- admin-fragment: pages/admin/toolbox/topic.html --><!-- admin-fragment: pages/admin/toolbox/topic.html --></section>',
    'pages/admin/toolbox/topic.html': '<article>Topic</article><!-- admin-fragment: ../private.html -->',
    'pages/admin/document-end.html': '</main>',
  });
  assert.equal(
    html,
    '<main><section><article>Topic</article><!-- admin-fragment: ../private.html --><article>Topic</article><!-- admin-fragment: ../private.html --></section></main>',
  );
});

test('nested admin fragments reject circular includes', (t) => {
  assert.throws(
    () =>
      composeFixture(t, {
        'pages/admin/shell-start.html': '<!-- admin-fragment: pages/admin/toolbox/chapter.html -->',
        'pages/admin/toolbox/chapter.html': '<!-- admin-fragment: pages/admin/toolbox/topic.html -->',
        'pages/admin/toolbox/topic.html': '<!-- admin-fragment: pages/admin/toolbox/chapter.html -->',
      }),
    /Circular admin fragment/,
  );
});

test('admin routes recognize the supported page aliases', () => {
  assert.deepEqual(['/', '/admin', '/settings', '/songs'].map(isAdminPageRoute), [true, true, true, true]);
  assert.equal(isAdminPageRoute('/queue'), false);
});

test('composed admin page is complete and has unique ids', () => {
  const html = composeAdminHtml(PUBLIC_DIR);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  assert.equal((html.match(/<\/body>/g) || []).length, 1);
  assert.equal((html.match(/<\/html>/g) || []).length, 1);

  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicateIds)], []);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
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
