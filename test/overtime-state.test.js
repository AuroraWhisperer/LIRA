'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  MAX_OVERTIME_SECONDS,
  validateBackground,
  validateRules,
  validateTimeInput,
} = require('../src/overtime');
const { createFixture } = require('./helpers/overtime-service-fixture');

test('running time uses a monotonic anchor and pauses without further drift', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (message) => updates.push(message),
  });

  try {
    service.act('enable');
    service.setTime({ initialSeconds: 600, remainingSeconds: 600 });
    service.act('start');
    fixture.clock.advance(10_000);
    service.act('pause');

    assert.equal(service.getSnapshot().effectiveRemainingMs, 590_000);
    fixture.clock.advance(10_000);
    assert.equal(service.getSnapshot().effectiveRemainingMs, 590_000);
    assert.equal(service.getSnapshot().status, 'paused');
    assert.deepEqual(
      updates.map((update) => update.reason),
      ['manual', 'manual', 'manual', 'manual'],
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('natural zero persists finished once and increments the revision', () => {
  const fixture = createFixture();
  const updates = [];
  const service = fixture.createService({
    onUpdate: (message) => updates.push(message),
  });

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 2 });
    service.act('start');
    const before = service.getSnapshot().revision;
    fixture.clock.advance(2_000);

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.effectiveRemainingMs, 0);
    assert.equal(snapshot.status, 'finished');
    assert.equal(snapshot.revision, before + 1);
    assert.equal(
      updates.filter((update) => update.reason === 'finished').length,
      1,
    );

    fixture.clock.advance(10_000);
    assert.equal(
      updates.filter((update) => update.reason === 'finished').length,
      1,
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('restart deducts offline elapsed time and never gains time after wall-clock rollback', () => {
  const fixture = createFixture();
  let service = fixture.createService();

  try {
    service.act('enable');
    service.setTime({ remainingSeconds: 100 });
    service.act('start');
    fixture.clock.advance(10_000);
    service.dispose();

    fixture.clock.resetMonotonic();
    fixture.clock.advanceWall(20_000);
    service = fixture.createService();
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
    service.dispose();

    fixture.clock.resetMonotonic();
    fixture.clock.advanceWall(-60_000);
    service = fixture.createService();
    assert.equal(service.getSnapshot().effectiveRemainingMs, 70_000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('time, background, and rules validation enforce server limits', () => {
  assert.equal(MAX_OVERTIME_SECONDS, 9_999 * 365 * 24 * 60 * 60);
  assert.deepEqual(
    validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS }),
    {
      remainingSeconds: MAX_OVERTIME_SECONDS,
    },
  );
  assert.throws(
    () => validateTimeInput({ remainingSeconds: MAX_OVERTIME_SECONDS + 1 }),
    /remainingSeconds/,
  );
  assert.deepEqual(validateBackground({ path: '', fit: 'contain' }), {
    path: '',
    fit: 'contain',
  });
  assert.deepEqual(
    validateBackground({
      path: '/img/overtime-machine/night.webp',
      fit: 'cover',
    }),
    { path: '/img/overtime-machine/night.webp', fit: 'cover' },
  );
  assert.throws(
    () => validateBackground({ path: '../secret', fit: 'cover' }),
    /path/,
  );
  assert.throws(
    () =>
      validateBackground({ path: 'https://example.test/a.png', fit: 'cover' }),
    /path/,
  );
  assert.throws(
    () =>
      validateBackground({
        path: '/overtime-gift-images/server.webp',
        fit: 'cover',
      }),
    /path/,
  );

  const rules = validateRules([
    {
      giftId: '35521',
      giftName: '心动时刻',
      imagePath: '/img/bilibili-gifts/a.webp',
      mode: 'fixed',
      fixedSeconds: 300,
      enabled: true,
      sortOrder: 0,
    },
    {
      giftId: '1',
      giftName: '盲盒',
      imagePath: '',
      mode: 'random',
      enabled: false,
      outcomes: [
        { seconds: 60, weight: 2 },
        { seconds: -30, weight: 1 },
      ],
      sortOrder: 1,
    },
    {
      giftId: '2',
      giftName: '翻倍',
      imagePath: '',
      mode: 'fixed',
      enabled: false,
      fixedEffect: { operation: 'multiply', value: 8 },
      sortOrder: 2,
    },
  ]);
  assert.equal(rules[0].fixedSeconds, 300);
  assert.deepEqual(rules[0].fixedEffect, { operation: 'add', value: 300 });
  assert.deepEqual(rules[1].outcomes, [
    { operation: 'add', value: 60, weight: 2 },
    { operation: 'subtract', value: 30, weight: 1 },
  ]);
  assert.deepEqual(rules[2].fixedEffect, { operation: 'multiply', value: 8 });
  assert.equal(rules[2].fixedSeconds, null);
  const cachedImageRule = validateRules([
    {
      giftId: 'cached',
      giftName: '缓存礼物',
      imagePath: '/overtime-gift-images/server.webp',
      mode: 'fixed',
      fixedSeconds: 1,
    },
  ]);
  assert.equal(
    cachedImageRule[0].imagePath,
    '/overtime-gift-images/server.webp',
  );
  assert.throws(
    () =>
      validateRules([
        {
          giftId: 'invalid-cached-image',
          imagePath: '/overtime-gift-images/server.svg',
          mode: 'fixed',
          fixedSeconds: 1,
        },
      ]),
    /imagePath/,
  );
  assert.deepEqual(
    rules.map((rule) => rule.quantityMode),
    ['group', 'group', 'group'],
  );
  const guardRule = validateRules([
    {
      giftId: 'guard-1',
      mode: 'fixed',
      imagePath: '/img/admin/gifts/bilibili-guard-governor.webp',
      fixedSeconds: 300,
    },
  ]);
  assert.equal(
    guardRule[0].imagePath,
    '/img/admin/gifts/bilibili-guard-governor.webp',
  );
  const itemRule = validateRules([
    {
      giftId: 'quantity-item',
      mode: 'fixed',
      quantityMode: 'item',
      fixedSeconds: 1,
    },
  ]);
  assert.equal(itemRule[0].quantityMode, 'item');
  const displayRule = validateRules([
    {
      giftId: 'display-gift',
      mode: 'display',
      displayText: '谢谢支持',
      enabled: true,
    },
  ]);
  assert.equal(displayRule[0].displayText, '谢谢支持');
  assert.throws(
    () =>
      validateRules([
        { giftId: 'too-long', mode: 'display', displayText: '七个文字超长度' },
      ]),
    /displayText/,
  );
  assert.throws(
    () =>
      validateRules([
        { giftId: 'control', mode: 'display', displayText: '好\n' },
      ]),
    /displayText/,
  );
  assert.throws(
    () =>
      validateRules([
        {
          giftId: 'bad-quantity-mode',
          mode: 'fixed',
          quantityMode: 'price',
          fixedSeconds: 1,
        },
      ]),
    /quantityMode/,
  );
  assert.throws(
    () =>
      validateRules([
        {
          giftId: 'bad-factor',
          mode: 'fixed',
          fixedEffect: { operation: 'divide', value: 1 },
        },
      ]),
    /value/,
  );
  assert.throws(
    () =>
      validateRules(
        Array.from({ length: 9 }, (_, index) => ({
          giftId: String(index),
          mode: 'fixed',
          fixedSeconds: 1,
          enabled: true,
        })),
      ),
    /enabled rules/,
  );
});
