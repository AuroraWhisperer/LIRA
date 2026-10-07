'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_OVERTIME_SECONDS,
  MAX_EFFECT_FACTOR,
  MAX_RANDOM_WEIGHT,
  MAX_ENABLED_RULES,
  MIN_RANDOM_OUTCOMES,
  MAX_RANDOM_OUTCOMES,
  MAX_DISPLAY_TEXT_LENGTH,
} = require('../../src/overtime/overtime-contract');
const { createFixture } = require('../helpers/overtime-service-fixture');

test('overtime service getOverview includes limits from contract', () => {
  const fixture = createFixture();
  const service = fixture.createService();

  try {
    const overview = service.getOverview();
    assert.ok(overview.limits, 'limits field exists');
    assert.equal(overview.limits.maxSeconds, MAX_OVERTIME_SECONDS);
    assert.equal(overview.limits.maxEffectFactor, MAX_EFFECT_FACTOR);
    assert.equal(overview.limits.maxRandomWeight, MAX_RANDOM_WEIGHT);
    assert.equal(overview.limits.maxEnabledRules, MAX_ENABLED_RULES);
    assert.equal(overview.limits.minRandomOutcomes, MIN_RANDOM_OUTCOMES);
    assert.equal(overview.limits.maxRandomOutcomes, MAX_RANDOM_OUTCOMES);
    assert.equal(overview.limits.maxDisplayTextLength, MAX_DISPLAY_TEXT_LENGTH);
    assert.equal(overview.limits.maxSeconds, 315_328_464_000);
    assert.equal(overview.limits.maxEffectFactor, 1_000);
    assert.equal(overview.limits.maxRandomWeight, 100_000);
  } finally {
    service.dispose();
    fixture.close();
  }
});

const boundaryCases = [
  {
    name: 'accepts the maximum initial time',
    run: (service) => assert.equal(service.setTime({ initialSeconds: MAX_OVERTIME_SECONDS }).initialSeconds, MAX_OVERTIME_SECONDS),
    check: (service) => assert.equal(service.getSnapshot().initialSeconds, MAX_OVERTIME_SECONDS),
  },
  {
    name: 'accepts the maximum effect factor',
    rules: [{ giftId: 'test-multiply', giftName: 'Max Multiply', imagePath: '', mode: 'fixed', enabled: true, sortOrder: 0,
      fixedEffect: { operation: 'multiply', value: MAX_EFFECT_FACTOR } }],
    check: (_, saved) => assert.equal(saved.rules[0].fixedEffect.value, MAX_EFFECT_FACTOR),
  },
  {
    name: 'accepts the maximum total random weight',
    rules: [{ giftId: 'test-random', giftName: 'Max Weight', imagePath: '', mode: 'random', enabled: true, sortOrder: 0,
      outcomes: [{ operation: 'add', value: 100, weight: MAX_RANDOM_WEIGHT - 1 }, { operation: 'subtract', value: 50, weight: 1 }] }],
    check: (_, saved) => {
      assert.equal(saved.rules[0].outcomes[0].weight, MAX_RANDOM_WEIGHT - 1);
      assert.equal(saved.rules[0].outcomes.reduce((sum, outcome) => sum + outcome.weight, 0), MAX_RANDOM_WEIGHT);
    },
  },
  {
    name: 'accepts an effect with the maximum seconds value',
    rules: [{ giftId: 'test-add', giftName: 'Max Add', imagePath: '', mode: 'fixed', enabled: true, sortOrder: 0,
      fixedEffect: { operation: 'add', value: MAX_OVERTIME_SECONDS } }],
    check: (_, saved) => assert.equal(saved.rules[0].fixedEffect.value, MAX_OVERTIME_SECONDS),
  },
  {
    name: 'rejects time above the contract maximum',
    run: (service) => service.setTime({ initialSeconds: MAX_OVERTIME_SECONDS + 1 }),
    error: /initialSeconds must be between/,
  },
  {
    name: 'rejects an effect factor above the contract maximum',
    rules: [{ giftId: 'test', mode: 'fixed', fixedEffect: { operation: 'multiply', value: MAX_EFFECT_FACTOR + 1 } }],
    error: /value must be between/,
  },
  {
    name: 'rejects a total random weight above the contract maximum',
    rules: [{ giftId: 'test', mode: 'random', outcomes: [
      { operation: 'add', value: 100, weight: 1 }, { operation: 'subtract', value: 50, weight: MAX_RANDOM_WEIGHT }] }],
    error: /total weight cannot exceed/,
  },
];

