'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { fileURLToPath, pathToFileURL } = require('node:url');

const ROOT_DIR = path.join(__dirname, '..');

test('admin page uses one ordered module entrypoint', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/admin\/index\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  const giftModulePaths = [
    './gifts/notification.js',
    './gifts/detection.js',
    './gifts/sprint.js',
    './gifts/recent.js',
    './gifts/blindbox.js',
    './gifts/blindbox-analysis.js',
    './gifts/history.js'
  ];
  const giftIndexPosition = entrySource.indexOf("import './gifts/index.js';");
  assert.ok(giftIndexPosition > -1, 'gift index import should remain present');
  for (const modulePath of giftModulePaths) {
    const modulePosition = entrySource.indexOf(`import '${modulePath}';`);
    assert.ok(modulePosition > -1, `${modulePath} import should remain present`);
    assert.ok(modulePosition < giftIndexPosition, `${modulePath} should load before the gift index`);
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('admin form refresh does not overwrite the field currently being edited', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), 'utf8');

  assert.match(source, /if \(element && element !== document\.activeElement\) element\.value = inputValue;/);
});

test('admin danmaku input has no fixed character limit', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');

  assert.doesNotMatch(html, /id="danmakuMessage"[^>]*maxlength=/);
  assert.match(html, /id="danmakuCounter"[^>]*>0 字</);
  assert.match(source, /Array\.from\(message\.value\)\.length/);
  assert.match(source, /enableRandomTagReply/);
  assert.match(source, /enableCheckinBot/);
  assert.match(source, /enableFortuneBot/);
  assert.doesNotMatch(source, /mentionRequester: toggle\.checked/);
  assert.match(html, /随机点歌回复/);
  assert.match(html, /条件不匹配时，自动回复点歌人/);
  assert.match(html, /启用回复/);
  assert.match(html, /签到机器人/);
  assert.match(html, /收到“签到”弹幕后回复累计天数/);
  assert.match(html, /启用签到/);
  assert.match(html, /抽签机器人/);
  assert.match(html, /收到“抽签”弹幕后回复每日一签/);
  assert.match(html, /启用抽签/);
  assert.match(html, /<details id="danmakuBlessingsPanel" class="danmaku-blessings-section">/);
  assert.match(html, /id="danmakuBlessingList"/);
  assert.match(html, /id="danmakuBlessingAddBtn"/);
  assert.match(html, /id="danmakuBlessingSaveBtn"/);
  assert.match(source, /checkinBlessings: JSON\.stringify\(cleaned\)/);
  assert.match(source, /blessings\.splice\(index, 1\)/);
});

test('admin danmaku status prefers account and room display names', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');

  assert.match(source, /state\.accountName \|\| `UID \$\{state\.accountUid \|\| '-'\}`/);
  assert.match(source, /state\.roomName \|\| `房间 \$\{state\.roomId\}`/);
  assert.match(source, /accountState\.title = state\.loggedIn && state\.accountUid \? `UID \$\{state\.accountUid\}` : '';/);
  assert.match(source, /roomState\.title = state\.roomId \? `房间 \$\{state\.roomId\}` : '';/);
});

test('admin blind box summary shows one row per viewer and opens analysis', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), 'utf8');

  assert.match(html, /id="blindBoxAnalysisOpenBtn"/);
  assert.match(html, /title="查看完整盲盒分析"/);
  assert.match(html, /<th>观众<\/th>\s*<th>盒数<\/th>\s*<th>盒型<\/th>/);
  assert.match(html, /<th>总成本<\/th>\s*<th>开出价值<\/th>\s*<th>观众盈亏<\/th>/);
  assert.doesNotMatch(html, /id="blindBoxStatsTable"[\s\S]*?<th>时间<\/th>/);
  assert.match(source, /const users = Array\.isArray\(perUser\)/);
  assert.match(source, /data-viewer=/);
  assert.match(source, /analysis\?\.open/);
  assert.match(source, /closest\('#blindBoxAnalysisOpenBtn'/);
});

test('gift history preserves negative blind box profit', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'history.js'), 'utf8');

  assert.match(source, /blindProfit < 0 \? '-' : ''/);
  assert.match(source, /gift-remark-tag blind \$\{profitClass\}/);
  assert.match(source, /formatMoney\(Math\.abs\(Number\(blindProfit\) \|\| 0\)\)/);
});

test('blind box analysis is a separate accessible workspace module', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const entry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');
  const stylesEntry = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis.js'), 'utf8');

  assert.match(entry, /import '\.\/gifts\/blindbox-analysis\.js';/);
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
  const analysisSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox-analysis.js'), 'utf8');

  assert.match(stateSource, /isGiftSnapshotReason\(payload\.reason\)/);
  assert.match(stateSource, /eventBus\.emit\(Events\.GIFT_RECEIVED/);
  assert.match(analysisSource, /eventBus\.on\(Events\.GIFT_RECEIVED, refreshIfOpen\)/);
  assert.match(analysisSource, /REFRESH_DELAY_MS = 500/);
  assert.doesNotMatch(analysisSource, /Events\.STATE_LOADED/);
});

test('gift notifications detect delayed records that are not first in the list', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'notification.js'),
    'utf8'
  );
  const toasts = [];
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: value => String(value),
          formatMoney: value => String(value),
          showStackedToast: options => toasts.push(options)
        }
      }
    },
    document: {
      getElementById: () => ({ checked: true })
    }
  };
  vm.runInNewContext(source, sandbox);
  const notify = sandbox.window.AdminApp.gifts.notification.notifyNewGift;
  const newestByTime = {
    id: 10,
    gift_id: '1',
    gift_name: 'Rose',
    user_name: 'Alice',
    num: 1,
    total_price: 1
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
      total_price: 2
    }
  ]);

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'gift:11:1:2');
  assert.match(toasts[0].html, /Delayed Gift/);
});

test('admin overlay links always use the IPv4 loopback host and current port', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    'utf8'
  );
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'),
    'utf8'
  );

  assert.doesNotMatch(html, /localhost:3000\/blindbox/);
  assert.doesNotMatch(displaySource, /localhost:3000/);
  assert.doesNotMatch(settingsSource, /localhost:3000/);
  assert.doesNotMatch(displaySource, /replace\(['"]127\.0\.0\.1['"],\s*['"]localhost['"]\)/);
  assert.match(utilitySource, /function localOverlayOrigin\(locationLike = location\)/);
  assert.match(utilitySource, /127\.0\.0\.1/);
  assert.match(displaySource, /localOverlayOrigin\(location\)/);
  assert.match(settingsSource, /localOverlayOrigin\(location\)/);
  assert.doesNotMatch(displaySource, /location\.origin/);
  assert.doesNotMatch(settingsSource, /location\.host/);
});

test('blindbox broadcast controls live below gift profit stats', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const giftPageStart = html.indexOf('<section id="giftAssistantPage"');
  const statsStart = html.indexOf('class="panel gift-blindbox-panel"');
  const broadcastStart = html.indexOf('class="panel gift-blindbox-broadcast-panel"');
  const mappingStart = html.indexOf('class="panel gift-blindbox-mapping-panel"');
  const overlayTabEnd = html.indexOf('<div id="importPage"');

  assert.ok(giftPageStart > -1);
  assert.ok(statsStart > giftPageStart);
  assert.ok(broadcastStart > statsStart);
  assert.ok(mappingStart > broadcastStart);
  assert.ok(html.indexOf('id="blindboxOverlayTitle"') > broadcastStart);
  assert.equal(html.slice(0, overlayTabEnd).includes('id="blindboxOverlayTitle"'), false);
});

