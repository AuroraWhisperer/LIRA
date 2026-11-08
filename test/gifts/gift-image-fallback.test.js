'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '../../public/js/shared/gift-image.js'));

function createImage() {
  const listeners = new Map();
  const requests = [];
  const attributes = {};
  return {
    listeners,
    requests,
    hidden: false,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    getAttribute: (name) => (name === 'src' ? requests.at(-1) || null : attributes[name] || null),
    hasAttribute: name => Object.hasOwn(attributes, name),
    setAttribute: (name, value) => { attributes[name] = String(value); },
    removeAttribute: (name) => { delete attributes[name]; },
    set src(value) {
      requests.push(value);
    },
    get src() {
      return requests.at(-1);
    },
    emit(type) {
      for (const callback of listeners.get(type) || []) callback();
    },
  };
}

test('missing and legacy placeholder images use the packaged generated PNG', async () => {
  const { GIFT_PLACEHOLDER, setGiftArtwork } = await import(moduleUrl);
  for (const source of [null, '', '/img/overtime-machine/gift-placeholder.svg']) {
    const image = createImage();
    setGiftArtwork(image, source);
    assert.equal(image.src, GIFT_PLACEHOLDER);
  }
  const asset = fs.readFileSync(path.join(__dirname, '../../public', GIFT_PLACEHOLDER));
  assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

function imageDocument() {
  const originals = [];
  let draws = 0;
  return { originals, get draws() { return draws; }, createElement(tag) {
    if (tag === 'img') {
      const image = createImage();
      image.naturalWidth = image.naturalHeight = 4;
      originals.push(image);
      return image;
    }
    return { getContext: () => ({ drawImage() { draws++; } }), toDataURL: () => `data:image/png;base64,frame${draws}` };
  } };
}

test('shared artwork updates do not let a delayed static frame replace a newer image or guard badge', async () => {
  const { setGiftArtwork } = await import(moduleUrl);
  const image = createImage();
  const document = imageDocument();
  image.ownerDocument = document;
  setGiftArtwork(image, '/overtime-gift-images/slow-a.webp', { format: 'static' });
  setGiftArtwork(image, '/overtime-gift-images/fast-b.webp', { format: 'static' });
  document.originals[1].emit('load');
  await new Promise(setImmediate);
  const latest = image.src;
  document.originals[0].emit('load');
  await new Promise(setImmediate);
  assert.equal(image.src, latest);
  setGiftArtwork(image, '/overtime-gift-images/slow-c.webp', { format: 'static' });
  setGiftArtwork(image, '', { format: 'static', guardLevel: 2 });
  document.originals[2].emit('load');
  await new Promise(setImmediate);
  assert.match(image.src, /bilibili-guard-prefect/);
  assert.equal(image.getAttribute('data-guard-icon'), '2');
  assert.equal(document.originals.length, 3, 'local guards do not require canvas conversion');
});

test('static artwork coalesces decoding and cools down failures without losing subsequent recovery', async t => {
  const { setGiftArtwork } = await import(moduleUrl);
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const document = imageDocument();
  const show = () => {
    const image = createImage(); image.ownerDocument = document;
    setGiftArtwork(image, '/overtime-gift-images/shared-static.webp', { format: 'static' });
    return image;
  };
  const first = show(); const second = show();
  assert.equal(document.originals.length, 1);
  document.originals[0].emit('error');
  await new Promise(setImmediate);
  const third = show();
  await new Promise(setImmediate);
  assert.equal(document.originals.length, 1);
  assert.equal(first.src, '/img/gift-placeholder.png');
  assert.equal(second.src, third.src);
  now += 30001;
  const recovered = show();
  document.originals[1].emit('load');
  await new Promise(setImmediate);
  const warm = show();
  await new Promise(setImmediate);
  assert.equal(recovered.src, warm.src);
  assert.match(recovered.src, /^data:/);
  assert.equal(document.draws, 1);
  assert.equal(document.originals.length, 2);
});

test('errors fall back once, while later image updates remain protected', async () => {
  const { GIFT_PLACEHOLDER, setGiftArtwork, setGiftArtworkFallbacks } = await import(moduleUrl);
  const image = createImage();
  setGiftArtwork(image, '/overtime-gift-images/missing.webp');
  image.emit('error');
  assert.equal(image.src, GIFT_PLACEHOLDER);
  image.emit('error');
  image.emit('error');
  assert.equal(image.requests.length, 2);
  assert.equal(image.hidden, true);
  setGiftArtwork(image, '/overtime-gift-images/refreshed.webp');
  assert.equal(image.hidden, false);
  image.emit('error');
  assert.equal(image.src, GIFT_PLACEHOLDER);
  image.emit('load');
  assert.equal(image.hidden, false);
  assert.equal(image.listeners.get('error').length, 1);
  const missing = createImage();
  setGiftArtworkFallbacks({ querySelectorAll: () => [missing] });
  assert.equal(missing.src, GIFT_PLACEHOLDER);
});
