'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MAX_OVERTIME_SECONDS, MAX_EFFECT_FACTOR, MAX_RANDOM_WEIGHT } = require('../src/overtime/overtime-contract');
const { createOvertimeService } = require('../src/overtime/overtime-service');
const { createDatabases, closeDatabases } = require('../src/storage/database');

test('overtime service getOverview includes limits from contract', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    const overview = service.getOverview();
    assert.ok(overview.limits, 'limits field exists');
    assert.equal(overview.limits.maxSeconds, MAX_OVERTIME_SECONDS);
    assert.equal(overview.limits.maxEffectFactor, MAX_EFFECT_FACTOR);
    assert.equal(overview.limits.maxRandomWeight, MAX_RANDOM_WEIGHT);
    assert.equal(overview.limits.maxEnabledRules, 8);
    assert.equal(overview.limits.maxSeconds, 315_328_464_000);
    assert.equal(overview.limits.maxEffectFactor, 1_000);
    assert.equal(overview.limits.maxRandomWeight, 100_000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend accepts maximum boundary time values without rejection', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    const result = service.setTime({ initialSeconds: MAX_OVERTIME_SECONDS });
    assert.equal(result.initialSeconds, MAX_OVERTIME_SECONDS);
    assert.equal(service.getSnapshot().initialSeconds, MAX_OVERTIME_SECONDS);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend accepts maximum boundary effect factor values', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    const rules = service.replaceRules([{
      giftId: 'test-multiply',
      giftName: 'Max Multiply',
      imagePath: '',
      mode: 'fixed',
      fixedEffect: { operation: 'multiply', value: MAX_EFFECT_FACTOR },
      enabled: true,
      sortOrder: 0
    }]);
    assert.equal(rules.rules[0].fixedEffect.value, MAX_EFFECT_FACTOR);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend accepts maximum boundary random weight values', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    const rules = service.replaceRules([{
      giftId: 'test-random',
      giftName: 'Max Weight',
      imagePath: '',
      mode: 'random',
      outcomes: [
        { operation: 'add', value: 100, weight: MAX_RANDOM_WEIGHT - 1 },
        { operation: 'subtract', value: 50, weight: 1 }
      ],
      enabled: true,
      sortOrder: 0
    }]);
    assert.equal(rules.rules[0].outcomes[0].weight, MAX_RANDOM_WEIGHT - 1);
    assert.equal(rules.rules[0].outcomes.reduce((sum, o) => sum + o.weight, 0), MAX_RANDOM_WEIGHT);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend accepts effect with maximum seconds value', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    const rules = service.replaceRules([{
      giftId: 'test-add',
      giftName: 'Max Add',
      imagePath: '',
      mode: 'fixed',
      fixedEffect: { operation: 'add', value: MAX_OVERTIME_SECONDS },
      enabled: true,
      sortOrder: 0
    }]);
    assert.equal(rules.rules[0].fixedEffect.value, MAX_OVERTIME_SECONDS);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend rejects time exceeding contract maximum', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    assert.throws(
      () => service.setTime({ initialSeconds: MAX_OVERTIME_SECONDS + 1 }),
      /initialSeconds must be between/
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend rejects effect factor exceeding contract maximum', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    assert.throws(
      () => service.replaceRules([{
        giftId: 'test',
        mode: 'fixed',
        fixedEffect: { operation: 'multiply', value: MAX_EFFECT_FACTOR + 1 }
      }]),
      /value must be between/
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend rejects random weight exceeding contract maximum', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    service.act('enable');
    assert.throws(
      () => service.replaceRules([{
        giftId: 'test',
        mode: 'random',
        outcomes: [
          { operation: 'add', value: 100, weight: 1 },
          { operation: 'subtract', value: 50, weight: MAX_RANDOM_WEIGHT }
        ]
      }]),
      /total weight cannot exceed/
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

function createFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overtime-limits-'));
  const db = createDatabases({ dataDir });
  return {
    db,
    createService(options = {}) {
      return createOvertimeService({
        giftDb: db.giftDb,
        ...options
      });
    },
    close() {
      closeDatabases(db);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
