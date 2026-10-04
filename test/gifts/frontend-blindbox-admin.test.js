'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('blind box analysis is a separate accessible workspace module', () => {
  const html = readAdminHtml();
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), 'utf8');
  const stylesEntry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis.js'), 'utf8');

  assert.match(entry, /import \{ giftAnalysis \} from '\.\/blindbox-analysis\.js';/);
  assert.match(stylesEntry, /admin\/blindbox-analysis\.css/);
  assert.match(html, /id="blindBoxAnalysisWorkspace"[^>]*role="region"[^>]*aria-labelledby="blindBoxAnalysisTitle"/);
  assert.doesNotMatch(html, /id="blindBoxAnalysisWorkspace"[^>]*aria-modal/);
  assert.match(html, /id="blindBoxAnalysisClose"[^>]*aria-label="关闭盲盒分析"/);
  assert.match(html, /id="blindBoxAnalysisViewer"/);
  assert.match(html, /id="blindBoxAnalysisBox"/);
  assert.match(html, /id="blindBoxAnalysisViewer"[^>]*aria-haspopup="listbox"/);
  assert.match(html, /id="blindBoxAnalysisViewerMenu"[^>]*role="listbox"/);
  assert.match(html, /id="blindBoxAnalysisBoxMenu"[^>]*role="listbox"/);
  assert.match(html, /data-blind-analysis-view="users"/);
  assert.match(html, /data-blind-analysis-view="boxes"/);
  assert.match(html, /data-blind-analysis-view="records"/);
  assert.match(html, /id="blindBoxAnalysisBody"/);
  assert.match(html, /id="blindBoxAnalysisPrev"/);
  assert.match(html, /id="blindBoxAnalysisNext"/);
  assert.match(source, /refreshIfOpen/);
  assert.match(source, /AbortController/);
  assert.match(source, /setTimeout/);
});

test('blind box analysis refreshes only for gift snapshot reasons', () => {
  const stateSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'), 'utf8');
  const analysisSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis.js'),
    'utf8',
  );

  assert.match(stateSource, /isGiftSnapshotReason\(payload\.reason\)/);
  assert.match(stateSource, /eventBus\.emit\(Events\.GIFT_RECEIVED/);
  assert.match(analysisSource, /eventBus\.on\(Events\.GIFT_RECEIVED, refreshIfOpen\)/);
  assert.doesNotMatch(analysisSource, /Events\.STATE_LOADED/);
});

test('blindbox controls publish current filters through the IPv4 source URL', async () => {
  const html = readAdminHtml();
  for (const id of ['blindboxWinnersOnly', 'blindboxHeartBoxOnly', 'blindboxOverlayTop', 'blindboxLiveLink']) {
    assert.equal([...html.matchAll(/\bid="([^"]+)"/g)].filter(([, value]) => value === id).length, 1, id);
  }
  const input = html.match(/<input\b(?=[^>]*\bid="blindboxOverlayTop")[^>]*>/)?.[0];
  assert.ok(input);
  for (const attribute of ['min="-1"', 'max="10"', 'value="3"']) assert.ok(input.includes(attribute), attribute);
  assert.match(html, /id="blindboxWinnersOnly"[^>]*checked/);

  const elements = {
    blindboxOverlayTop: { value: '' },
    blindboxOverlayTitle: { value: '  盲盒 & 观众  ' },
    blindboxWinnersOnly: { checked: true },
    blindboxHeartBoxOnly: { checked: true },
    blindboxOverlayUrl: {},
    blindboxLiveLink: {},
  };
  const { localOverlayOrigin } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/shared/utils.js'));
  const { createBlindboxSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/settings-blindbox.js'));
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements[id] },
    locationRef: { protocol: 'http:', hostname: 'localhost', port: '3012' },
    localOverlayOrigin,
    value: (id) => elements[id].value,
  });
  for (const top of ['', '-1', '0', '4', '10']) {
    elements.blindboxOverlayTop.value = top;
    settings.updateOverlayUrl();
    const url = new URL(elements.blindboxLiveLink.href);
    assert.equal(url.origin, 'http://127.0.0.1:3012');
    assert.equal(url.pathname, '/blindbox');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      ...(top === '' ? {} : { top }), title: '盲盒 & 观众', winners: '1', heartBox: '1',
    });
    assert.equal(elements.blindboxOverlayUrl.textContent, url.href);
  }
  elements.blindboxOverlayTop.value = '';
  elements.blindboxOverlayTitle.value = '';
  elements.blindboxWinnersOnly.checked = false;
  elements.blindboxHeartBoxOnly.checked = false;
  assert.equal(settings.buildOverlayUrl(), 'http://127.0.0.1:3012/blindbox');
});
