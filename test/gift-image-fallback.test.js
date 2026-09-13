'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '../public/js/shared/gift-image-fallback.js'));

function createImage() {
  const listeners = new Map();
  const requests = [];
  return {
    listeners, requests, hidden: false,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    getAttribute: name => name === 'src' ? requests.at(-1) || null : null,
    set src(value) { requests.push(value); },
    get src() { return requests.at(-1); },
    emit(type) { for (const callback of listeners.get(type) || []) callback(); },
  };
}

test('missing and legacy placeholder images use the packaged generated PNG', async () => {
  const { GIFT_PLACEHOLDER, setGiftImage } = await import(moduleUrl);
  for (const source of [null, '', '/img/overtime-machine/gift-placeholder.svg']) {
    const image = createImage();
    setGiftImage(image, source);
    assert.equal(image.src, GIFT_PLACEHOLDER);
  }
  const asset = fs.readFileSync(path.join(__dirname, '../public', GIFT_PLACEHOLDER));
  assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('errors fall back once, while later image updates remain protected', async () => {
  const { GIFT_PLACEHOLDER, setGiftImage, setGiftImageFallbacks } = await import(moduleUrl);
  const image = createImage();
  setGiftImage(image, '/overtime-gift-images/missing.webp');
  image.emit('error');
  assert.equal(image.src, GIFT_PLACEHOLDER);
  image.emit('error');
  image.emit('error');
  assert.equal(image.requests.length, 2);
  assert.equal(image.hidden, true);
  setGiftImage(image, '/overtime-gift-images/refreshed.webp');
  assert.equal(image.hidden, false);
  image.emit('error');
  assert.equal(image.src, GIFT_PLACEHOLDER);
  image.emit('load');
  assert.equal(image.hidden, false);
  assert.equal(image.listeners.get('error').length, 1);
  const missing = createImage();
  setGiftImageFallbacks({ querySelectorAll: () => [missing] });
  assert.equal(missing.src, GIFT_PLACEHOLDER);
});
