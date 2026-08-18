'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

function readOvertimeAdminSource() {
  return [
    'overtime-rule-editor.js',
    'overtime.js'
  ].map(file => fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', file), 'utf8')).join('\n');
}

test('queue overlay applies rule sizing and scrolls only overflowing super chats', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
  const html = readAdminHtml();
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueScrollSpeedRange"/);
  assert.match(html, /id="identityQueueScrollSpeed"/);
  assert.match(formSource, /identityQueueScrollSpeed:/);
  assert.match(defaultsSource, /identityQueueScrollSpeed: '80'/);
});

test('identity queue has an independent shared content font size setting', () => {
  const html = readAdminHtml();
  const formSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'), 'utf8');
  const formsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), 'utf8');
  const overlaySource = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
  const defaultsSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'storage', 'settings-store.js'), 'utf8');

  assert.match(html, /id="identityQueueFontSize"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(html, /id="identityQueueFontSizeNumber"[^>]*min="9"[^>]*max="78"[^>]*value="26"/);
  assert.match(formSource, /identityQueueFontSize: value\('identityQueueFontSize'\)/);
  assert.match(formsSource, /identityQueueFontSize, 26, 78, 9/);
  assert.match(defaultsSource, /identityQueueFontSize: '26'/);
  assert.match(overlaySource, /--identity-queue-font-size.*identityQueueFontSize\(settings\)/);
  assert.match(overlayStyles, /\.identity-row\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/);
  assert.match(overlayStyles, /\.identity-pin-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/);
  assert.match(overlayStyles, /\.identity-row\.identity-sc \.identity-sc-content\s*\{[\s\S]*?font-size:\s*var\(--identity-queue-font-size,\s*26px\)/);
  assert.match(overlayStyles, /\.identity-pin-row\s*\{[\s\S]*?height:\s*var\(--identity-row-height,\s*42px\)/);
  assert.match(overlayStyles, /\.identity-pin-label\s*\{[\s\S]*?height:\s*1\.6em[\s\S]*?border-radius:\s*0\.3em[\s\S]*?padding:\s*0\s+0\.4em[\s\S]*?font-size:\s*calc\(var\(--identity-queue-font-size,\s*26px\)\s*\*\s*0\.77\)/);
  assert.match(overlayStyles, /\.identity-rank\s*\{[\s\S]*?font-size:\s*inherit/);
  assert.match(overlayStyles, /\.identity-requester\s*\{[\s\S]*?font-size:\s*inherit/);
  const identityBlockRules = [...overlayStyles.matchAll(/\.identity-badge,\s*\.identity-medal\s*\{[^}]*\}/g)];
  const identityBlockRule = identityBlockRules.at(-1)?.[0];
  const medalRules = [...overlayStyles.matchAll(/\.identity-medal\s*\{[^}]*\}/g)];
  const medalRule = medalRules.at(-1)?.[0];
  assert.ok(identityBlockRule);
  assert.ok(medalRule);
  assert.match(identityBlockRule, /font-size:\s*75%/);
  assert.match(identityBlockRule, /height:\s*max\(17\.6px,\s*1\.265em\)/);
  assert.match(identityBlockRule, /padding:\s*0\s+0\.24em/);
  assert.match(identityBlockRule, /border-radius:\s*max\(3px,\s*0\.15em\)/);
  assert.doesNotMatch(identityBlockRule, /overlay-font-scale/);
  assert.match(medalRule, /min-width:\s*1\.45em/);
  assert.doesNotMatch(medalRule, /max-width/);
});

test('identity content scrolls as one stream only when its rendered width overflows', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const overlayStyles = readCssBundle('public', 'css', 'overlays', 'base.css');
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

test('overtime toolbox panel loads its isolated controller and renders untrusted labels safely', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');
  const source = readOvertimeAdminSource();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');

  assert.match(html, /id="overtimePanel"/);
  assert.match(html, /id="overtimeClockValue"/);
  assert.match(html, /id="overtimeRules"/);
  assert.match(html, /id="overtimeGiftPicker"/);
  assert.match(html, /id="overtimeRefreshGiftsBtn"/);
  assert.match(html, /id="overtimeGiftCatalogStatus"[^>]+role="status"/);
  assert.match(html, /id="overtimePreview"/);
  assert.match(entrySource, /import '\.\/overtime\.js';/);
  assert.match(styles, /@import url\('\.\/admin\/overtime\.css'\);/);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /fetch\('\/img\/bilibili-gifts\.json'/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts'/);
  assert.match(source, /\/api\/overtime\/gifts\/refresh/);
  assert.match(source, /catalogRoomLabel\(giftCatalogSnapshot, catalogLiveStatus\)/);
  assert.match(source, /liveStatus\?\.ownerName/);
  assert.match(source, /当前未在售/);
  assert.match(source, /\.sort\(\(left, right\) => left\.rmb - right\.rmb\)/);
  assert.match(source, /if \(!gift\.id\.startsWith\('guard-'\)\) \{[\s\S]*meta\.textContent = `¥\$\{gift\.rmb\.toFixed\(2\)\}`/);
  assert.doesNotMatch(source, /`ID \$\{gift\.id\}[^`]*`/);
  assert.match(source, /\/api\/overtime\/rules/);
  assert.match(source, /MAX_ENABLED_RULES\s*=\s*8/);
  assert.match(source, /该下播了/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime screen controls expose save state, visible errors, and a plain address copy action', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const utilitySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'), 'utf8');

  assert.match(html, /id="overtimeSaveBackgroundBtn"[^>]*>保存画面<\/button>/);
  assert.match(html, /id="overtimeCopyOverlayBtn"[^>]*>复制地址<\/button>/);
  assert.match(source, /overtimeBackgroundPath.*addEventListener\('change', markBackgroundDirty\)/s);
  assert.match(source, /overtimeBackgroundFit.*addEventListener\('change', markBackgroundDirty\)/s);
  assert.match(source, /showError\(error\)/);
  assert.match(source, /保存中…/);
  assert.match(source, /copyText\(overlayUrl\(\)\)/);
  assert.match(source, /地址已复制/);
  assert.match(utilitySource, /export async function copyText\(text\)/);
  assert.match(utilitySource, /navigator\.clipboard\?\.writeText/);
  assert.match(utilitySource, /execCommand\('copy'\)/);
});

test('overtime controller delegates rule editing through a narrow module boundary', () => {
  const controller = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'), 'utf8');
  const editor = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-editor.js'), 'utf8');

  assert.match(controller, /import \{ createOvertimeRuleEditor \} from '\.\/overtime-rule-editor\.js';/);
  assert.match(controller, /ruleEditor\.readRules\(\)/);
  assert.match(controller, /ruleEditor\.renderRules\(nextState\.rules\)/);
  assert.doesNotMatch(controller, /function createRuleRow/);
  assert.match(editor, /return \{ readRules, renderRules, createRule \};/);
});

test('overtime gift rule actions keep adding obvious and saving stateful', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'), 'utf8');

  assert.match(html, /id="overtimeAddGiftBtn" class="overtime-add-gift-action"/);
  assert.match(html, /id="overtimeSaveRulesBtn"[^>]+disabled>✓ 已保存<\/button>/);
  assert.match(html, /<h3>添加礼物<\/h3>/);
  assert.match(html, /placeholder="输入礼物名称"/);
  assert.doesNotMatch(html, /按名称或礼物 ID 搜索本地目录/);
  assert.match(source, /createOvertimeRuleEditor\(byId\('overtimeRules'\), markRulesDirty\)/);
  assert.match(source, /row\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(source, /toast\(`已添加 \$\{gift\.name\}`\)/);
  assert.match(overtimeStyles, /\.overtime-add-gift-action/);
  assert.match(overtimeStyles, /\.overtime-save-rules-action\.is-dirty/);
  assert.match(overtimeStyles, /--ot-action-add:\s*#6657c7/);
  assert.match(overtimeStyles, /--ot-action-save:\s*#147d73/);

  const stateStart = source.indexOf('function getRulesSaveButtonState');
  const stateEnd = source.indexOf('\nfunction syncRulesSaveButton', stateStart);
  const sandbox = {};
  vm.runInNewContext(`${source.slice(stateStart, stateEnd)}\nthis.getState = getRulesSaveButtonState;`, sandbox);
  assert.equal(sandbox.getState(false, false).label, '✓ 已保存');
  assert.equal(sandbox.getState(false, false).disabled, true);
  assert.equal(sandbox.getState(true, false).label, '保存修改');
  assert.equal(sandbox.getState(true, false).disabled, false);
  assert.equal(sandbox.getState(true, true).label, '保存中…');
  assert.equal(sandbox.getState(true, true).disabled, true);
});

test('overtime initial duration is minute-based, selectable, and readable', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'), 'utf8');

  assert.match(html, /id="overtimeInitialTime"[^>]+value="00:00"/);
  assert.match(html, /id="overtimeInitialHours"/);
  assert.match(html, /id="overtimeInitialMinutes"/);
  assert.doesNotMatch(html, /id="overtimeRemainingTime"/);
  assert.match(source, /remainingSeconds:\s*initialSeconds/);
  assert.match(source, /function parseInitialDuration/);
  assert.match(overtimeStyles, /\.overtime-actions button:disabled[\s\S]*?opacity:\s*1/);

  const helperStart = source.indexOf('function parseInitialDuration');
  const helperEnd = source.indexOf('\nfunction formatClock', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `const serverLimits = { maxSeconds: 315328464000, maxEffectFactor: 1000, maxRandomWeight: 100000, maxEnabledRules: 8 };\n` +
      `${source.slice(helperStart, helperEnd)}\n` +
      'this.helpers = { parseInitialDuration, formatInitialDuration };',
    sandbox
  );
  assert.equal(sandbox.helpers.parseInitialDuration('2:05'), 7500);
  assert.equal(sandbox.helpers.formatInitialDuration(7500), '02:05');
  assert.throws(() => sandbox.helpers.parseInitialDuration('02:05:30'), /HHH:MM/);
  assert.throws(() => sandbox.helpers.parseInitialDuration('02:60'), /分钟必须小于 60/);
});

test('overtime gift rules use novice-friendly structured controls', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'), 'utf8');

  assert.doesNotMatch(html, /添加礼物后，选择[“"]直接改时间[”"]或[“"]随机抽结果[”"]/);
  assert.match(source, /className = 'secondary overtime-rule-toggle'/);
  assert.match(source, /dataset\.ruleSummary/);
  assert.match(source, /body\.hidden = !expanded/);
  assert.match(source, /toggle\.setAttribute\('aria-expanded'/);
  assert.doesNotMatch(source, /这个礼物如何改变时间/);
  assert.doesNotMatch(source, /选择一种时间操作/);
  assert.match(source, /dataset\.ruleOperation/);
  for (const operation of ['add', 'subtract', 'multiply', 'divide', 'clear']) {
    assert.match(source, new RegExp(`createOperationOption\\(name, '${operation}'`));
  }
  assert.match(source, /dataset\[`duration\$\{part\[0\]\.toUpperCase\(\)\}\$\{part\.slice\(1\)\}`\]/);
  assert.match(source, /data-duration-\$\{part\}/);
  assert.match(source, /dataset\.randomOutcome/);
  assert.match(source, /dataset\.addOutcome/);
  assert.match(source, /系统会自动换算百分比/);
  assert.match(source, /function updateOutcomeProbabilities/);
  assert.doesNotMatch(source, /createElement\('textarea'\)/);
  assert.doesNotMatch(source, /应写成“\+00:05:00 \| 40”/);
  assert.match(overtimeStyles, /\.overtime-rule-mode-options/);
  assert.match(overtimeStyles, /\.overtime-rule-body/);
  assert.match(overtimeStyles, /\.overtime-rule-toggle/);
  assert.match(overtimeStyles, /\.overtime-rule-effect \[hidden\] \{ display: none !important; \}/);
  assert.match(overtimeStyles, /\.overtime-outcome-card/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-add/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-subtract/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-multiply/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-divide/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-clear/);

  const durationStart = source.indexOf('function readEffect');
  const durationEnd = source.indexOf('\n  function ruleButton', durationStart);
  const durationSandbox = {};
  vm.runInNewContext(
    source.slice(durationStart, durationEnd) + '\nthis.readEffect = readEffect;',
    durationSandbox
  );
  const durationRoot = (operation, hours, minutes, seconds, factor = 2) => ({
    querySelector(selector) {
      if (selector === '[data-rule-operation]:checked') return { value: operation };
      if (selector === '[data-effect-factor]') return { value: factor };
      if (selector === '[data-duration-hours]') return { value: hours };
      if (selector === '[data-duration-minutes]') return { value: minutes };
      if (selector === '[data-duration-seconds]') return { value: seconds };
      return null;
    }
  });
  assert.equal(
    JSON.stringify(durationSandbox.readEffect(durationRoot('add', '1', '2', '3'))),
    JSON.stringify({ operation: 'add', value: 3723 })
  );
  assert.equal(
    JSON.stringify(durationSandbox.readEffect(durationRoot('multiply', '', '', '', '8'))),
    JSON.stringify({ operation: 'multiply', value: 8 })
  );
  assert.equal(
    JSON.stringify(durationSandbox.readEffect(durationRoot('clear', '', '', ''))),
    JSON.stringify({ operation: 'clear', value: 0 })
  );
  assert.throws(
    () => durationSandbox.readEffect(durationRoot('divide', '', '', '', '1')),
    /倍数/
  );
  assert.equal(
    JSON.stringify(durationSandbox.readEffect(durationRoot('add', '999', '0', '0'))),
    JSON.stringify({ operation: 'add', value: 999 * 3600 })
  );

  const probabilityStart = source.indexOf('function updateOutcomeProbabilities');
  const probabilityEnd = source.indexOf('\n  function setEffectMode', probabilityStart);
  const probabilitySandbox = {};
  vm.runInNewContext(
    source.slice(probabilityStart, probabilityEnd) + '\nthis.updateOutcomeProbabilities = updateOutcomeProbabilities;',
    probabilitySandbox
  );
  const badges = [{}, {}];
  const cards = ['40', '60'].map((weight, index) => ({
    querySelector(selector) {
      return selector === '[data-outcome-weight]' ? { value: weight } : badges[index];
    }
  }));
  probabilitySandbox.updateOutcomeProbabilities({ querySelectorAll: () => cards });
  assert.equal(badges[0].textContent, '约 40%');
  assert.equal(badges[1].textContent, '约 60%');
});

test('identity queue shows the actual room medal name for a requester without guard status', () => {
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const sandbox = {
    console,
    URLSearchParams,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: function WebSocket() {},
    document: { addEventListener() {} },
    window: {}
  };
  vm.runInNewContext(source, sandbox);

  const imillyRow = sandbox.renderIdentityRow({
    song_name: '测试歌曲',
    requester_name: '点歌人',
    requester_guard_level: 0,
    requester_medal_name: 'imilly',
    requester_medal_level: 26
  }, 0);
  const otherRoomRow = sandbox.renderIdentityRow({
    song_name: '测试歌曲',
    requester_name: '点歌人',
    requester_guard_level: 0,
    requester_medal_name: '其他灯牌',
    requester_medal_level: 12
  }, 0);

  assert.match(imillyRow, /identity-badge identity-fan">imilly</);
  assert.doesNotMatch(imillyRow, /舰长/);
  assert.match(otherRoomRow, /identity-badge identity-fan">其他灯牌</);
  assert.doesNotMatch(otherRoomRow, /imilly/);
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
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
  const overlaySource = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
  const styles = readCssBundle('public', 'css', 'overlays', 'base.css');
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
  const source = readJsModuleBundle('public', 'js', 'overlays', 'queue.js');
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