for (const boundary of boundaryCases) {
  test(`backend ${boundary.name}`, () => {
    const fixture = createFixture();
    const service = fixture.createService();
    try {
      service.act('enable');
      const run = boundary.run || ((target) => target.replaceRules(boundary.rules));
      if (boundary.error) {
        assert.throws(() => run(service), boundary.error);
      } else {
        boundary.check(service, run(service));
      }
    } finally {
      service.dispose();
      fixture.close();
    }
  });
}

test('backend accepts only configured remote catalog artwork paths', () => {
  const fixture = createFixture();
  const service = fixture.createService({
    allowedRemoteImageOrigins: () => 'https://api.example.test',
  });

  try {
    const saved = service.replaceRules([
      {
        giftId: 'remote-test',
        giftName: '远程礼物',
        imagePath: 'https://api.example.test/gift-media/images/hash.webp',
        mode: 'fixed',
        fixedSeconds: 60,
        quantityMode: 'item',
      },
    ]);
    assert.equal(saved.rules[0].imagePath, 'https://api.example.test/gift-media/images/hash.webp');

    assert.throws(
      () =>
        service.replaceRules([
          {
            giftId: 'remote-test',
            imagePath: 'https://evil.example/gift-media/images/hash.webp',
            mode: 'fixed',
            fixedSeconds: 60,
          },
        ]),
      /imagePath is invalid/,
    );
    assert.throws(
      () =>
        service.replaceRules([
          {
            giftId: 'remote-test',
            imagePath: 'https://127.0.0.1/gift-media/images/hash.webp',
            mode: 'fixed',
            fixedSeconds: 60,
          },
        ]),
      /imagePath is invalid/,
    );
    assert.throws(
      () =>
        service.replaceRules([
          {
            giftId: 'remote-test',
            imagePath: 'https://api.example.test/gift-media/images/hash.webp?token=secret',
            mode: 'fixed',
            fixedSeconds: 60,
          },
        ]),
      /imagePath is invalid/,
    );
    assert.throws(
      () =>
        service.replaceRules([
          {
            giftId: 'remote-test',
            imagePath: 'http://127.0.0.1:13000/gift-media/images/hash.webp',
            mode: 'fixed',
            fixedSeconds: 60,
          },
        ]),
      /imagePath is invalid/,
    );
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend migrates a saved remote rule image when the catalog origin changes', () => {
  const fixture = createFixture();
  let origin = 'https://api.one.example';
  const service = fixture.createService({
    allowedRemoteImageOrigins: () => origin,
    resolveGiftImagePath: (giftId) => (giftId === 'remote-test' ? `${origin}/gift-media/images/current.webp` : ''),
  });

  try {
    service.replaceRules([
      {
        giftId: 'remote-test',
        giftName: '远程礼物',
        imagePath: `${origin}/gift-media/images/old.webp`,
        mode: 'fixed',
        fixedSeconds: 60,
      },
    ]);

    origin = 'https://api.two.example';
    const saved = service.replaceRules(service.getSnapshot().rules);
    assert.equal(saved.rules[0].imagePath, 'https://api.two.example/gift-media/images/current.webp');
  } finally {
    service.dispose();
    fixture.close();
  }
});

test('backend resolves legacy bundled gift artwork by gift ID without removing the rule', () => {
  const fixture = createFixture();
  const original = fixture.createService();
  original.replaceRules([
    {
      giftId: '35793',
      giftName: '传情鹊',
      imagePath: '/img/bilibili-gifts/0000-under-0100/35793.webp',
      mode: 'fixed',
      fixedSeconds: 60,
    },
  ]);
  original.dispose();

  const service = fixture.createService({
    resolveGiftImagePath: (giftId) => (giftId === '35793' ? '/overtime-gift-images/35793.webp' : ''),
  });
  try {
    const [rule] = service.getSnapshot().rules;
    assert.equal(rule.giftId, '35793');
    assert.equal(rule.imagePath, '/overtime-gift-images/35793.webp');
  } finally {
    service.dispose();
    fixture.close();
  }
});
