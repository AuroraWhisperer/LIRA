'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { validateRules, MAX_OVERTIME_SECONDS } = require('../../src/overtime/overtime-contract');

let fixture;
let browser;
test.before(async () => {
  fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body><main id="rules"></main></body></html>' });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function mount(t, rules) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async rules => {
    const { createOvertimeRuleEditor } = await import('/js/admin/overtime-rule-editor.js');
    window.editor = createOvertimeRuleEditor(document.getElementById('rules'), () => {});
    window.editor.setLimits({ maxEnabledRules: 8, minRandomOutcomes: 2, maxRandomOutcomes: 10, maxDisplayTextLength: 6 });
    window.editor.renderRules(rules);
  }, rules);
  return page;
}

test('gift reselection follows the same rule after refresh and rejects a removed or rebound rule', async t => {
  const rule = { giftId: '1', giftName: '原礼物', enabled: true, mode: 'fixed', quantityMode: 'group',
    fixedEffect: { operation: 'subtract', value: 125 } };
  const page = await mount(t, [rule]);
  const result = await page.evaluate(rule => {
    const pendingRow = document.querySelector('[data-overtime-rule]');
    window.editor.renderRules([rule]);
    const current = document.querySelector('[data-overtime-rule]');
    const selected = window.editor.reselectGift(pendingRow, { id: '2', name: '新礼物' });
    const saved = window.editor.readRules()[0];
    window.editor.renderRules([]);
    const removed = window.editor.reselectGift(current, { id: '3', name: '已删除规则' });
    window.editor.renderRules([{ ...rule, giftId: '4' }]);
    const rebound = window.editor.reselectGift(pendingRow, { id: '5', name: '已变更规则' });
    return { replacedNode: current !== pendingRow, selectedCurrent: selected === current, saved, removed, rebound,
      remaining: window.editor.readRules()[0].giftId };
  }, rule);
  assert.equal(result.replacedNode, true);
  assert.equal(result.selectedCurrent, true);
  assert.equal(result.saved.giftId, '2');
  assert.equal(result.saved.giftName, '新礼物');
  assert.deepEqual(result.saved.fixedEffect, rule.fixedEffect);
  assert.equal(result.removed, null);
  assert.equal(result.rebound, null);
  assert.equal(result.remaining, '4');
});

test('accepted long durations survive rule and initial-time editor round trips', async t => {
  const seconds = 1000 * 3600 + 125;
  const rules = validateRules([{ giftId: '1', mode: 'fixed', fixedEffect: { operation: 'add', value: seconds } }]);
  const page = await mount(t, rules);
  const result = await page.evaluate(async ({ seconds, maxSeconds }) => {
    const hours = document.querySelector('[data-duration-hours]');
    const saved = window.editor.readRules()[0].fixedEffect.value;
    const readonly = hours.readOnly;
    const inputValid = hours.checkValidity();
    const { createOvertimeTimeView } = await import('/js/admin/overtime-time-view.js');
    for (const id of ['overtimeInitialTime', 'overtimeInitialHours', 'overtimeInitialMinutes']) {
      const node = document.createElement(id === 'overtimeInitialTime' ? 'input' : 'select');
      node.id = id;
      document.body.append(node);
    }
    const view = createOvertimeTimeView({ byId: id => document.getElementById(id), getServerLimits: () => ({ maxSeconds }),
      setValueUnlessFocused: (id, value) => { document.getElementById(id).value = value; } });
    view.populateInitialDurationSelectors();
    view.renderInitialDuration(seconds);
    const formatted = document.getElementById('overtimeInitialTime').value;
    const selectedHours = document.getElementById('overtimeInitialHours').value;
    const parsed = view.parseInitialDuration(formatted);
    view.renderInitialDuration(3600);
    return { saved, readonly, inputValid, formatted, selectedHours, parsed,
      preservedOptions: document.querySelectorAll('[data-preserved-hours]').length };
  }, { seconds, maxSeconds: MAX_OVERTIME_SECONDS });
  assert.equal(result.saved, seconds);
  assert.equal(result.readonly, true);
  assert.equal(result.inputValid, true);
  assert.equal(result.formatted, '1000:02');
  assert.equal(result.selectedHours, '1000');
  assert.equal(result.parsed, seconds - 5);
  assert.equal(result.preservedOptions, 0);
});

test('native display input accepts six Unicode code points and validates after composition', async t => {
  const base = { giftId: '1', mode: 'display', displayText: '谢谢支持' };
  const page = await mount(t, validateRules([base]));
  await page.getByRole('button', { name: '展开设置', exact: true }).click();
  const input = page.locator('[data-display-text]');
  for (const text of ['一二三四五六', '😀😃😄😁😆😅', '甲😀乙😃丙😄']) {
    await input.fill('');
    await input.pressSequentially(text);
    assert.equal(await input.inputValue(), text);
    assert.deepEqual(await input.evaluate(node => ({ valid: node.checkValidity(), value: window.editor.readRules()[0].displayText })),
      { valid: true, value: text });
    assert.equal(validateRules([{ ...base, displayText: text }])[0].displayText, text);
  }
  const composition = await input.evaluate(node => {
    node.value = '一二三四五六七';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    const during = node.checkValidity();
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    let modelError = '';
    try { window.editor.readRules(); } catch (error) { modelError = error.message; }
    return { during, after: node.checkValidity(), modelError };
  });
  assert.equal(composition.during, true);
  assert.equal(composition.after, false);
  assert.match(composition.modelError, /6/);
  assert.throws(() => validateRules([{ ...base, displayText: '一二三四五六七' }]));
});