test('blindbox broadcast settings expose audience filters and one open action', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'), 'utf8');

  assert.match(html, /<span class="panel-kicker">观众画面<\/span>/);
  assert.match(html, /<h2>盲盒盈亏榜<\/h2>/);
  assert.match(html, /id="blindboxWinnersOnly"[^>]*checked/);
  assert.match(html, /id="blindboxHeartBoxOnly"/);
  assert.doesNotMatch(html, /blindboxCompact|blindboxNoScroll|blindboxLowPower|blindboxOpenUrlBtn/);
  assert.equal((html.match(/>打开画面<\/a>/g) || []).length, 1);
  assert.match(source, /liveLink\.href = url/);
  assert.match(source, /add\('heartBox', '1'\)/);
  assert.doesNotMatch(source, /add\('compact'|add\('noScroll'|add\('quality'/);
});

test('blindbox ranking count supports all, summary-only, and one-to-ten modes', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'), 'utf8');

  assert.match(html, /id="blindboxOverlayTop"[^>]*min="-1"[^>]*max="10"[^>]*value="3"/);
  assert.match(html, /-1 显示全部，0 仅显示汇总，1 至 10 显示对应人数/);
  assert.match(settingsSource, /if \(top !== ''\) add\('top', top\)/);
  assert.match(overlaySource, /param\('top', 't'\) \|\| '3'/);
  assert.match(overlaySource, /Math\.min\(10, Math\.max\(-1, requestedTop\)\)/);
  assert.match(overlaySource, /const SUMMARY_ONLY = TOP_N === 0/);
  assert.match(overlaySource, /if \(TOP_N > 0\)[\s\S]*?users = users\.slice\(0, TOP_N\)/);
  assert.match(overlaySource, /if \(SUMMARY_ONLY\)[\s\S]*?leaderboard\.innerHTML = ''/);
  assert.match(overlaySource, /HEART_BOX_ONLY/);
  assert.match(overlaySource, /boxName=.*心动盲盒/);
  assert.match(overlayStyles, /\.blindbox-panel\.summary-only \.blindbox-header[\s\S]*?display:\s*none/);

  const readMode = (search) => {
    const sandbox = {
      URLSearchParams,
      location: { search },
      document: { addEventListener() {} }
    };
    vm.runInNewContext(`${overlaySource}\nthis.result = { top: TOP_N, summaryOnly: SUMMARY_ONLY };`, sandbox);
    return { top: sandbox.result.top, summaryOnly: sandbox.result.summaryOnly };
  };

  assert.deepEqual(readMode('?top=-1'), { top: -1, summaryOnly: false });
  assert.deepEqual(readMode('?top=0'), { top: 0, summaryOnly: true });
  assert.deepEqual(readMode(''), { top: 3, summaryOnly: false });
  assert.deepEqual(readMode('?top=25'), { top: 10, summaryOnly: false });
});

test('blindbox overlay fills the capture width and reflows without hiding data', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'blindbox.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'blindbox.css'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'blindbox.js'), 'utf8');
  const panelRule = styles.match(/\.blindbox-panel\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(panelRule, 'blindbox panel styles should remain defined');
  assert.doesNotMatch(html, /blindbox-live-status|>实时</);
  assert.doesNotMatch(styles, /blindbox-live-status/);
  assert.match(panelRule, /width:\s*420px/);
  assert.match(panelRule, /margin:\s*var\(--overlay-edge\)/);
  assert.match(styles, /\.overlay-body\.blindbox-viewport-resized \.blindbox-panel\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/);
  assert.match(panelRule, /container-type:\s*inline-size/);
  assert.match(styles, /@container \(min-width: 680px\)[\s\S]*?grid-template-columns:\s*minmax\(240px, 0\.8fr\) minmax\(360px, 1\.35fr\)/);
  assert.match(styles, /@container \(max-width: 259px\)[\s\S]*?grid-template-areas:\s*"rank user user" "rank count profit"/);
  assert.doesNotMatch(styles, /\.box-count\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(styles, /\.profit-value\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(source, /panel\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /initialBlindboxViewportWidth\s*=\s*window\.innerWidth/);
  assert.match(source, /blindbox-viewport-resized/);
});

test('recent gift cards keep a wider responsive minimum width', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const giftCardsRule = source.match(/\.gift-page \.panel-body \.gift-cards\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(giftCardsRule, 'gift card layout styles should remain defined');
  assert.match(giftCardsRule, /grid-template-columns:\s*repeat\(auto-fill, minmax\(270px, 1fr\)\)/);
});

test('recent gift cards stay within six rows as the grid width changes', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const cards = [];
  let gridTemplateColumns = '270px 270px 270px';
  let resizeCallback;
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => cards,
    set innerHTML(value) {
      cards.length = (value.match(/class="gift-card/g) ?? []).length;
      for (let index = 0; index < cards.length; index += 1) cards[index] = { hidden: false };
    }
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: value => String(value),
          formatTime: value => String(value),
          formatMoney: value => String(value)
        }
      },
      getComputedStyle: () => ({ gridTemplateColumns }),
      ResizeObserver: class {
        constructor(callback) {
          resizeCallback = callback;
        }
        observe() {}
      }
    },
    document: { getElementById: () => list }
  };
  const items = Array.from({ length: 30 }, (_, index) => ({
    gift_name: `Gift ${index + 1}`,
    user_name: 'Viewer',
    total_price: 1,
    created_at: index
  }));

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList(items);

  assert.equal(cards.filter(card => !card.hidden).length, 18);

  gridTemplateColumns = '270px 270px';
  resizeCallback();
  assert.equal(cards.filter(card => !card.hidden).length, 12);

  gridTemplateColumns = '270px 270px 270px 270px 270px';
  resizeCallback();
  assert.equal(cards.filter(card => !card.hidden).length, 30);
});

