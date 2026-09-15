'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

test('blind box analysis is a separate accessible workspace module', () => {
  const html = readAdminHtml();
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8',
  );
  const stylesEntry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'),
    'utf8',
  );
  const source = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'gifts',
      'blindbox-analysis.js',
    ),
    'utf8',
  );

  assert.match(entry, /import '\.\/gifts\/blindbox-analysis\.js';/);
  assert.match(stylesEntry, /admin\/blindbox-analysis\.css/);
  assert.match(
    html,
    /id="blindBoxAnalysisWorkspace"[^>]*role="region"[^>]*aria-labelledby="blindBoxAnalysisTitle"/,
  );
  assert.doesNotMatch(html, /id="blindBoxAnalysisWorkspace"[^>]*aria-modal/);
  assert.match(
    html,
    /id="blindBoxAnalysisClose"[^>]*aria-label="关闭盲盒分析"/,
  );
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
  const stateSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'),
    'utf8',
  );
  const analysisSource = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'gifts',
      'blindbox-analysis.js',
    ),
    'utf8',
  );

  assert.match(stateSource, /isGiftSnapshotReason\(payload\.reason\)/);
  assert.match(stateSource, /eventBus\.emit\(Events\.GIFT_RECEIVED/);
  assert.match(
    analysisSource,
    /eventBus\.on\(Events\.GIFT_RECEIVED, refreshIfOpen\)/,
  );
  assert.match(analysisSource, /REFRESH_DELAY_MS = 500/);
  assert.doesNotMatch(analysisSource, /Events\.STATE_LOADED/);
});

test('gift notifications detect delayed records that are not first in the list', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'),
    'utf8',
  );
  const toasts = [];
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: (value) => String(value),
          formatMoney: (value) => `¥${Number(value).toFixed(2)}`,
          showStackedToast: (options) => toasts.push(options),
        },
      },
    },
    document: {
      getElementById: () => ({ checked: true }),
    },
  };
  vm.runInNewContext(source, sandbox);
  const notify = sandbox.window.AdminApp.gifts.notification.notifyNewGift;
  const newestByTime = {
    id: 10,
    gift_id: '1',
    gift_name: 'Rose',
    user_name: 'Alice',
    num: 1,
    total_price: 1,
  };

  notify([newestByTime]);
  notify([
    newestByTime,
    {
      id: 11,
      gift_id: '2',
      gift_name: 'Delayed Gift',
      user_name: 'Bob',
      num: 1,
      total_price: 2,
    },
  ]);

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'gift:11');
  assert.match(toasts[0].html, /Delayed Gift/);
  assert.match(toasts[0].html, />¥2\.00<\/span>/);
  assert.doesNotMatch(toasts[0].html, /¥¥/);
});

test('admin overlay links always use the IPv4 loopback host and current port', () => {
  const html = readAdminHtml();
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    'utf8',
  );
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8',
  );
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.doesNotMatch(html, /localhost:3000\/blindbox/);
  assert.doesNotMatch(displaySource, /localhost:3000/);
  assert.doesNotMatch(settingsSource, /localhost:3000/);
  assert.doesNotMatch(
    displaySource,
    /replace\(['"]127\.0\.0\.1['"],\s*['"]localhost['"]\)/,
  );
  assert.match(
    utilitySource,
    /function localOverlayOrigin\(locationLike = location\)/,
  );
  assert.match(utilitySource, /127\.0\.0\.1/);
  assert.match(displaySource, /localOverlayOrigin\(location\)/);
  assert.match(settingsSource, /localOverlayOrigin\(locationRef\)/);
  assert.doesNotMatch(displaySource, /location\.origin/);
  assert.doesNotMatch(settingsSource, /location\.host/);
});

test('sprint and blindbox broadcast follow profit stats in reading order', () => {
  const html = readAdminHtml();
  const giftPageStart = html.indexOf('<section id="giftAssistantPage"');
  const statsStart = html.indexOf('class="panel gift-blindbox-panel"');
  const planningStart = html.indexOf('class="gift-planning-row"');
  const sprintStart = html.indexOf('class="panel gift-sprint-panel"');
  const broadcastStart = html.indexOf(
    'class="panel gift-blindbox-broadcast-panel"',
  );
  const mappingStart = html.indexOf(
    'class="panel gift-blindbox-mapping-panel"',
  );
  const overlayTabEnd = html.indexOf('<div id="importPage"');

  assert.ok(giftPageStart > -1);
  assert.ok(statsStart > giftPageStart);
  assert.ok(planningStart > statsStart);
  assert.ok(sprintStart > planningStart);
  assert.ok(broadcastStart > sprintStart);
  assert.ok(mappingStart > broadcastStart);
  assert.ok(html.indexOf('id="blindboxOverlayTitle"') > broadcastStart);
  assert.equal(
    html.slice(0, overlayTabEnd).includes('id="blindboxOverlayTitle"'),
    false,
  );
});

