'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

function readOvertimeAdminSource() {
  return [
    'overtime-rule-model.js',
    'overtime-rule-effect-editor.js',
    'overtime-rule-editor.js',
    'overtime-time-view.js',
    'overtime-status-view.js',
    'overtime.js',
  ]
    .map((file) =>
      fs
        .readFileSync(
          path.join(ROOT_DIR, 'public', 'js', 'admin', file),
          'utf8',
        )
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

  const readOwner = (name) =>
    fs.readFileSync(path.join(styleRoot, 'overtime', name), 'utf8');
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
  assert.match(
    responsive,
    /\.overtime-admin :is\(button, input, select, textarea\):focus-visible/,
  );
  assert.match(responsive, /@media \(max-width: 820px\)/);
  assert.match(responsive, /@media \(prefers-reduced-motion: reduce\)/);
});

test('overtime toolbox panel loads its isolated controller and renders untrusted labels safely', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );
  const source = readOvertimeAdminSource();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'),
    'utf8',
  );

  assert.match(html, /id="overtimePanel"/);
  assert.match(html, /id="overtimeClockValue"/);
  assert.match(html, /id="overtimeRules"/);
  assert.match(html, /id="overtimeGiftPicker"/);
  assert.match(html, /id="overtimeRefreshGiftsBtn"/);
  assert.match(
    html,
    /id="overtimeGlobalGiftSearchBtn"[^>]*>\s*搜索全部礼物\s*<\/button\s*>/,
  );
  assert.match(html, /id="overtimeGiftCatalogStatus"[^>]+role="status"/);
  assert.match(html, /id="overtimePreview"/);
  assert.match(entrySource, /import\('\.\/overtime\.js'\)/);
  assert.match(styles, /@import url\('\.\/admin\/overtime\.css'\);/);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /fetch\('\/img\/bilibili-gifts\.json'/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts'/);
  assert.match(source, /\/api\/overtime\/gifts\/refresh/);
  assert.match(source, /fetch\('\/api\/overtime\/gifts\/catalog'\)/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/local\/search/);
  assert.doesNotMatch(source, /\/api\/overtime\/gifts\/server\/search/);
  assert.match(
    source,
    /catalogRoomLabel\(giftCatalogSnapshot, catalogLiveStatus\)/,
  );
  assert.match(source, /liveStatus\?\.ownerName/);
  assert.doesNotMatch(html, /选择“文字展板”可让礼物只展示自定义文字/);
  assert.doesNotMatch(source, /· 房间 /);
  assert.match(source, /minute:\s*'2-digit'/);
  assert.match(
    source,
    /left\.catalogGroup - right\.catalogGroup[\s\S]*left\.catalogOrder - right\.catalogOrder[\s\S]*left\.rmb - right\.rmb/,
  );
  assert.match(source, /\/api\/overtime\/rules/);
  assert.match(
    source,
    /ruleEditor\?\.setLimits\(\s*(?:serverLimits|limits)\s*\)/,
  );
  assert.match(source, /该下播了/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
});

test('overtime screen controls expose save state, visible errors, and a plain address copy action', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const utilitySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'utils.js'),
    'utf8',
  );

  assert.match(
    html,
    /id="overtimeSaveBackgroundBtn"[^>]*>\s*保存画面\s*<\/button\s*>/,
  );
  assert.match(
    html,
    /id="overtimeCopyOverlayBtn"[^>]*>\s*复制地址\s*<\/button\s*>/,
  );
  assert.match(
    source,
    /overtimeBackgroundPath.*addEventListener\('change', markBackgroundDirty\)/s,
  );
  assert.match(
    source,
    /overtimeBackgroundFit.*addEventListener\('change', markBackgroundDirty\)/s,
  );
  assert.match(source, /showError\(error\)/);
  assert.match(source, /保存中…/);
  assert.match(source, /copyText\(overlayUrl\(\)\)/);
  assert.match(source, /地址已复制/);
  assert.match(utilitySource, /export async function copyText\(text\)/);
  assert.match(utilitySource, /navigator\.clipboard\?\.writeText/);
  assert.match(utilitySource, /execCommand\('copy'\)/);
});

