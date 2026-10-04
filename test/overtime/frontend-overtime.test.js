'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

function readOvertimeAdminSource() {
  return [
    'overtime-rule-model.js',
    'overtime-rule-effect-editor.js',
    'overtime-rule-editor.js',
    'overtime-time-view.js',
    'overtime-status-view.js',
    'overtime-preview.js',
    'overtime-preview-factory.js',
    'overtime.js',
  ]
    .map((file) =>
      fs
        .readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', file), 'utf8')
        .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
        .replace(/^export\s+/gm, ''),
    )
    .join('\n');
}

test('overtime styles keep shared, console, rule editor, picker, and responsive ownership', () => {
  const styleRoot = path.join(ROOT_DIR, 'public', 'css', 'admin');
  const entry = fs.readFileSync(path.join(styleRoot, 'overtime.css'), 'utf8');
  const imports = [
    "@import url('./overtime/shared.css');",
    "@import url('./overtime/console.css');",
    "@import url('./overtime/rule-editor.css');",
    "@import url('./overtime/gift-picker.css');",
    "@import url('./overtime/responsive.css');",
  ];
  const positions = imports.map((statement) => entry.indexOf(statement));

  assert.equal(
    positions.every((position) => position >= 0),
    true,
    'the overtime entry should import every focused owner',
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );

  const readOwner = (name) => fs.readFileSync(path.join(styleRoot, 'overtime', name), 'utf8');
  const shared = readOwner('shared.css');
  const consoleStyles = readOwner('console.css');
  const ruleEditor = readOwner('rule-editor.css');
  const giftPicker = readOwner('gift-picker.css');
  const responsive = readOwner('responsive.css');

  assert.match(shared, /\.overtime-admin\s*\{/);
  assert.match(shared, /\.overtime-manual-duration\s*\{/);
  assert.match(shared, /\.overtime-screen-section label\s*\{/);
  assert.doesNotMatch(shared, /\.overtime-clock-value\s*\{/);
  assert.match(consoleStyles, /\.overtime-console\s*\{/);
  assert.match(consoleStyles, /\.overtime-clock-value\s*\{/);
  assert.doesNotMatch(consoleStyles, /\.overtime-rule-row\s*\{/);
  assert.match(ruleEditor, /\.overtime-rule-row\s*\{/);
  assert.match(ruleEditor, /\.overtime-operation-option\s*\{/);
  assert.doesNotMatch(ruleEditor, /\.overtime-gift-picker\s*\{/);
  assert.match(giftPicker, /\.overtime-gift-picker\s*\{/);
  assert.match(giftPicker, /\.overtime-gift-search-row\s*\{/);
  assert.match(responsive, /\.overtime-admin :is\(button, input, select, textarea\):focus-visible/);
  assert.match(responsive, /@media \(prefers-reduced-motion: reduce\)/);
});

test('overtime toolbox panel loads its isolated controller and renders untrusted labels safely', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');
  const source = readOvertimeAdminSource();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'), 'utf8');

  assert.match(html, /id="overtimePanel"/);
  assert.match(html, /id="overtimeClockValue"/);
  assert.match(html, /id="overtimeRules"/);
  assert.match(html, /id="overtimeGiftPicker"/);
  assert.match(html, /id="overtimeRefreshGiftsBtn"/);
  assert.match(html, /id="overtimeGlobalGiftSearchBtn"/);
  assert.match(html, /<button\b[^>]*\sid="overtimeAddGiftBtn"/);
  assert.match(html, /id="overtimeSaveRulesBtn"[^>]+disabled/);
  assert.match(html, /id="overtimeGiftSearch"[^>]+maxlength="100"/);
  assert.match(html, /id="overtimeGiftCatalogStatus"[^>]+role="status"/);
  assert.doesNotMatch(html, /id="overtimePreview"/);
  assert.match(html, /id="overtimeAppearanceFields"/);
  assert.match(html, /id="overtimeDiscardBackgroundBtn"/);
  assert.match(entrySource, /import\('\.\/overtime\.js'\)/);
  assert.match(styles, /@import url\('\.\/admin\/overtime\.css'\);/);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /fetch\('\/img\/bilibili-gifts\.json'/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts'/);
  assert.match(source, /\/api\/overtime\/gifts\/refresh/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts\/catalog'\)/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/local\/search/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/server\/search/);
  assert.match(source, /catalogRoomLabel\(giftCatalogSnapshot, catalogLiveStatus\)/);
  assert.match(source, /liveStatus\?\.ownerName/);
  assert.match(source, /minute:\s*'2-digit'/);
  assert.match(
    source,
    /left\.catalogGroup - right\.catalogGroup[\s\S]*left\.catalogOrder - right\.catalogOrder[\s\S]*left\.rmb - right\.rmb/,
  );
  assert.match(source, /\/api\/overtime\/rules/);
  assert.match(source, /ruleEditor\?\.setLimits\(\s*(?:serverLimits|limits)\s*\)/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime screen controls expose save state, visible errors, and a plain address copy action', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const utilitySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'), 'utf8');

  assert.match(html, /id="overtimeSaveBackgroundBtn"/);
  assert.match(html, /id="overtimeCopyOverlayBtn"/);
  assert.match(source, /'path', 'overtimeBackgroundPath'/);
  assert.match(source, /'fit', 'overtimeBackgroundFit'/);
  assert.match(source, /addEventListener\('change', \(\) => targetController\.edit/);
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
  const statusView = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-status-view.js'), 'utf8');

  assert.match(controller, /import \{ createOvertimeRuleEditor \} from ["']\.\/overtime-rule-editor\.js["'];/);
  assert.match(controller, /ruleEditor\.readRules\(\)/);
  assert.match(statusView, /getRuleEditor\(\)\?\.renderRules\(nextState\.rules\)/);
  assert.doesNotMatch(controller, /function createRuleRow/);
  assert.match(editor, /readRules:\s*\(\)\s*=>\s*readRules\(root,\s*getLimits\(\)\)/);
});

test('overtime initial duration is minute-based, selectable, and readable', async () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = readCssBundle('public', 'css', 'admin', 'overtime.css');

  assert.match(html, /id="overtimeInitialTime"[^>]+value="00:00"/);
  assert.match(html, /id="overtimeInitialHours"/);
  assert.match(html, /id="overtimeInitialMinutes"/);
  assert.doesNotMatch(html, /id="overtimeRemainingTime"/);
  assert.match(source, /remainingSeconds:\s*initialSeconds/);
  assert.match(overtimeStyles, /\.overtime-actions button:disabled[\s\S]*?opacity:\s*1/);
  assert.match(overtimeStyles, /\.overtime-manual-duration\s*>\s*span\s*\{/);
  assert.doesNotMatch(overtimeStyles, /\.overtime-manual-duration\s+span\s*\{/);

  const { createOvertimeTimeView } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/overtime-time-view.js'),
  );
  const values = {};
  const view = createOvertimeTimeView({
    getServerLimits: () => ({ maxSeconds: 315328464000 }),
    setValueUnlessFocused: (id, value) => { values[id] = value; },
  });
  assert.equal(view.parseInitialDuration('2:05'), 7500);
  view.renderInitialDuration(7500);
  assert.deepEqual(values, {
    overtimeInitialTime: '02:05',
    overtimeInitialHours: '2',
    overtimeInitialMinutes: '5',
  });
  assert.throws(() => view.parseInitialDuration('02:05:30'), /HHH:MM/);
  assert.throws(() => view.parseInitialDuration('02:60'), /分钟必须小于 60/);
});

test('overtime gift rules use novice-friendly structured controls', async () => {
  const source = readOvertimeAdminSource();
  const overtimeStyles = readCssBundle('public', 'css', 'admin', 'overtime.css');

  assert.match(source, /dataset\.ruleSummary/);
  assert.match(source, /body\.hidden = !expanded/);
  assert.match(source, /toggle\.setAttribute\('aria-expanded'/);
  assert.match(source, /dataset\.ruleOperation/);
  for (const operation of ['add', 'subtract', 'multiply', 'divide', 'clear']) {
    assert.match(source, new RegExp(`createOperationOption\\(\\s*name\\s*,\\s*['"]${operation}['"]`));
  }
  assert.match(source, /dataset\[`duration\$\{part\[0\]\.toUpperCase\(\)\}\$\{part\.slice\(1\)\}`\]/);
  assert.match(source, /data-duration-\$\{part\}/);
  assert.match(source, /dataset\.randomOutcome/);
  assert.match(source, /dataset\.addOutcome/);
  assert.doesNotMatch(source, /createElement\('textarea'\)/);
  assert.match(overtimeStyles, /\.overtime-rule-effect\s*\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);

  const { readRules } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-model.js'));
  const durationRoot = (operation, hours, minutes, seconds, factor = 2) => {
    const root = {
      dataset: {
        giftId: 'gift-1',
        giftName: '测试礼物',
        imagePath: '',
      },
      querySelector(selector) {
        if (selector === '[data-rule-mode]:checked') return { value: 'fixed' };
        if (selector === '[data-rule-quantity-mode]:checked') return { value: 'group' };
        if (selector === '[data-rule-enabled]') return { checked: true };
        if (selector === '[data-effect-mode="fixed"]') return root;
        if (selector === '[data-rule-operation]:checked') return { value: operation };
        if (selector === '[data-effect-factor]') return { value: factor };
        if (selector === '[data-duration-hours]') return { value: hours };
        if (selector === '[data-duration-minutes]') return { value: minutes };
        if (selector === '[data-duration-seconds]') return { value: seconds };
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    return { querySelectorAll: () => [root] };
  };
  const readFixedEffect = (...args) =>
    readRules(durationRoot(...args), {
      maxEnabledRules: 8,
      minRandomOutcomes: 2,
      maxRandomOutcomes: 10,
      maxDisplayTextLength: 100,
    })[0].fixedEffect;
  assert.equal(
    JSON.stringify(readFixedEffect('add', '1', '2', '3')),
    JSON.stringify({ operation: 'add', value: 3723 }),
  );
  assert.equal(
    JSON.stringify(readFixedEffect('multiply', '', '', '', '8')),
    JSON.stringify({ operation: 'multiply', value: 8 }),
  );
  assert.equal(JSON.stringify(readFixedEffect('clear', '', '', '')), JSON.stringify({ operation: 'clear', value: 0 }));
  assert.throws(() => readFixedEffect('divide', '', '', '', '1'), /倍数/);
  assert.equal(
    JSON.stringify(readFixedEffect('add', '999', '0', '0')),
    JSON.stringify({ operation: 'add', value: 999 * 3600 }),
  );
});