test('recent gift cards reserve artwork space and keep metadata in named slots', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  assert.match(script, /class="gift-card-content"/);
  assert.match(script, /class="gift-user"/);
  assert.match(script, /class="gift-amount"/);
  assert.match(script, /class="gift-result/);
  assert.match(script, /class="gift-time"/);
  assert.doesNotMatch(script, /item\.is_blind_box \? '' : `<span>\$\{formatTime/);
  assert.match(styles, /\.gift-card\.has-type-icon\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 52px/);
  assert.match(styles, /\.gift-card \.gift-meta\s*\{[\s\S]*?grid-template-areas:/);
  assert.match(styles, /\.gift-card \.gift-type-icon\s*\{[\s\S]*?position:\s*static/);
});

test('recent guard gift cards use subtle matching guard level colors', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  assert.match(script, /guard-card guard-\$\{guardBadge\.level\}/);
  assert.match(script, /name: '总督', level: 1/);
  assert.match(script, /name: '提督', level: 2/);
  assert.match(script, /name: '舰长', level: 3/);
  assert.match(styles, /\.gift-card\.guard-card\.guard-1\s*\{[^}]*border-left-color:\s*#f25f72[^}]*background:\s*linear-gradient/);
  assert.match(styles, /\.gift-card\.guard-card\.guard-2\s*\{[^}]*border-left-color:\s*#8d67e8[^}]*background:\s*linear-gradient/);
  assert.match(styles, /\.gift-card\.guard-card\.guard-3\s*\{[^}]*border-left-color:\s*#4b91e8[^}]*background:\s*linear-gradient/);
  assert.doesNotMatch(styles, /\.gift-card\.guard-card\s*\{[^}]*color:\s*var\(--color-bg-primary\)/);
});

test('recent blind box cards keep box colors while profit text uses stock-style colors', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  assert.match(script, /profitClass = blindProfit > 0 \? 'profit-up' : blindProfit < 0 \? 'profit-down' : 'profit-neutral'/);
  assert.match(script, /className: 'blind-box-heart'/);
  assert.match(script, /className: 'blind-box-lucky'/);
  assert.match(script, /className: 'blind-box-bear'/);
  assert.match(styles, /\.gift-card\.blind-box-card\.blind-box-heart\s*\{[^}]*border-left-color:\s*#f3a2aa/);
  assert.match(styles, /\.gift-card\.blind-box-card\.blind-box-lucky\s*\{[^}]*border-left-color:\s*#b8d983/);
  assert.match(styles, /\.gift-card\.blind-box-card\.blind-box-bear\s*\{[^}]*border-left-color:\s*#f5a6cb/);
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-up\s*\{[^}]*color:\s*#c0392b/);
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-down\s*\{[^}]*color:\s*#21b6a8/);
  assert.match(styles, /\.gift-card\.blind-box-card \.profit-neutral\s*\{[^}]*color:\s*#647181/);
});

test('recent gift totals worth at least 1000 RMB use gold while artwork requires that unit value', () => {
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'recent.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');
  const list = {
    classList: { toggle() {} },
    querySelectorAll: () => [],
    innerHTML: ''
  };
  const sandbox = {
    window: {
      AdminApp: {
        utils: {
          escapeHtml: value => String(value),
          formatTime: value => String(value),
          formatMoney: value => String(value)
        }
      },
      getComputedStyle: () => ({ gridTemplateColumns: '270px' })
    },
    document: { getElementById: () => list }
  };

  vm.runInNewContext(script, sandbox);
  sandbox.window.AdminApp.gifts.recent.renderGiftRecentList([
    { gift_id: '35541', gift_name: 'bilibili星跃', user_name: 'Alice', num: 1, unit_price: 1000, total_price: 1000 },
    { gift_id: '35541', gift_name: 'bilibili星跃', user_name: 'Bob', num: 2, unit_price: 500, total_price: 1000 }
  ]);

  assert.equal((list.innerHTML.match(/high-value-gift-card/g) || []).length, 2);
  assert.equal((list.innerHTML.match(/gift-high-value-icon/g) || []).length, 1);
  assert.equal((list.innerHTML.match(/\/img\/bilibili-gifts\/1000-1100\/35541\.webp/g) || []).length, 1);
  assert.match(styles, /\.gift-card\.high-value-gift-card\s*\{[\s\S]*?background:\s*linear-gradient\(90deg/);
  assert.match(styles, /\.gift-card \.gift-high-value-icon\s*\{[\s\S]*?object-fit:\s*contain/);
});

test('blind box mapping cards keep distinct colors for known box types', () => {
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'gifts.css'), 'utf8');

  for (const name of ['心动盲盒', '幸运盲盒', '小熊虫']) {
    const selector = `.blind-box-chip:has(img[alt*="${name}"])`;
    const ruleStart = styles.indexOf(`${selector} {`);
    const ruleEnd = styles.indexOf('\n}', ruleStart);

    assert.ok(ruleStart >= 0, `${name} mapping card should have a dedicated style`);
    assert.match(styles.slice(ruleStart, ruleEnd), /border-color:\s*#[0-9a-f]{6}/i);
    assert.match(styles.slice(ruleStart, ruleEnd), /background:\s*linear-gradient/);
    assert.match(styles, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.bb-chip-name \\{`));
    assert.match(styles, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.bb-chip-price \\{`));
  }
});

test('queue headers share a fixed minimum height and song queue controls stay compact', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const headerRule = source.match(/\.queues-row \.queue-panel \.panel-header\s*\{[\s\S]*?\n\}/)?.[0];
  const buttonRule = source.match(/\.queues-row \.song-queue-panel \.panel-header button\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(headerRule, 'queue header sizing should remain defined');
  assert.match(headerRule, /min-height:\s*60px/);
  assert.ok(buttonRule, 'song queue header controls should remain compact');
  assert.match(buttonRule, /min-height:\s*30px/);
});

test('toolbox owns independent overtime, daily todo, performance, usage guide, and update features', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');
  const tabStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'tabs.css'), 'utf8');
  const featureStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8'
  );
  const managementTabs = html.match(/<div class="tabs" role="tablist">([\s\S]*?)<\/div>/)?.[1];
  const directTabRule = tabStyles.match(/\.tabs > \.tab\s*\{[\s\S]*?\n\}/)?.[0];
  const overtimePosition = html.indexOf('data-other-feature="otherOvertimeMachineFeature"');
  const dailyTodoPosition = html.indexOf('data-other-feature="otherDailyTodoFeature"');
  const performancePosition = html.indexOf('data-other-feature="otherPerformanceFeature"');
  const usageGuidePosition = html.indexOf('data-other-feature="otherUsageGuideFeature"');
  const updatePosition = html.indexOf('data-other-feature="otherDesktopUpdateFeature"');

  assert.doesNotMatch(html, /data-tab="performancePage"/);
  assert.doesNotMatch(html, /id="performancePage"/);
  assert.match(html, /data-main-page="otherAssistantPage"[\s\S]*?<span>百宝箱<\/span>/);
  assert.ok(managementTabs, 'song management tabs should remain present');
  assert.equal(managementTabs.match(/data-tab=/g)?.length, 7);
  assert.doesNotMatch(managementTabs, /<details|更多|desktopUpdate/);
  assert.ok(directTabRule, 'direct tab sizing should remain defined');
  assert.match(directTabRule, /flex:\s*1 1 0/);
  assert.match(directTabRule, /min-width:\s*0/);
  assert.doesNotMatch(tabStyles, /tab-overflow/);
  assert.match(html, /data-other-feature="otherOvertimeMachineFeature"/);
  assert.match(html, /id="otherOvertimeMachineFeature"[^>]+data-other-feature-panel[^>]*><\/section>/);
  assert.match(html, /data-other-feature="otherDailyTodoFeature"/);
  assert.match(html, /id="otherDailyTodoFeature"[^>]+data-other-feature-panel[^>]*><\/section>/);
  assert.match(html, /data-other-feature="otherPerformanceFeature"/);
  assert.match(html, /id="otherPerformanceFeature"[^>]+data-other-feature-panel/);
  assert.match(html, /data-other-feature="otherUsageGuideFeature"/);
  assert.match(html, /id="otherUsageGuideFeature"[\s\S]*?usage-guide-panel/);
  assert.match(html, /id="otherUsageGuideFeature"[\s\S]*?usage-guide-faq-grid/);
  assert.match(html, /id="otherDesktopUpdateFeature"[^>]+data-other-feature-panel/);
  assert.ok(overtimePosition < performancePosition, 'overtime machine should be first in the toolbox');
  assert.ok(dailyTodoPosition > overtimePosition, 'daily todo should follow overtime machine in the toolbox');
  assert.ok(dailyTodoPosition < performancePosition, 'daily todo should precede performance in the toolbox');
  assert.ok(usageGuidePosition > performancePosition, 'usage guide should follow performance in the toolbox');
  assert.ok(updatePosition > performancePosition, 'desktop update should follow performance in the toolbox');
  assert.equal(html.match(/id="metricsToggle"/g)?.length, 1);
  assert.equal(html.match(/id="desktopCheckUpdateBtn"/g)?.length, 1);
  assert.match(styles, /@import url\('\.\/admin\/other-features\.css'\);/);
  assert.match(
    featureStyles,
    /\.other-feature-panel-body\.stack\s*\{[^}]*grid-auto-rows:\s*max-content;/
  );
});

test('other feature navigation selects panels without feature-specific dependencies', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'), 'utf8');
  const createNode = ({ id = '', feature = '', hidden = false } = {}) => {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    return {
      id,
      dataset: feature ? { otherFeature: feature } : {},
      hidden,
      tabIndex: -1,
      focused: false,
      classList: {
        contains(name) { return classes.has(name); },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      },
      addEventListener(name, listener) { listeners.set(name, listener); },
      dispatch(name, event) { listeners.get(name)?.(event); },
      focus() { this.focused = true; },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute(name) { return attributes.get(name); }
    };
  };
  const buttons = [
    createNode({ feature: 'performanceFeature' }),
    createNode({ feature: 'diagnosticsFeature' }),
    createNode({ feature: 'desktopFeature', hidden: true })
  ];
  const panels = [
    createNode({ id: 'performanceFeature' }),
    createNode({ id: 'diagnosticsFeature' }),
    createNode({ id: 'desktopFeature', hidden: true })
  ];
  const root = {
    querySelectorAll(selector) {
      return selector === '[data-other-feature]' ? buttons : panels;
    }
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: { AdminApp: {} }
  };

  vm.runInNewContext(source, sandbox);
  const selected = sandbox.window.AdminApp.other.selectFeature(root, 'diagnosticsFeature');

  assert.equal(selected, true);
  assert.equal(buttons[0].classList.contains('active'), false);
  assert.equal(buttons[0].getAttribute('aria-selected'), 'false');
  assert.equal(buttons[0].tabIndex, -1);
  assert.equal(buttons[1].classList.contains('active'), true);
  assert.equal(buttons[1].getAttribute('aria-selected'), 'true');
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);

  sandbox.window.AdminApp.other.initOtherPage();
  let prevented = false;
  buttons[1].dispatch('keydown', {
    key: 'ArrowUp',
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(buttons[0].focused, true);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);

  sandbox.window.AdminApp.other.selectFeature(root, 'desktopFeature');
  assert.equal(buttons[0].classList.contains('active'), true);
  assert.equal(buttons[2].classList.contains('active'), false);
  assert.equal(panels[2].hidden, true);
});

test('desktop update opens its toolbox feature through module APIs', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'desktop.js'), 'utf8');
  let showUpdatePage;
  let selectedPage = '';
  let selectedFeature = '';
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll: () => []
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({})
        },
        navigation: { setMainPage(pageId) { selectedPage = pageId; } },
        other: { selectFeatureById(featureId) { selectedFeature = featureId; } }
      },
      songAssistantDesktop: {
        onShowUpdatePage(callback) { showUpdatePage = callback; },
        onUpdateState() {},
        getInfo: () => new Promise(() => {})
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();
  showUpdatePage();

  assert.equal(selectedPage, 'otherAssistantPage');
  assert.equal(selectedFeature, 'otherDesktopUpdateFeature');
});

test('desktop lyric address is available from the live screen tab', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );

  assert.match(html, /id="lyricsUrl"/);
  assert.doesNotMatch(html, /playbackLyricBtn|playbackLyricLockBtn/);
  assert.match(displaySource, /lyricsUrl.*`\$\{origin\}\/lyrics`/);
});

test('song board defaults to a clear frosted glass theme', () => {
  const themeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(defaultsSource, /themeOpacity: '0\.48'/);
  assert.match(defaultsSource, /backdropBlur: '14'/);
  assert.match(defaultsSource, /glowIntensity: '2'/);
  assert.match(themeSource, /themeOpacity: '0\.48'/);
  assert.match(themeSource, /backdropBlur: '14'/);
  assert.match(themeSource, /glowIntensity: '2'/);
  assert.match(themeSource, /bindRangePair\('backdropBlur', 'backdropBlurNumber', 0, 30, 14\)/);
  assert.match(themeSource, /bindRangePair\('glowIntensity', 'glowIntensityNumber', 0, 20, 2\)/);
});

test('gift workspace rows keep their content height inside the scroll container', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const giftWorkspaceRule = source.match(/\.gift-workspace\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(giftWorkspaceRule, 'gift workspace styles should remain defined');
  assert.match(giftWorkspaceRule, /grid-template-rows:\s*repeat\(6, max-content\)/);
});

test('song workspace scrolls within the viewport above the player dock', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const songWorkspaceRule = source.match(/\.song-workspace\s*\{[\s\S]*?\n\}/)?.[0];
  const expandedRule = source.match(/body\.player-dock-expanded \.song-workspace\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(songWorkspaceRule, 'song workspace styles should remain defined');
  assert.ok(expandedRule, 'expanded player sizing should remain defined');
  assert.match(songWorkspaceRule, /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/);
  assert.match(songWorkspaceRule, /overflow-y:\s*auto/);
  assert.match(expandedRule, /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 218px\)\)/);
});

test('player dock exposes a collapse handle and shares its height with route workspaces', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const playerStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'), 'utf8');
  const playbackLayout = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'layout.css'), 'utf8');
  const adminWorkspace = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const otherWorkspace = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'), 'utf8');

  assert.match(html, /id="playerDockToggle"[^>]*aria-expanded="true"[^>]*aria-controls="playbackPlayerBody"/);
  assert.match(html, /id="playbackPlayerBody" class="panel-body playback-player"/);
  assert.match(playerStyles, /--player-dock-collapsed-height:\s*0px/);
  assert.match(playerStyles, /body\.player-dock-collapsed\s*\{/);
  assert.match(playerStyles, /\.playback-player-panel\.is-collapsed \.playback-player\s*\{/);
  assert.match(playbackLayout, /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/);
  assert.match(adminWorkspace, /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/);
  assert.match(otherWorkspace, /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/);
});

test('player dock starts collapsed and toggles open without opening fullscreen', async () => {
  const makeClassList = () => {
    const names = new Set();
    return {
      add(...values) {
        values.forEach((value) => names.add(value));
      },
      remove(...values) {
        values.forEach((value) => names.delete(value));
      },
      toggle(value, force) {
        const next = force === undefined ? !names.has(value) : force;
        if (next) names.add(value);
        else names.delete(value);
        return next;
      },
      contains(value) {
        return names.has(value);
      }
    };
  };
  const makeElement = () => {
    const listeners = new Map();
    const attributes = new Map();
    return {
      classList: makeClassList(),
      listeners,
      attributes,
      title: '',
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      closest() {
        return null;
      }
    };
  };

  const playerPanel = makeElement();
  const fullscreen = makeElement();
  const dockToggle = makeElement();
  const playerBody = makeElement();
  const elements = {
    playerFullscreen: fullscreen,
    playerDockToggle: dockToggle,
    playbackPlayerBody: playerBody,
    playbackVolumePanel: makeElement(),
    playbackVolumeIcon: makeElement(),
    queuePopup: makeElement(),
    queuePopupBackdrop: makeElement(),
    playbackQueueBtn: makeElement()
  };
  const body = { classList: makeClassList() };
  const document = {
    body,
    addEventListener() {},
    querySelector(selector) {
      return selector === '.playback-player-panel' ? playerPanel : null;
    },
    getElementById(id) {
      return elements[id] || null;
    }
  };
  const window = { AdminApp: {} };

  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window }
  );
  const service = new FormsService();
  let fullscreenOpened = false;
  service.openFullscreenPlayer = () => {
    fullscreenOpened = true;
  };

  service.initWorkspaceControls();
  assert.equal(body.classList.contains('player-dock-collapsed'), true);
  assert.equal(playerPanel.classList.contains('is-collapsed'), true);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'true');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dockToggle.getAttribute('aria-label'), '展开播放器');

  const panelClick = playerPanel.listeners.get('click');
  panelClick({
    target: {
      closest(selector) {
        return selector.includes('button') ? dockToggle : null;
      }
    }
  });
  assert.equal(fullscreenOpened, false);

  const dockClick = dockToggle.listeners.get('click');
  dockClick({ stopPropagation() {} });
  assert.equal(body.classList.contains('player-dock-collapsed'), false);
  assert.equal(playerPanel.classList.contains('is-collapsed'), false);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'false');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(dockToggle.getAttribute('aria-label'), '收起播放器');
});

test('queue panels remain the same height on desktop', () => {
  const workspaceSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const responsiveSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'), 'utf8');
  const queueRowRule = workspaceSource.match(/\.queues-row\s*\{[\s\S]*?\n\}/)?.[0];
  const responsiveQueueRule = responsiveSource.match(/\.queues-row\s*\{[\s\S]*?\n\s*\}/)?.[0];
  const responsivePanelRule = responsiveSource.match(/\.queues-row \.sc-queue-panel,[\s\S]*?\n\s*\}/)?.[0];

  assert.ok(queueRowRule, 'desktop queue row styles should remain defined');
  assert.ok(responsiveQueueRule, 'responsive queue row styles should remain defined');
  assert.ok(responsivePanelRule, 'narrow-layout queue panel sizing should remain defined');
  assert.match(queueRowRule, /flex:\s*0 0 450px/);
  assert.match(queueRowRule, /height:\s*450px/);
  assert.match(responsiveQueueRule, /flex:\s*0 0 auto/);
  assert.match(responsiveQueueRule, /height:\s*auto/);
  assert.match(responsivePanelRule, /height:\s*auto/);
});

test('admin queue cards have enough height for their text and metadata', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const collapsibleSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'collapsible.css'), 'utf8');
  const queueListRule = source.match(/\.queues-row \.queue-panel \.queue-list\s*\{[\s\S]*?\n\}/)?.[0];
  const scListRule = source.match(/\.queues-row \.queue-panel \.sc-list\s*\{[\s\S]*?\n\}/)?.[0];
  const queueItemRule = source.match(/\.queues-row \.queue-panel \.queue-row\s*\{[\s\S]*?\n\}/)?.[0];
  const scRowRule = collapsibleSource.match(/\.sc-row\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(queueListRule, 'queue list styles should remain defined');
  assert.ok(scListRule, 'SC queue list styles should remain defined');
  assert.ok(queueItemRule, 'queue item styles should remain defined');
  assert.ok(scRowRule, 'SC queue item styles should remain defined');
  assert.match(queueListRule, /grid-auto-rows:\s*84px/);
  assert.match(scListRule, /grid-auto-rows:\s*88px/);
  assert.match(queueListRule, /align-content:\s*start/);
  assert.match(queueItemRule, /min-height:\s*0/);
  assert.match(queueItemRule, /overflow:\s*hidden/);
  assert.match(scRowRule, /align-items:\s*center/);
});

test('admin queue wheel scrolls overflowing lists and releases the page at their edges', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'), 'utf8');
  const makeTarget = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
  });
  const superChatPanel = makeTarget();
  const queuePanel = makeTarget();
  const superChatList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => superChatPanel
  };
  const queueList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => queuePanel
  };
  const elements = {
    manualForm: makeTarget(),
    nextBtn: makeTarget(),
    clearBtn: makeTarget(),
    superChatList,
    queueList
  };
  const sandbox = {
    console,
    confirm: () => false,
    document: { getElementById: (id) => elements[id] || null },
    window: {
      AdminApp: {
        utils: {
          escapeHtml: String,
          escapeAttr: String,
          value: () => '',
          setValue() {},
          formatTime: String,
          formatSuperChatPrice: String,
          withMultilingualFallback: String,
          toast() {},
          api: async () => ({})
        }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.queue.initQueueForm();
  const wheel = superChatPanel.listeners.get('wheel');
  const dispatchWheel = (deltaY) => {
    let prevented = false;
    wheel({ deltaY, deltaMode: 0, preventDefault() { prevented = true; } });
    return prevented;
  };

  assert.equal(dispatchWheel(120), false, 'a non-overflowing queue should leave page scrolling alone');
  superChatList.scrollHeight = 300;
  assert.equal(dispatchWheel(120), true, 'an overflowing queue should consume downward wheel input');
  assert.equal(superChatList.scrollTop, 36);
  superChatList.scrollTop = 200;
  assert.equal(dispatchWheel(120), false, 'the bottom edge should release downward input to the page');
  assert.equal(dispatchWheel(-120), true, 'the list should still consume input away from the bottom edge');
  superChatList.scrollTop = 0;
  assert.equal(dispatchWheel(-120), false, 'the top edge should release upward input to the page');
});

test('desktop admin keeps scrolling on the workspace instead of nesting it in tabs', () => {
  const workspaceSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'workspace.css'), 'utf8');
  const responsiveSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'), 'utf8');
  const activeTabRule = workspaceSource.match(/\.song-management-panel > \.tab-page\.active\s*\{[\s\S]*?\n\}/)?.[0];
  const desktopBodyRule = responsiveSource.match(/@media \(min-width: 901px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/)?.[0];
  const mobileBodyRule = responsiveSource.match(/@media \(max-width: 900px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/)?.[0];

  assert.ok(activeTabRule, 'active management tab styles should remain defined');
  assert.ok(desktopBodyRule, 'desktop body overflow rule should remain defined');
  assert.ok(mobileBodyRule, 'mobile body overflow rule should remain defined');
  assert.match(activeTabRule, /overflow:\s*visible/);
  assert.match(desktopBodyRule, /overflow:\s*hidden/);
  assert.match(mobileBodyRule, /overflow:\s*auto/);
});

test('hidden switches and the narrow player do not widen the page', () => {
  const adminSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts.css'), 'utf8');
  const playbackSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'responsive.css'), 'utf8');
  const switchInputRule = adminSource.match(/\.switch-control input\s*\{[\s\S]*?\n\}/)?.[0];
  const narrowPlayerRule = playbackSource.match(
    /@media \(max-width: 900px\)[\s\S]*?\.playback-progress-row\s*\{[\s\S]*?\n\s*\}/
  )?.[0];

  assert.ok(switchInputRule, 'switch input styles should remain defined');
  assert.ok(narrowPlayerRule, 'narrow player progress styles should remain defined');
  assert.match(switchInputRule, /width:\s*1px/);
  assert.match(switchInputRule, /height:\s*1px/);
  assert.match(narrowPlayerRule, /width:\s*auto/);
  assert.match(narrowPlayerRule, /padding-left:\s*0/);
});

test('playback labels scroll independently without resizing the progress slot', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'), 'utf8');
  const nowPlayingRule = styles.match(/\.playback-now\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(nowPlayingRule, 'now-playing layout styles should remain defined');
  assert.match(nowPlayingRule, /grid-template-columns:\s*minmax\(0, 180px\) minmax\(520px, 1fr\)/);
  assert.match(html, /id="playbackTrackTitle" class="playback-marquee"/);
  assert.match(html, /id="playbackTrackArtist" class="playback-marquee"/);

  const { PlaybackBar } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'playback-bar.js')
  );
  const player = new PlaybackBar();
  const classes = new Set();
  let animationKeyframes = null;
  let animationOptions = null;
  let cancelled = false;
  const animation = { cancel() { cancelled = true; } };
  const textElement = {
    scrollWidth: 260,
    animate(keyframes, options) {
      animationKeyframes = keyframes;
      animationOptions = options;
      return animation;
    }
  };
  const element = {
    clientWidth: 100,
    querySelector() { return textElement; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    }
  };

  player.updateMarquee(element);

  assert.equal(classes.has('is-scrolling'), true);
  assert.equal(animationKeyframes[0].transform, 'translateX(0)');
  assert.equal(animationKeyframes[2].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[3].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[4].transform, 'translateX(0)');
  assert.equal(
    Math.round((animationKeyframes[1].offset - animationKeyframes[0].offset) * animationOptions.duration),
    1000
  );
  assert.equal(
    Math.round((animationKeyframes[3].offset - animationKeyframes[2].offset) * animationOptions.duration),
    1000
  );

  element.clientWidth = 300;
  player.updateMarquee(element);
  assert.equal(cancelled, true);
  assert.equal(classes.has('is-scrolling'), false);
});

test('admin state events render queue empty states and song data', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');

  assert.match(source, /eventBus\.on\(Events\.STATE_LOADED/);
  assert.match(source, /window\.AdminApp\.queue\.renderState\(state, songs\)/);
  assert.match(source, /eventBus\.on\(Events\.SONG_UPDATED/);
  assert.match(source, /window\.AdminApp\.songs\.renderSongs\(songs, languages, artists, tags\)/);
});

test('admin initialization waits for sibling module scripts at interactive ready state', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');

  assert.match(source, /document\.readyState === 'complete'/);
  assert.match(source, /document\.addEventListener\('DOMContentLoaded', initApp, \{ once: true \}\)/);
});

test('admin loads theme presets before initializing theme forms', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');
  const loadPosition = source.indexOf('await Theme.loadThemeConfig()');
  const themeFormPosition = source.indexOf('window.AdminApp.theme.initThemeForm()');
  const displayFormPosition = source.indexOf('window.AdminApp.display.initDisplayForm()');

  assert.ok(loadPosition >= 0, 'theme configuration should be loaded');
  assert.ok(loadPosition < themeFormPosition, 'theme presets should load before the theme form');
  assert.ok(loadPosition < displayFormPosition, 'theme presets should load before the display form');
});

test('song request and display board forms autosave every parameter change', () => {
  const themeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8'
  );
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8'
  );

  assert.match(themeSource, /themeForm\.addEventListener\('input', autosaveTheme\)/);
  assert.match(themeSource, /themeForm\.addEventListener\('change', autosaveTheme\)/);
  assert.match(displaySource, /displayForm\.addEventListener\('input', autosaveDisplay\)/);
  assert.match(displaySource, /displayForm\.addEventListener\('change', autosaveDisplay\)/);

  assert.match(themeSource, /classicPresets[\s\S]*?await saveTheme\(\)/);
  assert.match(themeSource, /quickBeautifyBtn[\s\S]*?await saveTheme\(\)/);
  assert.match(themeSource, /resetClassicTheme[\s\S]*?await saveTheme\(\)/);
  assert.match(displaySource, /songBoardPresets[\s\S]*?await saveDisplay\(\)/);
  assert.match(displaySource, /songBoardResetTheme[\s\S]*?await saveDisplay\(\)/);
  assert.doesNotMatch(themeSource, /保存后生效/);
  assert.doesNotMatch(displaySource, /保存后生效/);
});

test('early theme preset references receive asynchronously loaded data', async () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'),
    'utf8'
  ));
  const browserWindow = { AdminApp: {} };
  const themeModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    {
      window: browserWindow,
      fetch: async () => ({ ok: true, json: async () => config })
    }
  );
  const earlyClassicPresets = themeModule.getAllClassicPresets();
  const earlySongBoardPresets = themeModule.getAllSongBoardPresets();

  assert.deepEqual(Object.keys(earlyClassicPresets), []);
  await themeModule.loadThemeConfig();
  assert.equal(themeModule.getAllClassicPresets(), earlyClassicPresets);
  assert.equal(themeModule.getAllSongBoardPresets(), earlySongBoardPresets);
  assert.equal(Object.keys(earlyClassicPresets).length, 14);
  assert.equal(Object.keys(earlySongBoardPresets).length, 14);
});

test('shared theme compatibility keeps admin theme form methods', async () => {
  const initThemeForm = () => {};
  const browserWindow = { AdminApp: { theme: { initThemeForm } } };

  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    { window: browserWindow }
  );

  assert.equal(browserWindow.AdminApp.theme.initThemeForm, initThemeForm);
  assert.equal(typeof browserWindow.AdminApp.theme.loadThemeConfig, 'function');
  const defaultThemeDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow.AdminApp.theme,
    'defaultThemeLook'
  );
  assert.equal(typeof defaultThemeDescriptor.get, 'function');
});

test('debug gift data attributes escape quotes, apostrophes, and backticks', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'debug-gifts.html'), 'utf8');
  const escapeHtmlSource = source.match(/function escHtml\(s\) \{[\s\S]*?\n\}/)?.[0];
  const escapeAttrSource = source.match(/function escAttr\(s\) \{[\s\S]*?\n\}/)?.[0];

  assert.ok(escapeHtmlSource, 'escHtml should remain defined');
  assert.ok(escapeAttrSource, 'escAttr should be defined for data attributes');

  const sandbox = {
    document: {
      createElement() {
        let text = '';
        return {
          set textContent(value) { text = String(value); },
          get innerHTML() {
            return text
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;');
          }
        };
      }
    }
  };
  vm.runInNewContext(`${escapeHtmlSource}\n${escapeAttrSource}`, sandbox);

  assert.equal(
    sandbox.escAttr('"quoted\' `value`'),
    '&quot;quoted&#39; &#96;value&#96;'
  );
});

test('fullscreen resets lyric mode before rendering a different track', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  let renderedMode = '';

  player.fsEl = { classList: { contains: () => true } };
  player.lyricMode = 'trans';
  player._lastLyricTrackId = 'old-track';
  player.lyricTogglesEl = { style: {} };
  player.renderTrackInfo = () => {};
  player.renderArtwork = () => {};
  player.applyBackgroundTheme = () => {};
  player.updateVinylAnimation = () => {};
  player.renderLyrics = () => { renderedMode = player.lyricMode; };

  player.render({ id: 'new-track', lyrics: { lines: [] } }, { paused: false });

  assert.equal(renderedMode, 'none');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player._lastLyricTrackId, 'new-track');
});

test('fullscreen lyric buttons follow available track data in romanization-first order', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const romaButtonPosition = html.indexOf('id="fsRomaToggleBtn"');
  const translationButtonPosition = html.indexOf('id="fsTranslationToggleBtn"');

  assert.ok(romaButtonPosition >= 0, 'romanization button should exist');
  assert.ok(translationButtonPosition >= 0, 'translation button should exist');
  assert.ok(romaButtonPosition < translationButtonPosition, 'romanization button should be above translation');

  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  player.lyricTogglesEl = { style: {} };
  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'flex');
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'none');

  player._updateLyricToggles({ lyrics: { lines: [{ translation: '中文译' }] } });
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({ lyrics: { lines: [{ roma: 'romaji', translation: '中文译' }] } });
  assert.equal(player.romaToggleBtn.style.display, 'grid');
  assert.equal(player.translationToggleBtn.style.display, 'grid');

  player._updateLyricToggles({ lyrics: { lines: [{ text: '原文' }] } });
  assert.equal(player.lyricTogglesEl.style.display, 'none');
  assert.equal(player.romaToggleBtn.style.display, 'none');
  assert.equal(player.translationToggleBtn.style.display, 'none');
});

test('fullscreen lyric buttons switch mutually exclusively and close the active mode', async () => {
  const { FullscreenPlayer } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'fullscreen.js')
  );
  const player = new FullscreenPlayer();
  let renderCount = 0;

  player.romaToggleBtn = createLyricToggleButton();
  player.translationToggleBtn = createLyricToggleButton();
  player._lastLyricLines = [{ text: '原文' }];
  player.renderLyricLines = () => { renderCount += 1; };

  player._toggleLyricMode('roma');
  assert.equal(player.lyricMode, 'roma');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), true);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'trans');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), true);

  player._toggleLyricMode('trans');
  assert.equal(player.lyricMode, 'none');
  assert.equal(player.romaToggleBtn.classList.contains('mode-roma'), false);
  assert.equal(player.translationToggleBtn.classList.contains('mode-trans'), false);
  assert.equal(renderCount, 3);
});

test('liked tracks continue past fifty full pages', async () => {
  let requestCount = 0;
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch(_url, options) {
        const { offset } = JSON.parse(options.body);
        requestCount += 1;
        const tracks = offset < 5100
          ? Array.from({ length: 100 }, (_, index) => ({ id: `track-${offset + index}` }))
          : [];
        return response({ ok: true, data: { tracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 5100);
  assert.equal(requestCount, 52);
});

test('liked tracks stop when a provider repeats a full page', async () => {
  let requestCount = 0;
  const repeatedTracks = Array.from({ length: 100 }, (_, index) => ({ id: `track-${index}` }));
  const { ContentLoader } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'content', 'loader.js'),
    {
      async fetch() {
        requestCount += 1;
        return response({ ok: true, data: { tracks: repeatedTracks } });
      }
    }
  );
  const loader = new ContentLoader({
    state: { selectedSource: 'qq' },
    readJsonResponse: async (result) => result.payload
  });

  const result = await loader._fetchLikedTracksAll('Liked');

  assert.equal(result.items.length, 100);
  assert.equal(requestCount, 2);
});

test('queue overlay applies rule sizing and scrolls only overflowing super chats', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styleValues = new Map();
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: {
      addEventListener() {},
      documentElement: {
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  sandbox.setIdentityRuleThemeVars(sandbox.document.documentElement, { overlayRuleFontSize: 12 });
  assert.equal(styleValues.get('--identity-rule-font-size'), '24px');

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = { scrollWidth: 90, animate() { assert.fail('short text must not animate'); } };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText }
  ];

  sandbox.scheduleIdentitySuperChatScroll({ querySelectorAll: () => containers });
  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-200px)');
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);

  const timing = sandbox.bounceScrollTiming(12);
  const verticalTopPauseSeconds = (
    timing.topPauseEndPercent / 100
  ) * timing.totalSeconds;
  const verticalPauseSeconds = (
    (timing.pauseEndPercent - timing.downPercent) / 100
  ) * timing.totalSeconds;
  assert.ok(Math.abs(verticalTopPauseSeconds - 1.5) < 0.000001);
  assert.ok(Math.abs(verticalPauseSeconds - 1.5) < 0.000001);
});

test('identity queue has an independent scroll speed setting', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueScrollSpeedRange"/);
  assert.match(html, /id="identityQueueScrollSpeed"/);
  assert.match(formSource, /identityQueueScrollSpeed:/);
  assert.match(defaultsSource, /identityQueueScrollSpeed: '80'/);
});

test('identity queue has an independent shared content font size setting', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const formsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueFontSize"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(html, /id="identityQueueFontSizeNumber"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(formSource, /identityQueueFontSize: value\('identityQueueFontSize'\)/);
  assert.match(formsSource, /identityQueueFontSize, 26, 78, 9/);
  assert.match(defaultsSource, /identityQueueFontSize: '26'/);
  assert.match(overlaySource, /--identity-queue-font-size.*identityQueueFontSize\(settings\)/);
  assert.match(overlayStyles, /\.identity-row\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/);
  assert.match(overlayStyles, /\.identity-rank\s*\{[\s\S]*?font-size:\s*inherit/);
  assert.match(overlayStyles, /\.identity-requester\s*\{[\s\S]*?font-size:\s*inherit/);
  const identityBlockRules = [...overlayStyles.matchAll(/\.identity-badge,\s*\.identity-medal\s*\{[^}]*\}/g)];
  const identityBlockRule = identityBlockRules.at(-1)?.[0];
  const medalRules = [...overlayStyles.matchAll(/\.identity-medal\s*\{[^}]*\}/g)];
  const medalRule = medalRules.at(-1)?.[0];
  assert.ok(identityBlockRule);
  assert.ok(medalRule);
  assert.match(identityBlockRule, /font-size:\s*75%/);
  assert.match(identityBlockRule, /height:\s*max\(16px,\s*1\.15em\)/);
  assert.match(identityBlockRule, /padding:\s*0\s+0\.24em/);
  assert.match(identityBlockRule, /border-radius:\s*max\(3px,\s*0\.15em\)/);
  assert.doesNotMatch(identityBlockRule, /overlay-font-scale/);
  assert.match(medalRule, /min-width:\s*1\.45em/);
  assert.doesNotMatch(medalRule, /max-width/);
});

test('identity content scrolls as one stream only when its rendered width overflows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longText = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = {
    scrollWidth: 90,
    animate() { assert.fail('fitting song text must not animate'); }
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longText },
    { clientWidth: 100, querySelector: () => shortText }
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    ['translateX(0)', 'translateX(0)', 'translateX(-200px)', 'translateX(-200px)', 'translateX(0)']
  );
  assert.equal(
    Math.round((longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) * longAnimation.options.duration),
    1000
  );
  assert.equal(
    Math.round((longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) * longAnimation.options.duration),
    1000
  );
  assert.doesNotMatch(sandbox.renderIdentityRow({ song_name: '1' }, 0), / • /);
});

test('identity queue keeps song and requester fields in one continuous stream', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  const row = sandbox.renderIdentityRow({
    song_name: '米粒bb万岁万万岁',
    requester_name: '很长的点歌人',
    requester_guard_level: 2,
    requester_medal_name: '灯牌',
    requester_medal_level: 26
  }, 0);
  assert.match(
    row,
    /identity-content-wrapper[\s\S]*identity-content[\s\S]*identity-song[\s\S]*identity-requester[\s\S]*identity-badge[\s\S]*identity-medal/
  );
  assert.doesNotMatch(row, /identity-song-wrapper|identity-details-wrapper|identity-details/);
  const contentWrapperRule = overlayStyles.match(/\.identity-content-wrapper\s*\{[^}]*\}/)?.[0];
  const contentRule = overlayStyles.match(/\.identity-content\s*\{[^}]*\}/)?.[0];
  assert.ok(contentWrapperRule);
  assert.ok(contentRule);
  assert.match(contentWrapperRule, /flex:\s*1 1 auto/);
  assert.match(contentWrapperRule, /overflow:\s*hidden/);
  assert.match(contentRule, /display:\s*inline-flex/);
  assert.match(contentRule, /min-width:\s*max-content/);
  assert.match(contentRule, /gap:\s*max\(4px,\s*0\.3em\)/);
  assert.doesNotMatch(overlayStyles, /\.identity-song-wrapper|\.identity-details-wrapper|\.identity-details/);
  assert.doesNotMatch(overlayStyles, /transform:\s*translateX\(-52px\)/);

  let longAnimation = null;
  const longContent = {
    scrollWidth: 300,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortContent = {
    scrollWidth: 90,
    animate() { assert.fail('fitting identity content must not animate'); }
  };
  const containers = [
    { clientWidth: 100, querySelector: () => longContent },
    { clientWidth: 100, querySelector: () => shortContent }
  ];

  sandbox.scheduleIdentityContentScroll({ querySelectorAll: () => containers });

  assert.ok(longAnimation);
  assert.deepEqual(
    Array.from(longAnimation.keyframes, (frame) => frame.transform),
    ['translateX(0)', 'translateX(0)', 'translateX(-200px)', 'translateX(-200px)', 'translateX(0)']
  );
  assert.equal(
    Math.round((longAnimation.keyframes[1].offset - longAnimation.keyframes[0].offset) * longAnimation.options.duration),
    1000
  );
  assert.equal(
    Math.round((longAnimation.keyframes[3].offset - longAnimation.keyframes[2].offset) * longAnimation.options.duration),
    1000
  );
});

test('song list exposes a display board font size control', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  const displaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');
  const themePage = html.match(/<div id="themePage"[\s\S]*?<div id="displayPage"/)?.[0];

  assert.ok(themePage);
  assert.doesNotMatch(themePage, /songBoardFontSize/);
  assert.match(html, /id="displayPage"[\s\S]*id="songBoardFontSize"[^>]*min="10"[^>]*max="80"[^>]*value="50"/);
  assert.match(displaySource, /songBoardFontSize: value\('songBoardFontSize'\)/);
  assert.match(overlaySource, /Math\.max\(10, Math\.min\(80, Number\(settings\.songBoardFontSize\) \|\| 50\)\)/);
  assert.match(overlayStyles, /\.song-board \{[\s\S]*font-size: calc\(16px \* var\(--overlay-font-scale, 1\)\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-content \{[\s\S]*padding: clamp\(5px, calc\(8px \* var\(--overlay-font-scale, 1\)\), 18px\)/);
  assert.match(overlayStyles, /\.song-board \.overlay-title \{[\s\S]*var\(--overlay-title-font-size, 15px\) \* var\(--overlay-font-scale, 1\)/);
  assert.match(defaultsSource, /songBoardFontSize: '50'/);
});

test('song board keeps song names readable in narrow browser sources', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const overlayStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const songModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'),
    {
      document: { addEventListener() {} },
      location: { protocol: 'http:', host: 'localhost', search: '' },
      URLSearchParams,
      WebSocket: function WebSocket() {}
    }
  );

  const listRule = overlayStyles.match(/\.song-scroll-list\s*\{[^}]*\}/)?.[0];
  const cardRule = [...overlayStyles.matchAll(/\.song-card\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .find((rule) => /display:\s*flex/.test(rule));
  const nameRule = overlayStyles.match(/\.song-card strong\s*\{[^}]*\}/)?.[0];
  const artistRule = overlayStyles.match(/\.song-card span\s*\{[^}]*\}/)?.[0];
  const headerRule = overlayStyles.match(/\.song-board \.overlay-header\s*\{[^}]*\}/)?.[0];
  assert.ok(listRule);
  assert.ok(cardRule);
  assert.ok(nameRule);
  assert.ok(artistRule);
  assert.ok(headerRule);
  assert.match(listRule, /grid-auto-rows:\s*max-content/);
  assert.match(cardRule, /display:\s*flex/);
  assert.doesNotMatch(cardRule, /grid-template-columns/);
  assert.match(nameRule, /flex:\s*1 1 auto/);
  assert.match(nameRule, /min-width:\s*0/);
  assert.match(headerRule, /clamp\(4px, calc\(6px \* var\(--overlay-font-scale, 1\)\), 8px\)/);
  assert.match(artistRule, /max-width:\s*min\(32\.4%, 9em\)/);
  assert.match(artistRule, /font-size:\s*calc\(10\.5px \* var\(--overlay-font-scale, 1\)\)/);
  assert.doesNotMatch(artistRule, /letter-spacing/);
  assert.match(artistRule, /text-overflow:\s*ellipsis/);
  assert.match(artistRule, /white-space:\s*nowrap/);
  assert.match(overlayStyles, /@media \(max-width: 360px\)\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
  assert.match(overlayStyles, /@media \(max-width: 280px\)\s*\{[\s\S]*?\.song-card span\s*\{[\s\S]*?display:\s*none/);

  const flatRecords = songModule.buildSongRecords([
    { id: 1, name: 'A "song"', artist: 'Artist & guests / Guest Two / Guest Three' }
  ], 'length');
  assert.equal(flatRecords.length, 1);
  assert.equal(flatRecords[0].song.name, 'A "song"');
  assert.equal(flatRecords[0].artist, 'Artist & guests');

  const artistRecords = songModule.buildSongRecords([
    { id: 1, name: 'First', artist: 'Lead / Guest Two' },
    { id: 2, name: 'Second', artist: 'Lead / Guest Three' }
  ], 'artist');
  assert.deepEqual(
    Array.from(artistRecords, (record) => record.type),
    ['heading', 'song', 'song']
  );
  assert.equal(artistRecords[0].label, 'Lead');
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /list\.innerHTML\s*=\s*html/);
});

test('song virtual scroller bounds the DOM to two viewports above and three below', async () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'songs.html'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  assert.match(html, /<script type="module" src="\/js\/overlays\/songs\.js\?v=[^"]+"><\/script>/);
  assert.match(source, /new SongVirtualScroller\(\{[\s\S]*beforeViewports: 2,[\s\S]*afterViewports: 3/);
  assert.match(source, /new ResizeObserver\(\(\) => scheduleRelayout\(\{ delay: 120 \}\)\)/);
  assert.doesNotMatch(styles, /@keyframes song-scroll/);
  assert.doesNotMatch(source, /insertAdjacentHTML|\.innerHTML\s*=/);

  class FakeNode {
    constructor(height, key) {
      this.dataset = { key };
      this.height = height;
      this.parentElement = null;
    }

    get offsetHeight() {
      return this.height;
    }

    get offsetTop() {
      if (!this.parentElement) return 0;
      const index = this.parentElement.children.indexOf(this);
      return this.parentElement.offsetTop + this.parentElement.children
        .slice(0, index)
        .reduce((total, node) => total + node.offsetHeight + this.parentElement.gap, 0);
    }

    remove() {
      const index = this.parentElement?.children.indexOf(this) ?? -1;
      if (index >= 0) this.parentElement.children.splice(index, 1);
      this.parentElement = null;
    }
  }

  class FakeContent {
    constructor(gap = 8) {
      this.children = [];
      this.gap = gap;
      this.offsetTop = 50;
    }

    get firstElementChild() {
      return this.children[0] ?? null;
    }

    get lastElementChild() {
      return this.children.at(-1) ?? null;
    }

    get scrollHeight() {
      if (this.children.length === 0) return 0;
      return this.children.reduce((total, node) => total + node.offsetHeight, 0)
        + (this.children.length - 1) * this.gap;
    }

    append(node) {
      node.parentElement = this;
      this.children.push(node);
    }

    prepend(node) {
      node.parentElement = this;
      this.children.unshift(node);
    }

    replaceChildren(...nodes) {
      this.children.forEach((node) => { node.parentElement = null; });
      this.children = [];
      nodes.forEach((node) => this.append(node));
    }
  }

  const {
    SongVirtualScroller,
    bufferPixels,
    pixelsPerSecond,
    wrapIndex
  } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js')
  );
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(pixelsPerSecond(300, 12), 25);
  assert.deepEqual(Array.from(bufferPixels(100, 2, 3)), [200, 300]);

  const content = new FakeContent();
  const viewport = {
    clientHeight: 100,
    currentScrollTop: 0,
    get scrollTop() {
      return this.currentScrollTop;
    },
    set scrollTop(value) {
      this.currentScrollTop = Math.min(
        Math.max(0, value),
        Math.max(0, content.scrollHeight - this.clientHeight)
      );
    }
  };
  const records = Array.from({ length: 1000 }, (_, index) => ({ key: `song:${index}` }));
  const scroller = new SongVirtualScroller({
    viewport,
    content,
    createNode: (record) => new FakeNode(20, record.key),
    requestFrame() { return 1; },
    cancelFrame() {}
  });

  scroller.setRecords(records, { key: 'song:500', offset: 5 });
  assert.equal(scroller.beforeViewports, 2);
  assert.equal(scroller.afterViewports, 3);
  assert.ok(content.children.length < 40, `expected a bounded DOM, got ${content.children.length} nodes`);
  assert.ok(viewport.scrollTop >= 200);
  assert.equal(scroller.captureAnchor().key, 'song:500');

  const originalCount = content.children.length;
  scroller.advanceBy(250);
  assert.ok(content.children.length <= originalCount + 1);
  assert.notEqual(scroller.captureAnchor().key, 'song:500');

  const shortContent = new FakeContent();
  const shortScroller = new SongVirtualScroller({
    viewport: { clientHeight: 100, scrollTop: 0 },
    content: shortContent,
    createNode: (record) => new FakeNode(20, record.key),
    requestFrame() { return 1; },
    cancelFrame() {}
  });
  shortScroller.setRecords(records.slice(0, 2));
  assert.equal(shortContent.children.length, 2);
  assert.equal(shortScroller.isScrollable, false);
});

test('overlay utility helpers preserve shared formatting behavior', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'overlay-utils.js'),
    'utf8'
  );
  const sandbox = {
    URLSearchParams,
    location: { search: '?quality=low' },
    window: {}
  };

  vm.runInNewContext(source, sandbox);
  const utils = sandbox.window.OverlayUtils;

  assert.equal(utils.escapeHtml('"quoted" & <tag>'), '&quot;quoted&quot; &amp; &lt;tag&gt;');
  const rgb = utils.hexToRgb('#abc');
  assert.equal(rgb.r, 170);
  assert.equal(rgb.g, 187);
  assert.equal(rgb.b, 204);
  assert.equal(utils.hexToRgba('#123456', 2), 'rgba(18, 52, 86, 1)');
  assert.equal(utils.withMultilingualFallback('Noto Sans'), 'Noto Sans, "Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif');
  assert.equal(utils.scrollTravelSeconds(12, 800, 300), 32);
  assert.equal(utils.overlayLowPowerEnabled({ overlayLowPowerMode: 'false' }), true);
});

test('identity rule text scrolls independently only when it overflows', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    requestAnimationFrame(callback) { callback(); },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(source, sandbox);

  let longAnimation = null;
  const longClasses = new Set();
  const longText = {
    scrollWidth: 220,
    animate(keyframes, options) { longAnimation = { keyframes, options }; }
  };
  const shortText = {
    scrollWidth: 90,
    animate() { assert.fail('short rule text must not animate'); }
  };
  const longContainer = {
    clientWidth: 100,
    querySelector: () => longText,
    classList: { add(name) { longClasses.add(name); } }
  };
  const shortContainer = {
    clientWidth: 100,
    querySelector: () => shortText,
    classList: { add() {} }
  };

  sandbox.scheduleIdentityRuleScroll({
    querySelectorAll: () => [longContainer, shortContainer]
  });

  assert.ok(longAnimation);
  assert.equal(longAnimation.keyframes[1].transform, 'translateX(-120px)');
  assert.ok(longClasses.has('is-scrolling'));
  const pauseMilliseconds = (
    longAnimation.keyframes[2].offset - longAnimation.keyframes[1].offset
  ) * longAnimation.options.duration;
  assert.ok(Math.abs(pauseMilliseconds - 1500) < 0.001);
});

test('classic queue uses calculated row height and sizes indexes with song text', () => {
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'base.css'), 'utf8');
  const waitingRule = styles.match(/\.overlay-waiting\s*\{[\s\S]*?\n\}/)?.[0];
  const windowRule = styles.match(/\.classic-list-window\s*\{[\s\S]*?\n\}/)?.[0];
  const indexRule = styles.match(/\.overlay-waiting-row \.index\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(waitingRule, 'classic queue list styles should remain defined');
  assert.ok(windowRule, 'classic queue viewport styles should remain defined');
  assert.ok(indexRule, 'classic queue index styles should remain defined');
  assert.doesNotMatch(waitingRule, /--classic-row-height/);
  assert.doesNotMatch(windowRule, /--classic-row-height/);
  assert.match(indexRule, /font-size:\s*var\(--overlay-waiting-font-size,\s*13px\)/);
  assert.match(overlaySource, /setTimeout\(relayoutQueue, 100\)/);
  assert.doesNotMatch(overlaySource, /overlayResizeTimer = setTimeout\(render, 100\)/);
  assert.match(overlaySource, /data-loop-clone/);
  assert.match(styles, /--overlay-edge:\s*clamp\(0px,\s*2vmin,\s*16px\)/);
  assert.match(styles, /\.queue-classic\s*\{[\s\S]*?width:\s*min\(405px,\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)\)/);
  assert.match(styles, /\.queue-identity\s*\{[\s\S]*?width:\s*min\(430px,\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)\)/);
  assert.match(styles, /\.queue-viewport-resized \.queue-classic\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/);
  assert.match(styles, /\.queue-viewport-resized \.queue-identity\s*\{[\s\S]*?width:\s*calc\(100vw - \(2 \* var\(--overlay-edge\)\)\)/);
});

test('queue resize helpers preserve real rows while rebuilding loop copies', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'queue.js'), 'utf8');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  const removed = [];
  const realRow = { remove() { assert.fail('real queue rows must remain mounted'); } };
  const cloneRows = [
    { remove() { removed.push('first'); } },
    { remove() { removed.push('second'); } }
  ];
  const list = {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-loop-clone="true"]');
      return cloneRows;
    },
    children: [realRow, ...cloneRows]
  };

  sandbox.removeQueueLoopClones(list);
  assert.deepEqual(removed, ['first', 'second']);
});

test('identity queue scrolls from actual overflow', () => {
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
        style: { setProperty(name, value) { styleValues.set(name, value); } }
      }
    }
  };
  vm.runInNewContext(source, sandbox);

  const classes = new Set(['identity-list', 'paused']);
  let duplicatedHtml = '';
  const list = {
    scrollHeight: 500,
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    },
    insertAdjacentHTML(_position, html) { duplicatedHtml += html; }
  };

  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, list, {
      queueScrollMode: 'loop',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-loop-distance'), '504px');
  assert.equal(
    styleValues.get('--scroll-seconds'),
    `${sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 504, 300)}s`
  );
  assert.equal(duplicatedHtml, '<div>rows</div>');
  assert.equal(classes.has('paused'), false);
  assert.equal(classes.has('scrolling'), true);

  const bounceClasses = new Set(['identity-list', 'paused']);
  const bounceList = {
    scrollHeight: 500,
    classList: {
      add(name) { bounceClasses.add(name); },
      remove(name) { bounceClasses.delete(name); }
    },
    insertAdjacentHTML() { assert.fail('bounce content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, bounceList, {
      queueScrollMode: 'bounce',
      queueScrollSpeed: '10',
      identityQueueScrollSpeed: '42'
    }, '<div>rows</div>', 4),
    true
  );
  assert.equal(styleValues.get('--identity-bounce-distance'), '200px');
  const bounceTiming = sandbox.bounceScrollTiming(
    sandbox.scrollTravelSeconds(sandbox.queueScrollSeconds({ identityQueueScrollSpeed: '42' }, 'identityQueueScrollSpeed'), 200, 300),
    sandbox.scrollTravelSeconds(3, 200, 300)
  );
  assert.equal(styleValues.get('--scroll-seconds'), `${bounceTiming.totalSeconds}s`);
  assert.equal(bounceClasses.has('paused'), false);
  assert.equal(bounceClasses.has('scrolling-bounce'), true);

  const fittingList = {
    scrollHeight: 280,
    classList: { add() {}, remove() {} },
    insertAdjacentHTML() { assert.fail('fitting content must not be duplicated'); }
  };
  assert.equal(
    sandbox.configureIdentityVerticalScroll({ clientHeight: 300 }, fittingList, {}, '', 4),
    false
  );

  const shortDistance = 200;
  const longDistance = 800;
  const shortSeconds = sandbox.scrollTravelSeconds(12, shortDistance, 300);
  const longSeconds = sandbox.scrollTravelSeconds(12, longDistance, 300);
  assert.ok(Math.abs((shortDistance / shortSeconds) - (longDistance / longSeconds)) < 0.001);
});

test('song board scroll speed stays constant as content grows', async () => {
  const adminHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');
  assert.match(adminHtml, /id="scrollSecondsRange" type="range" min="1" max="100"/);
  assert.match(adminHtml, /id="scrollSeconds" type="number" min="1" max="100"/);
  const songModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'songs.js'),
    {
      document: { addEventListener() {} },
      location: { protocol: 'http:', host: 'localhost', search: '' },
      URLSearchParams,
      WebSocket: function WebSocket() {}
    }
  );
  const { pixelsPerSecond } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'song-virtual-scroller.js')
  );

  assert.equal(songModule.scrollSpeedToDuration(1), '20.557851');
  assert.equal(songModule.scrollSpeedToDuration(100), '2.000000');
  assert.equal(songModule.scrollSpeedToDuration(200), '2.000000');

  const rates = Array.from({ length: 100 }, (_, index) => index + 1).map((speed) => (
    1 / Number(songModule.scrollSpeedToDuration(speed))
  ));
  const rateSteps = rates.slice(1).map((rate, index) => rate - rates[index]);
  assert.ok(rateSteps.every((step) => Math.abs(step - rateSteps[0]) < 0.000001));

  const secondsPerViewport = Number(songModule.scrollSpeedToDuration(80));
  const rate = pixelsPerSecond(300, secondsPerViewport);
  assert.equal(rate, 300 / secondsPerViewport);
  assert.ok(Math.abs(((rate * 2) / 2) - ((rate * 20) / 20)) < 0.000001);
});

test('only the latest playback search updates state and renders', async () => {
  const pending = new Map();
  const renderedIds = [];
  let keyword = 'old';
  const document = {
    getElementById() {
      return { textContent: '' };
    }
  };
  const { SearchService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'search-service.js'),
    {
      fetch(_url, options) {
        const request = JSON.parse(options.body);
        return new Promise((resolve) => pending.set(request.keyword, resolve));
      }
    }
  );
  const searchService = new SearchService({
    state: { selectedSource: 'test' },
    readJsonResponse: async (searchResponse) => searchResponse.payload
  });
  const { createSearchHandler } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'features', 'search-handler.js'),
    { document }
  );
  const handler = createSearchHandler({
    playbackState: {},
    searchService,
    value(id) {
      return id === 'playbackSearchKeyword' ? keyword : '9';
    },
    toast() {},
    renderPlaybackSearchResults() {
      renderedIds.push(searchService.getResults()[0]?.id ?? '');
    }
  });

  const oldSearch = handler.runPlaybackSearch();
  keyword = 'new';
  const newSearch = handler.runPlaybackSearch();
  pending.get('new')(response({ ok: true, data: { tracks: [{ id: 'new-result' }] } }));
  await newSearch;
  pending.get('old')(response({ ok: true, data: { tracks: [{ id: 'old-result' }] } }));
  await oldSearch;

  assert.equal(searchService.getResults()[0]?.id, 'new-result');
  assert.deepEqual(renderedIds, ['new-result']);
});

function createLyricToggleButton() {
  const classes = new Set();
  return {
    style: {},
    title: '',
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      }
    }
  };
}

async function loadModuleExports(entryPath, globals = {}) {
  const context = vm.createContext({
    console,
    fetch: globals.fetch,
    window: {},
    ...globals
  });
  const modules = new Map();

  async function load(filePath) {
    const identifier = pathToFileURL(filePath).href;
    if (modules.has(identifier)) return modules.get(identifier);
    const module = new vm.SourceTextModule(fs.readFileSync(filePath, 'utf8'), {
      context,
      identifier
    });
    modules.set(identifier, module);
    await module.link((specifier, referencingModule) => {
      const dependencyUrl = new URL(specifier, referencingModule.identifier);
      return load(fileURLToPath(dependencyUrl));
    });
    return module;
  }

  const module = await load(entryPath);
  await module.evaluate();
  return module.namespace;
}

function response(payload) {
  return { ok: payload.ok !== false, payload };
}