test('overtime controller delegates rule editing through a narrow module boundary', () => {
  const controller = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'),
    'utf8',
  );
  const editor = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-editor.js'),
    'utf8',
  );
  const statusView = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-status-view.js'),
    'utf8',
  );

  assert.match(
    controller,
    /import \{ createOvertimeRuleEditor \} from ["']\.\/overtime-rule-editor\.js["'];/,
  );
  assert.match(controller, /ruleEditor\.readRules\(\)/);
  assert.match(
    statusView,
    /getRuleEditor\(\)\?\.renderRules\(nextState\.rules\)/,
  );
  assert.doesNotMatch(controller, /function createRuleRow/);
  assert.match(
    editor,
    /readRules:\s*\(\)\s*=>\s*readRules\(root,\s*getLimits\(\)\)/,
  );
});

test('overtime gift rule actions keep adding obvious and saving stateful', () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = readCssBundle(
    'public',
    'css',
    'admin',
    'overtime.css',
  );

  assert.match(
    html,
    /id="overtimeAddGiftBtn"[\s\S]*?class="overtime-add-gift-action"/,
  );
  assert.match(
    html,
    /id="overtimeSaveRulesBtn"[^>]+disabled\s*>\s*✓ 已保存\s*<\/button\s*>/,
  );
  assert.match(
    html,
    /<h3\s+id="overtimeGiftPickerTitle">\s*添加礼物\s*<\/h3\s*>/,
  );
  assert.match(html, /placeholder="输入礼物名称或 ID"/);
  assert.match(html, /id="overtimeGiftSearch"[^>]+maxlength="100"/);
  assert.doesNotMatch(html, /按名称或礼物 ID 搜索本地目录/);
  assert.match(
    source,
    /createOvertimeRuleEditor\(byId\('overtimeRules'\), markRulesDirty,/,
  );
  assert.match(source, /row\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.match(source, /`已添加 \$\{gift\.name\}`/);
  assert.match(overtimeStyles, /\.overtime-add-gift-action/);
  assert.match(overtimeStyles, /\.overtime-gift-search-row/);
  assert.match(overtimeStyles, /\.overtime-save-rules-action\.is-dirty/);

  const stateStart = source.indexOf('function getRulesSaveButtonState');
  const stateEnd = source.indexOf('\nfunction syncRulesSaveButton', stateStart);
  const sandbox = {};
  vm.runInNewContext(
    `${source.slice(stateStart, stateEnd)}\nthis.getState = getRulesSaveButtonState;`,
    sandbox,
  );
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
  const overtimeStyles = readCssBundle(
    'public',
    'css',
    'admin',
    'overtime.css',
  );

  assert.match(html, /id="overtimeInitialTime"[^>]+value="00:00"/);
  assert.match(html, /id="overtimeInitialHours"/);
  assert.match(html, /id="overtimeInitialMinutes"/);
  assert.doesNotMatch(html, /id="overtimeRemainingTime"/);
  assert.match(source, /remainingSeconds:\s*initialSeconds/);
  assert.match(
    overtimeStyles,
    /\.overtime-actions button:disabled[\s\S]*?opacity:\s*1/,
  );
  assert.match(overtimeStyles, /\.overtime-manual-duration\s*>\s*span\s*\{/);
  assert.doesNotMatch(overtimeStyles, /\.overtime-manual-duration\s+span\s*\{/);

  const helperStart = source.indexOf('function parseInitialDuration');
  const helperEnd = source.indexOf('\n  function formatSignedClock', helperStart);
  const sandbox = {};
  vm.runInNewContext(
    `const serverLimits = { maxSeconds: 315328464000, maxEffectFactor: 1000, maxRandomWeight: 100000, maxEnabledRules: 8 };\n` +
      'const getServerLimits = () => serverLimits;\n' +
      `${source.slice(helperStart, helperEnd)}\n` +
      'this.helpers = { parseInitialDuration, formatInitialDuration };',
    sandbox,
  );
  assert.equal(sandbox.helpers.parseInitialDuration('2:05'), 7500);
  assert.equal(sandbox.helpers.formatInitialDuration(7500), '02:05');
  assert.throws(
    () => sandbox.helpers.parseInitialDuration('02:05:30'),
    /HHH:MM/,
  );
  assert.throws(
    () => sandbox.helpers.parseInitialDuration('02:60'),
    /分钟必须小于 60/,
  );
});

test('overtime gift rules use novice-friendly structured controls', async () => {
  const html = readAdminHtml();
  const source = readOvertimeAdminSource();
  const overtimeStyles = readCssBundle(
    'public',
    'css',
    'admin',
    'overtime.css',
  );

  assert.doesNotMatch(
    html,
    /添加礼物后，选择[“"]直接改时间[”"]或[“"]随机抽结果[”"]/,
  );
  assert.match(source, /className = 'secondary overtime-rule-toggle'/);
  assert.match(source, /dataset\.ruleSummary/);
  assert.match(source, /body\.hidden = !expanded/);
  assert.match(source, /toggle\.setAttribute\('aria-expanded'/);
  assert.doesNotMatch(source, /这个礼物如何改变时间/);
  assert.doesNotMatch(source, /选择一种时间操作/);
  assert.match(source, /dataset\.ruleOperation/);
  for (const operation of ['add', 'subtract', 'multiply', 'divide', 'clear']) {
    assert.match(
      source,
      new RegExp(
        `createOperationOption\\(\\s*name\\s*,\\s*['"]${operation}['"]`,
      ),
    );
  }
  assert.match(
    source,
    /dataset\[`duration\$\{part\[0\]\.toUpperCase\(\)\}\$\{part\.slice\(1\)\}`\]/,
  );
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
  assert.match(
    overtimeStyles,
    /\.overtime-rule-effect\s*\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/,
  );
  assert.match(overtimeStyles, /\.overtime-outcome-card/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-add/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-subtract/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-multiply/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-divide/);
  assert.match(overtimeStyles, /\.overtime-operation-option\.is-clear/);

  const { readRules } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime-rule-model.js'),
  );
  const durationRoot = (operation, hours, minutes, seconds, factor = 2) => {
    const root = {
      dataset: {
        giftId: 'gift-1',
        giftName: '测试礼物',
        imagePath: '',
      },
      querySelector(selector) {
        if (selector === '[data-rule-mode]:checked') return { value: 'fixed' };
        if (selector === '[data-rule-quantity-mode]:checked')
          return { value: 'group' };
        if (selector === '[data-rule-enabled]') return { checked: true };
        if (selector === '[data-effect-mode="fixed"]') return root;
        if (selector === '[data-rule-operation]:checked')
          return { value: operation };
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
  assert.equal(
    JSON.stringify(readFixedEffect('clear', '', '', '')),
    JSON.stringify({ operation: 'clear', value: 0 }),
  );
  assert.throws(() => readFixedEffect('divide', '', '', '', '1'), /倍数/);
  assert.equal(
    JSON.stringify(readFixedEffect('add', '999', '0', '0')),
    JSON.stringify({ operation: 'add', value: 999 * 3600 }),
  );

  const effectEditorSource = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'admin',
      'overtime-rule-effect-editor.js',
    ),
    'utf8',
  );
  const probabilityStart = effectEditorSource.indexOf(
    'function updateOutcomeProbabilities',
  );
  const probabilityEnd = effectEditorSource.indexOf(
    '\n  function setEffectMode',
    probabilityStart,
  );
  const probabilitySandbox = {};
  vm.runInNewContext(
    effectEditorSource.slice(probabilityStart, probabilityEnd) +
      '\nthis.updateOutcomeProbabilities = updateOutcomeProbabilities;',
    probabilitySandbox,
  );
  const badges = [{}, {}];
  const cards = ['40', '60'].map((weight, index) => ({
    querySelector(selector) {
      return selector === '[data-outcome-weight]'
        ? { value: weight }
        : badges[index];
    },
  }));
  probabilitySandbox.updateOutcomeProbabilities({
    querySelectorAll: () => cards,
  });
  assert.equal(badges[0].textContent, '约 40%');
  assert.equal(badges[1].textContent, '约 60%');
});
