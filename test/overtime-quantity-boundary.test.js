'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createFixture } = require('./helpers/overtime-service-fixture');
const { loadModuleExports } = require('./helpers/frontend-modules');

const randomRule = {
  giftId: 'guard-3', giftName: '舰长', mode: 'random', quantityMode: 'item', enabled: true,
  outcomes: [{ operation: 'add', value: 2, weight: 1 }, { operation: 'subtract', value: 1, weight: 1 }],
};

for (const quantity of [100001, Number.MAX_SAFE_INTEGER]) {
  test(`quantity ${quantity} stays wholly pending without random work, including replay and restart`, (t) => {
    const f = createFixture();
    let draws = 0;
    let prohibitDraws = true;
    const updates = [];
    const options = { onUpdate: (update) => updates.push(update), randomInt() {
      draws += 1;
      if (prohibitDraws) throw new Error('Unexpected random work for an oversized quantity');
      return 0;
    } };
    let service = f.createService(options);
    t.after(() => { service.dispose(); f.close(); });
    service.act('enable');
    service.setTime({ remainingSeconds: 60 });
    service.replaceRules([randomRule]);
    const event = f.insertFinalGift({ giftId: 'guard-3', num: quantity, overtimeEpoch: service.getCurrentEpoch() });
    const before = service.getSnapshot();
    for (let replay = 0; replay < 2; replay += 1) {
      assert.throws(() => service.finalizeGift(event), { code: 'OVERTIME_QUANTITY_LIMIT' });
      assert.equal(draws, 0);
      assert.equal(service.getSnapshot().effectiveRemainingMs, before.effectiveRemainingMs);
      assert.equal(service.getSnapshot().revision, before.revision);
      const row = f.getSettlement(event.giftEventId);
      assert.equal(row.status, 'pending');
      assert.equal(row.quantity, quantity);
      assert.equal(row.total_price, event.gift.totalPrice);
      assert.equal(row.last_error, 'OVERTIME_QUANTITY_LIMIT');
      assert.equal(row.outcomes_json, '');
      assert.equal(row.applied_delta_seconds, null);
      assert.equal(f.countSettlements(event.giftEventId), 1);
      assert.equal(updates.at(-1).reason, 'quantity-limit');
      assert.equal(updates.at(-1).state.quantityLimitedCount, 1);
      assert.equal(updates.at(-1).state.revision, before.revision);
      assert.equal(updates.at(-1).adjustment, undefined);
    }
    assert.equal(service.getOverview().quantityLimitedCount, 1);
    service.dispose();
    service = f.createService(options);
    f.clock.advance(30_000);
    assert.equal(draws, 0);
    assert.equal(f.getSettlement(event.giftEventId).quantity, quantity);
    assert.equal(f.getSettlement(event.giftEventId).status, 'pending');
    prohibitDraws = false;
    const next = f.insertFinalGift({ giftId: 'guard-3', num: 2, overtimeEpoch: service.getCurrentEpoch() });
    assert.equal(service.finalizeGift(next), true);
    assert.equal(service.finalizeGift(next), false);
    assert.equal(draws, 2);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 64_000);
    assert.equal(service.getOverview().quantityLimitedCount, 1);
  });
}

test('100000 items settle fully and once, while group mode remains one draw for a large group', (t) => {
  const f = createFixture();
  let draws = 0;
  const service = f.createService({ randomInt: () => draws++ % 2 });
  t.after(() => { service.dispose(); f.close(); });
  service.act('enable');
  service.setTime({ remainingSeconds: 60 });
  service.replaceRules([randomRule]);
  const event = f.insertFinalGift({ giftId: 'guard-3', num: 100000, overtimeEpoch: service.getCurrentEpoch() });
  assert.equal(service.finalizeGift(event), true);
  assert.equal(service.finalizeGift(event), false);
  assert.equal(draws, 100000);
  const audit = JSON.parse(f.getSettlement(event.giftEventId).outcomes_json);
  assert.equal(audit.quantity, 100000);
  assert.equal(audit.selectedIndexes.length, 100000);
  assert.ok(Buffer.byteLength(JSON.stringify(audit)) < 201000);
  service.replaceRules([{ ...randomRule, quantityMode: 'group' }]);
  const group = f.insertFinalGift({ giftId: 'guard-3', num: Number.MAX_SAFE_INTEGER, overtimeEpoch: service.getCurrentEpoch() });
  assert.equal(service.finalizeGift(group), true);
  assert.equal(draws, 100001);
  assert.equal(f.getSettlement(group.giftEventId).quantity, Number.MAX_SAFE_INTEGER);
});

test('the existing pending indicator explicitly identifies gifts that have not been settled due to quantity', async () => {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', classList: { toggle() {} } });
    return nodes.get(id);
  };
  const { createOvertimeStatusView } = await loadModuleExports(
    path.join(__dirname, '../public/js/admin/overtime-status-view.js'),
    { performance: { now: () => 0 }, document: { visibilityState: 'hidden' } },
  );
  const view = createOvertimeStatusView({
    byId, formatClockDisplay: () => '01:00', renderInitialDuration() {}, setValueUnlessFocused() {},
    getGiftDetection: () => ({}), getRuleEditor: () => null, isRulesDirty: () => false,
    isBackgroundDirty: () => false, onLimits() {},
  });
  view.renderState({ status: 'paused', pendingCount: 2, quantityLimitedCount: 1 });
  assert.match(byId('overtimePendingCount').textContent, /1 笔数量超限，尚未结算/);
  view.renderState({ pendingCount: 0, quantityLimitedCount: 0 });
  assert.equal(byId('overtimePendingCount').textContent, '待结算 0');
});
