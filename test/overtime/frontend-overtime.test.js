'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createFixture, deferred } = require('../helpers/overtime-gift-picker-fixture');

const ROOT_DIR = path.join(__dirname, '../..');

test('cancelling reset or applying a new duration leaves the overtime countdown untouched', async () => {
  const fixture = await createFixture({
    initialState: { overtime: { initialSeconds: 3600, effectiveRemainingMs: 9000000, status: 'running' } },
    parsedDuration: 7200,
    confirmImpl: async () => false,
  });
  await fixture.document.getElementById('overtimeResetBtn').dispatchEvent('click');
  await fixture.document.getElementById('overtimeApplyTimeBtn').dispatchEvent('click');
  assert.equal(fixture.state.apiCalls.length, 0);
  assert.equal(fixture.state.confirmationCalls.length, 2);
  assert.match(fixture.state.confirmationCalls[0].message, /3600 秒/);
  assert.match(fixture.state.confirmationCalls[1].message, /7200 秒/);
});

test('pending time confirmation blocks duplicate resets and applies only the accepted action', async () => {
  const confirmation = deferred();
  const fixture = await createFixture({
    initialState: { overtime: { initialSeconds: 3600 } },
    parsedDuration: 7200,
    confirmImpl: () => confirmation.promise,
  });
  const reset = fixture.document.getElementById('overtimeResetBtn');
  const apply = fixture.document.getElementById('overtimeApplyTimeBtn');
  const pendingReset = reset.dispatchEvent('click');
  await reset.dispatchEvent('click');
  await apply.dispatchEvent('click');
  assert.equal(fixture.state.confirmationCalls.length, 1);
  assert.equal(fixture.state.apiCalls.length, 0);
  confirmation.resolve(true);
  await pendingReset;
  assert.equal(fixture.state.apiCalls.length, 1);
  assert.equal(fixture.state.apiCalls[0].url, '/api/overtime/action');
  assert.equal(fixture.state.apiCalls[0].body.action, 'reset');

  await apply.dispatchEvent('click');
  assert.equal(fixture.state.apiCalls.length, 2);
  assert.equal(fixture.state.apiCalls[1].url, '/api/overtime/time');
  assert.equal(fixture.state.apiCalls[1].body.initialSeconds, 7200);
  assert.equal(fixture.state.apiCalls[1].body.remainingSeconds, 7200);
});

function readOvertimeAdminSource() {
  return [
    'overtime-rule-model.js',
    'overtime-rule-effect-editor.js',
    'overtime-rule-editor.js',
    'overtime-time-view.js',
    'overtime-status-view.js',
    'overtime-preview.js',
    'overtime-preview-factory.js',
    'overtime-gift-picker.js',
    'gifts/picker-option.js',
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
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/local\/search/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/server\/search/);
  assert.match(source, /\/api\/overtime\/rules/);
  assert.match(source, /ruleEditor\?\.setLimits\(\s*(?:serverLimits|limits)\s*\)/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime screen controls wire background fields and a plain address copy action', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();

  assert.match(html, /id="overtimeSaveBackgroundBtn"/);
  assert.match(html, /id="overtimeCopyOverlayBtn"/);
  assert.match(source, /'path', 'overtimeBackgroundPath'/);
  assert.match(source, /'fit', 'overtimeBackgroundFit'/);
  assert.match(source, /addEventListener\('change', \(\) => targetController\.edit/);
  assert.match(source, /copyText\(overlayUrl\(\)\)/);
});

test('overtime controller delegates rule editing through a narrow module boundary', () => {
  const controller = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'), 'utf8');

  assert.match(controller, /import \{ createOvertimeRuleEditor \} from ["']\.\/overtime-rule-editor\.js["'];/);
  assert.doesNotMatch(controller, /function createRuleRow/);
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
