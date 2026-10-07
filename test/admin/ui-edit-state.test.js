'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createUiFixture, limits } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

for (const action of ['add', 'remove']) {
  test(`a clean saved random rule becomes dirty after outcome ${action}`, async (t) => {
    const page = await fixture(t);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    const count = action === 'add' ? 4 : 2;
    await page.evaluate((action) => {
      document.querySelector(action === 'add' ? '[data-add-outcome]' : '[data-remove-outcome]').click();
      window.pushState(window.initialState);
    }, action);
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), false);
    await page.evaluate(() => document.getElementById('overtimeSaveRulesBtn').click());
    assert.equal(await page.evaluate(() => window.pendingSaves[0].body.rules[0].outcomes.length), count);
    await page.evaluate(() => {
      const request = window.pendingSaves[0];
      request.resolve({
        data: { ...window.initialState, rules: request.body.rules },
      });
    });
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    if (action === 'remove') {
      await page.evaluate(() => document.querySelector('[data-remove-outcome]').click());
      assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    }
  });
}

test('move controls follow empty, single, first, middle and last positions', async (t) => {
  const page = await fixture(t, 'libraries');
  await page.evaluate(async (limits) => {
    const { createOvertimeRuleEditor } = await import('/js/admin/overtime-rule-editor.js');
    const root = document.createElement('div');
    document.body.append(root);
    window.editor = createOvertimeRuleEditor(root, () => {});
    window.editor.setLimits(limits);
    window.editor.renderRules([]);
    window.rows = () => [...root.querySelectorAll('[data-overtime-rule]')];
    window.bounds = () =>
      window
        .rows()
        .map((row) => [
          row.dataset.giftId,
          row.querySelector('[aria-label="将这条规则上移"]').disabled,
          row.querySelector('[aria-label="将这条规则下移"]').disabled,
        ]);
    window.addRule = (id) => window.editor.createRule({ id, name: id });
    window.move = (index, direction) =>
      window.rows()[index].querySelector(`[aria-label="将这条规则${direction}移"]`).click();
    window.removeRule = (index) => window.rows()[index].querySelector('[aria-label="删除规则"]').click();
  }, limits);
  assert.deepEqual(await page.evaluate(() => window.bounds()), []);
  await page.evaluate(() => window.addRule('a'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['a', true, true]]);
  await page.evaluate(() => window.addRule('b'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [
    ['a', true, false],
    ['b', false, true],
  ]);
  await page.evaluate(() => window.addRule('c'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [
    ['a', true, false],
    ['b', false, false],
    ['c', false, true],
  ]);
  await page.evaluate(() => window.move(0, '下'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [
    ['b', true, false],
    ['a', false, false],
    ['c', false, true],
  ]);
  await page.evaluate(() => {
    window.move(1, '下');
    window.move(2, '上');
    window.move(1, '上');
  });
  assert.deepEqual(await page.evaluate(() => window.editor.readRules().map((rule) => [rule.giftId, rule.sortOrder])), [
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ]);
  await page.evaluate(() => window.removeRule(2));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [
    ['a', true, false],
    ['b', false, true],
  ]);
  await page.evaluate(() => window.addRule('c'));
  await page.evaluate(() => window.removeRule(1));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [
    ['a', true, false],
    ['c', false, true],
  ]);
  await page.evaluate(() => window.removeRule(0));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['c', true, true]]);
  await page.evaluate(() => window.removeRule(0));
  assert.deepEqual(await page.evaluate(() => window.bounds()), []);
  await page.evaluate(() => window.addRule('d'));
  assert.deepEqual(await page.evaluate(() => window.bounds()), [['d', true, true]]);
});

for (const result of [
  'success-edit',
  'failure-edit',
  'failure-unchanged',
  'success-unchanged',
  'success-revert',
  'success-add',
  'success-remove',
]) {
  test(`overtime save ${result}`, async (t) => {
    const page = await fixture(t);
    await page.evaluate(() => {
      const input = document.querySelector('[data-outcome-weight]');
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('overtimeSaveRulesBtn').click();
    });
    if (result === 'success-unchanged') {
      const probabilities = await page.locator('[data-outcome-probability]').allTextContents();
      assert.deepEqual(probabilities.map((text) => Number(text.match(/([\d.]+)%/)?.[1])), [50, 25, 25]);
    }
    if (result.endsWith('-edit') || result === 'success-revert')
      await page.evaluate((result) => {
        const input = document.querySelector('[data-outcome-weight]');
        input.value = '3';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (result === 'success-revert') {
          input.value = '2';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.getElementById('overtimeSaveRulesBtn').dispatchEvent(new Event('click'));
      }, result);
    if (result === 'success-add' || result === 'success-remove')
      await page.evaluate((result) => {
        if (result === 'success-add') document.querySelector('[data-add-outcome]').click();
        else [...document.querySelectorAll('[data-remove-outcome]')].at(-1).click();
      }, result);
    assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    await page.evaluate((result) => {
      const request = window.pendingSaves[0];
      if (result.startsWith('failure-')) request.reject(new Error('synthetic save failure'));
      else
        request.resolve({
          data: { ...window.initialState, rules: request.body.rules },
        });
    }, result);
    const dirty = result !== 'success-unchanged';
    assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), !dirty);
    assert.equal(
      await page.locator('[data-outcome-weight]').first().inputValue(),
      result.endsWith('-edit') ? '3' : '2',
    );
    const count = result === 'success-add' ? 4 : result === 'success-remove' ? 2 : 3;
    assert.equal(await page.locator('[data-random-outcome]').count(), count);
    if (dirty) {
      await page.evaluate(() => {
        window.pushState(window.initialState);
        document.getElementById('overtimeSaveRulesBtn').click();
      });
      assert.equal(
        await page.evaluate(() => window.pendingSaves[1].body.rules[0].outcomes[0].weight),
        result.endsWith('-edit') ? 3 : 2,
      );
      assert.equal(await page.evaluate(() => window.pendingSaves[1].body.rules[0].outcomes.length), count);
      await page.evaluate(() => {
        const request = window.pendingSaves[1];
        request.resolve({
          data: { ...window.initialState, rules: request.body.rules },
        });
      });
      assert.equal(await page.locator('#overtimeSaveRulesBtn').isDisabled(), true);
    }
  });
}
