'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ADMIN_FRAGMENT_PATHS, composeAdminHtml, isAdminPageRoute, readAdminFragment } = require('../../src/server/admin-page');
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

test('nested admin fragments reject circular includes with the source paths', (t) => {
  assert.throws(
    () =>
      composeFixture(t, {
        'pages/admin/shell-start.html': '<!-- admin-fragment: pages/admin/toolbox/chapter.html -->',
        'pages/admin/toolbox/chapter.html': '<!-- admin-fragment: pages/admin/toolbox/topic.html -->',
        'pages/admin/toolbox/topic.html': '<!-- admin-fragment: pages/admin/toolbox/chapter.html -->',
      }),
    /Circular admin fragment: .*chapter\.html -> .*topic\.html -> .*chapter\.html/,
  );
});

test('admin routes use one explicit ordered fragment composition', () => {
  assert.deepEqual(['/', '/admin', '/settings', '/songs'].map(isAdminPageRoute), [true, true, true, true]);
  assert.equal(isAdminPageRoute('/queue'), false);
  assert.ok(Object.isFrozen(ADMIN_FRAGMENT_PATHS));
  assert.equal(ADMIN_FRAGMENT_PATHS[0], 'pages/admin/shell-start.html');
  assert.equal(ADMIN_FRAGMENT_PATHS.at(-1), 'pages/admin/document-end.html');
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'pages', 'admin.html')), false);
});

