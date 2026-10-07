'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readServerFixture } = require('../../scripts/verify-server-contract');
const { createFixture, deferred, flush, nodeText, openPicker, optionNodes } = require('../helpers/overtime-gift-picker-fixture');
const heart = readServerFixture('test/fixtures/heart-blind-box-events.json');

test('gift picker derives three role labels from the shared server catalog without extra requests', async () => {
  const gifts = [
    { ...heart.box, giftCategory: 'blindBox' },
    ...heart.outputs.map((item) => ({ ...item, giftCategory: 'blindBoxOutput' })),
    { id: '100', name: '小花花', rmb: 1, giftCategory: 'directGift' },
    { id: '999', name: '棉花糖', rmb: 9, giftCategory: 'directGift' },
  ];
  const snapshot = {
    schemaVersion: 2,
    source: 'server',
    gifts,
    blindBoxes: [
      {
        giftId: heart.box.id,
        outputGiftIds: heart.outputs.map((item) => item.id),
      },
    ],
  };
  const fixture = await createFixture({
    globalGifts: gifts,
    fetchPayload: { ok: true, data: snapshot },
  });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');
  const labels = optionNodes(fixture).map(nodeText);
  assert.match(labels[0], /盲盒/);
  assert.match(labels[1], /盲盒产物 · 心动盲盒/);
  assert.match(labels[2], /盲盒产物 · 心动盲盒/);
  assert.match(labels[3], /直送礼物/);
  assert.match(labels[4], /直送礼物/);
  assert.equal(fixture.state.fetchCalls.length, 1);

  fixture.namespace.applyServerGiftArtwork({
    ...snapshot,
    gifts: [...gifts, { id: '900', name: '另一个盲盒', rmb: 20, giftCategory: 'blindBox' }],
    blindBoxes: [...snapshot.blindBoxes, { giftId: '900', outputGiftIds: ['32126'] }],
  });
  assert.match(nodeText(optionNodes(fixture)[1]), /盲盒产物 · 心动盲盒 \/ 另一个盲盒/);
  fixture.namespace.applyServerGiftArtwork({
    ...snapshot,
    blindBoxes: [],
    gifts: gifts.map((gift) => ({
      ...gift,
      giftCategory: gift.giftCategory === 'blindBoxOutput' ? 'directGift' : gift.giftCategory,
    })),
  });
  assert.match(nodeText(optionNodes(fixture)[1]), /直送礼物/);
  assert.doesNotMatch(nodeText(optionNodes(fixture)[1]), /盲盒产物/);
  fixture.namespace.applyServerGiftArtwork({
    ...snapshot,
    gifts: gifts.map((item) => (item.id === '32126' ? { ...item, name: '另一个活动', rmb: 12 } : item)),
  });
  assert.doesNotMatch(nodeText(optionNodes(fixture)[1]), /盲盒产物|直送礼物/);
});

test('a slower picker fetch cannot restore removed pool labels after a catalog update', async () => {
  const gifts = [
    { ...heart.box, giftCategory: 'blindBox' },
    ...heart.outputs.map((item) => ({ ...item, giftCategory: 'blindBoxOutput' })),
  ];
  const snapshot = {
    schemaVersion: 2,
    gifts,
    blindBoxes: [
      {
        giftId: heart.box.id,
        outputGiftIds: heart.outputs.map((item) => item.id),
      },
    ],
  };
  const pending = deferred();
  const fixture = await createFixture({
    globalGifts: gifts,
    fetchImpl: () => pending.promise,
  });
  await openPicker(fixture);
  const activation = fixture.elements.globalSearchButton.dispatchEvent('click');
  await flush();
  fixture.namespace.applyServerGiftArtwork({
    ...snapshot,
    blindBoxes: [],
    gifts: gifts.map((gift) => ({
      ...gift,
      giftCategory: gift.giftCategory === 'blindBoxOutput' ? 'directGift' : gift.giftCategory,
    })),
  });
  pending.resolve({ ok: true, payload: { ok: true, data: snapshot } });
  await activation;
  assert.match(nodeText(optionNodes(fixture)[1]), /直送礼物/);
  assert.doesNotMatch(nodeText(optionNodes(fixture)[1]), /盲盒产物/);
});

test('same-ID gift identities remain separately selectable and keep their own artwork', async () => {
  const identities = readServerFixture('docs/protocol/fixtures/gift-catalog-variants.json');
  const globalGifts = identities.response.variants
    .filter((gift) => gift.giftId === '35429')
    .map((gift) => ({
      ...gift,
      id: gift.giftId,
      imagePath: `/overtime-gift-images/${gift.variantId}.webp`,
      giftIdentity: {
        variantId: gift.variantId,
        priceRaw: gift.priceRaw,
        coinType: gift.coinType,
        bagGift: gift.bagGift,
      },
    }));
  const fixture = await createFixture({ globalGifts });
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(optionNodes(fixture).length, 2);
  const first = optionNodes(fixture)[0];
  await first.dispatchEvent('click');
  await openPicker(fixture);
  await fixture.elements.globalSearchButton.dispatchEvent('click');
  assert.equal(optionNodes(fixture).length, 1);
  assert.match(nodeText(optionNodes(fixture)[0]), /七夕盲盒/);
  fixture.namespace.applyServerGiftArtwork({
    schemaVersion: 3,
    gifts: globalGifts,
    blindBoxes: [],
    variantBlindBoxes: [],
  });
  assert.equal(optionNodes(fixture)[0].children[0].src, globalGifts[1].imagePath);
  await optionNodes(fixture)[0].dispatchEvent('click');
  assert.equal(new Set(fixture.state.addedGifts.map((gift) => gift.giftIdentity.variantId)).size, 2);
});
