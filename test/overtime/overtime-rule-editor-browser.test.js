'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { validateRules } = require('../../src/overtime/overtime-contract');

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
    window.dirtyCalls = 0;
    window.editor = createOvertimeRuleEditor(document.getElementById('rules'), () => { window.dirtyCalls += 1; });
    window.editor.setLimits({ maxEnabledRules: 8, minRandomOutcomes: 2, maxRandomOutcomes: 10, maxDisplayTextLength: 6 });
    window.editor.renderRules(rules);
  }, rules);
  return page;
}

test('adding a guard rule keeps the legacy rule grouped and marks the editor dirty once', async t => {
  const page = await mount(t, [{ giftId: '33988', mode: 'fixed', fixedSeconds: 300 }]);
  const result = await page.evaluate(() => {
    const row = window.editor.createRule({ id: 'guard-1', name: '总督' });
    const [legacy, ...added] = window.editor.readRules();
    return {
      returnedNewRow: row === document.querySelector('[data-gift-id="guard-1"]'),
      dirtyCalls: window.dirtyCalls,
      legacyQuantityMode: legacy.quantityMode,
      added: added.map(({ giftId, giftName, mode, quantityMode }) => ({ giftId, giftName, mode, quantityMode })),
    };
  });
  assert.equal(result.returnedNewRow, true);
  assert.equal(result.dirtyCalls, 1);
  assert.equal(result.legacyQuantityMode, 'group');
  assert.deepEqual(result.added, [{ giftId: 'guard-1', giftName: '总督', mode: 'fixed', quantityMode: 'item' }]);
});

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

test('accepted long durations survive the rule editor round trip', async t => {
  const seconds = 1000 * 3600 + 125;
  const rules = validateRules([{ giftId: '1', mode: 'fixed', fixedEffect: { operation: 'add', value: seconds } }]);
  const page = await mount(t, rules);
  const result = await page.evaluate(() => {
    const hours = document.querySelector('[data-duration-hours]');
    const saved = window.editor.readRules()[0].fixedEffect.value;
    const readonly = hours.readOnly;
    const inputValid = hours.checkValidity();
    return { saved, readonly, inputValid };
  });
  assert.equal(result.saved, seconds);
  assert.equal(result.readonly, true);
  assert.equal(result.inputValid, true);
});

test('native display input accepts six Unicode code points and validates after composition', async t => {
  const base = { giftId: '1', mode: 'display', displayText: '谢谢支持' };
  const page = await mount(t, validateRules([base]));
  await page.getByRole('button', { name: '编辑规则', exact: true }).click();
  const input = page.locator('[data-display-text]');
  assert.equal(await input.inputValue(), base.displayText);
  const text = '甲😀乙😃丙😄';
  await input.fill('');
  await input.pressSequentially(text);
  const edited = await input.evaluate(node => ({ valid: node.checkValidity(), rule: window.editor.readRules()[0] }));
  assert.equal(edited.valid, true);
  assert.equal(validateRules([edited.rule])[0].displayText, text);

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
});