test('blindbox broadcast settings expose audience filters and one open action', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.match(html, /<span class="blindbox-broadcast-caption">观众画面<\/span>/);
  assert.match(
    html,
    /<h2 class="gift-section-title ui-section-title">盲盒盈亏榜<\/h2>/,
  );
  assert.match(html, /id="blindboxWinnersOnly"[^>]*checked/);
  assert.match(html, /id="blindboxHeartBoxOnly"/);
  assert.doesNotMatch(
    html,
    /blindboxCompact|blindboxNoScroll|blindboxLowPower|blindboxOpenUrlBtn/,
  );
  assert.equal((html.match(/>\s*打开画面\s*<\/a\s*>/g) || []).length, 1);
  assert.match(source, /liveLink\.href = url/);
  assert.match(source, /add\(\s*['"]heartBox['"]\s*,\s*['"]1['"]\s*\)/);
  assert.doesNotMatch(source, /add\("compact"|add\("noScroll"|add\("quality"/);
});

test('blind-box settings persist an explicit empty JSON array', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /config\.length\s*\?\s*JSON\.stringify\(config,[^)]+\)\s*:\s*''/,
  );
  assert.match(source, /const newRaw = JSON\.stringify\(config, null, 2\)/);
  assert.match(source, /let raw = textarea\.value\.trim\(\) \|\| '\[\]'/);
});

test('blindbox ranking count supports all, summary-only, and one-to-ten modes', () => {
  const html = readAdminHtml();
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    'utf8',
  );
  const overlaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'),
    'utf8',
  );
  const overlayStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'),
    'utf8',
  );

  assert.match(
    html,
    /<input\b(?=[^>]*\bid="blindboxOverlayTop")[^>]*\bmin="-1"[^>]*\bmax="10"[^>]*\bvalue="3"[^>]*>/s,
  );
  assert.match(html, /-1\s*显示全部，0\s*仅显示汇总，1\s*至 10\s*显示对应人数/);
  assert.match(
    settingsSource,
    /if\s*\(\s*top\s*!==\s*['"]['"]\s*\)\s*add\(\s*['"]top['"]\s*,\s*top\s*\)/,
  );
  assert.match(overlaySource, /param\('top', 't'\) \|\| '3'/);
  assert.match(overlaySource, /Math\.min\(10, Math\.max\(-1, requestedTop\)\)/);
  assert.match(overlaySource, /const SUMMARY_ONLY = TOP_N === 0/);
  assert.match(
    overlaySource,
    /if \(TOP_N > 0\)[\s\S]*?users = users\.slice\(0, TOP_N\)/,
  );
  assert.match(
    overlaySource,
    /if \(SUMMARY_ONLY\)[\s\S]*?leaderboard\.innerHTML = ''/,
  );
  assert.match(overlaySource, /HEART_BOX_ONLY/);
  assert.match(overlaySource, /boxName=.*心动盲盒/);
  assert.match(
    overlayStyles,
    /\.blindbox-panel\.summary-only \.blindbox-header[\s\S]*?display:\s*none/,
  );

  const readMode = (search) => {
    const sandbox = {
      URLSearchParams,
      location: { search },
      document: { addEventListener() {} },
    };
    const executableSource = overlaySource.replace(
      /^import\s+\{[^}]+\}\s+from\s+['"]\.\/[^'"]+['"];\s*/gm,
      '',
    );
    vm.runInNewContext(
      `${executableSource}\nthis.result = { top: TOP_N, summaryOnly: SUMMARY_ONLY };`,
      sandbox,
    );
    return { top: sandbox.result.top, summaryOnly: sandbox.result.summaryOnly };
  };

  assert.deepEqual(readMode('?top=-1'), { top: -1, summaryOnly: false });
  assert.deepEqual(readMode('?top=0'), { top: 0, summaryOnly: true });
  assert.deepEqual(readMode(''), { top: 3, summaryOnly: false });
  assert.deepEqual(readMode('?top=25'), { top: 10, summaryOnly: false });
});

test('blind box mapping cards use a purple default gradient and keep distinct known colors', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'gifts.css');

  const defaultCardRule = styles.match(/\.blind-box-chip\s*\{([^}]+)\}/)?.[1];
  assert.ok(defaultCardRule);
  assert.match(defaultCardRule, /border:\s*1px solid #d8c4ef/);
  assert.match(
    defaultCardRule,
    /background:\s*linear-gradient\(135deg, #f5edff 0%, #e9d8fa 100%\)/,
  );

  for (const name of [
    '心动盲盒',
    '幸运盲盒',
    '小熊虫',
    '七夕鹊匣',
    '羁绊宝盒',
  ]) {
    const selectorPattern = new RegExp(
      `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\{`,
    );
    const ruleMatch = styles.match(selectorPattern);
    const ruleStart = ruleMatch?.index ?? -1;
    const ruleEnd = styles.indexOf('\n}', ruleStart);

    assert.ok(
      ruleStart >= 0,
      `${name} mapping card should have a dedicated style`,
    );
    assert.match(
      styles.slice(ruleStart, ruleEnd),
      /border-color:\s*#[0-9a-f]{6}/i,
    );
    assert.match(
      styles.slice(ruleStart, ruleEnd),
      /background:\s*linear-gradient/,
    );
    assert.match(
      styles,
      new RegExp(
        `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\.bb-chip-name\\s*\\{`,
      ),
    );
    assert.match(
      styles,
      new RegExp(
        `\\.blind-box-chip:has\\(img\\[alt\\*=['"]${name}['"]\\]\\)\\s*\\.bb-chip-price\\s*\\{`,
      ),
    );
  }
});