test('live components own unique panels while danmaku interaction stays in the toolbox', () => {
  const components = readAdminFragment(PUBLIC_DIR, 'pages/admin/live-components/page.html');
  const toolbox = readAdminFragment(PUBLIC_DIR, 'pages/admin/toolbox/shell-start.html');
  const html = composeAdminHtml(PUBLIC_DIR);
  const ids = ['liveDanmakuFeature', 'otherGiftFeature', 'giftDisplayFeature', 'giftWishesFeature', 'giftSprintFeature', 'giftBlindboxFeature', 'guardThanksFeature', 'otherTextBoxFeature',
    'otherOvertimeMachineFeature', 'otherStartAnimationFeature', 'otherClockFeature'];
  for (const id of ids) {
    assert.match(components, new RegExp(`data-other-feature="${id}"`));
    assert.match(components, new RegExp(`id="${id}"`));
    assert.equal(html.split(`id="${id}"`).length, 2, `${id} renders once`);
    assert.doesNotMatch(toolbox, new RegExp(`data-other-feature="${id}"`));
  }
  assert.equal((components.match(/data-other-feature-panel\b/g) || []).length, ids.length);
  for (const id of ['giftSprintForm', 'giftSprintOverlayPanel', 'blindboxOverlayTitle', 'blindboxPreviewBtn']) {
    assert.equal(html.split(`id="${id}"`).length, 2, `${id} renders once`);
    assert.match(components, new RegExp(`id="${id}"`));
    assert.doesNotMatch(readAdminFragment(PUBLIC_DIR, 'pages/admin/gifts/page.html'), new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(components, /id="danmakuSendForm"|id="xiaomiAiSection"/);
  assert.match(toolbox, /data-other-feature="otherDanmakuFeature"/);
  assert.match(toolbox, /<strong>弹幕互动<\/strong>/);
});

test('admin composition expands the complete danmaku AI subfragment in place', () => {
  const parentPath = 'pages/admin/toolbox/danmaku.html';
  const aiPath = 'pages/admin/toolbox/danmaku-ai.html';
  const parent = fs.readFileSync(path.join(PUBLIC_DIR, parentPath), 'utf8');

  assert.match(parent, /<!-- admin-fragment: pages\/admin\/toolbox\/danmaku-ai\.html -->/);
  assert.doesNotMatch(parent, /id="xiaomiAiSection"/);
  assert.equal(ADMIN_FRAGMENT_PATHS.includes(aiPath), false);

  const ai = fs.readFileSync(path.join(PUBLIC_DIR, aiPath), 'utf8');
  assert.match(ai, /^\s*<section\b[^>]*id="xiaomiAiSection"/);
  assert.match(ai, /<form id="xiaomiAiForm"/);
  assert.match(ai, /<\/section>\s*$/);

  const html = composeAdminHtml(PUBLIC_DIR);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
  assert.ok(html.indexOf('id="danmakuSendForm"') < html.indexOf(ai.trim()));
  assert.ok(html.indexOf(ai.trim()) < html.indexOf('id="danmakuFixedReplyTitle"'));
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
  const markers = Array.from(parent.matchAll(/<!-- admin-fragment: ([^ ]+\.html) -->/g), (match) => match[1]);

  assert.deepEqual(markers, fragmentPaths);
  assert.doesNotMatch(parent, /\sid=["']desktopLyricLivePreview["']/);
  for (const fragmentPath of fragmentPaths) {
    assert.equal(ADMIN_FRAGMENT_PATHS.includes(fragmentPath), false);
  }

  const fragments = fragmentPaths.map((fragmentPath) => fs.readFileSync(path.join(PUBLIC_DIR, fragmentPath), 'utf8'));

  const html = composeAdminHtml(PUBLIC_DIR);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = html.indexOf(fragment.trim());
    assert.ok(index > previousIndex);
    previousIndex = index;
  }
  for (const source of [parent, ...fragments]) {
    assert.ok(source.trimEnd().split(/\r?\n/).length < 800);
  }
});

test('admin composition matches guide chapters to its directory without duplicates', () => {
  const html = composeAdminHtml(PUBLIC_DIR);
  const chapterIds = [...html.matchAll(/<section\b(?=[^>]*\sclass=["'][^"']*\busage-guide-section\b)[^>]*>/g)]
    .map(([tag]) => tag.match(/\sid=["']([^"']+)["']/)?.[1]);
  const directory = html.match(/<nav\b(?=[^>]*\sclass=["'][^"']*\busage-guide-toc\b)[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(directory, 'the guide must expose its chapter directory');
  const linkIds = [...directory.matchAll(/<a\b(?=[^>]*\sdata-usage-guide-link(?:\s|>))[^>]*>/g)]
    .map(([tag]) => tag.match(/\shref=["']#([^"']+)["']/)?.[1]);
  assert.deepEqual(chapterIds, [
    'ug-setup', 'ug-song', 'ug-interactions', 'ug-gifts',
    'ug-scene-guide', 'ug-work', 'ug-maintenance', 'ug-faq',
  ]);
  assert.ok(chapterIds.every(Boolean));
  assert.equal(new Set(chapterIds).size, chapterIds.length);
  assert.deepEqual(linkIds, chapterIds);
  assert.doesNotMatch(html, /<!-- admin-fragment:/);
});

test('composed admin page is complete, ordered, and has unique ids', () => {
  const html = composeAdminHtml(PUBLIC_DIR);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>\s*$/);
  assert.ok(html.indexOf('id="songAssistantPage"') < html.indexOf('id="giftAssistantPage"'));
  assert.ok(html.indexOf('id="giftAssistantPage"') < html.indexOf('id="otherAssistantPage"'));
  assert.ok(html.indexOf('id="otherAssistantPage"') < html.indexOf('id="playbackAssistantPage"'));
  for (const pageId of ['songAssistantPage', 'giftAssistantPage', 'otherAssistantPage', 'playbackAssistantPage']) {
    assert.ok(html.indexOf(`id="${pageId}"`) < html.indexOf('</main>'));
  }
  assert.equal((html.match(/<\/main>/g) || []).length, 1);
  assert.equal((html.match(/<\/body>/g) || []).length, 1);
  assert.equal((html.match(/<\/html>/g) || []).length, 1);
  assert.ok(html.indexOf('/js/admin/index.js') < html.indexOf('/js/playback.js'));

  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicateIds)], []);
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
