'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pngHasSize, encodeExportPng } = require('../../src/electron/png-size');

test('PNG dimensions reject empty, truncated and invalid-signature output', () => {
  const png = Buffer.alloc(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.writeUInt32BE(856, 16);
  png.writeUInt32BE(144, 20);
  assert.equal(pngHasSize(png, 856, 144), true);
  for (const value of [null, new Uint8Array(png), Buffer.alloc(0), png.subarray(0, 20), Buffer.alloc(24)]) {
    assert.equal(pngHasSize(value, 856, 144), false);
  }
  assert.equal(pngHasSize(png, 1920, 1080), false);
});

test('a pure 1.5x bitmap with odd physical dimensions is resized before its only PNG encode', () => {
  const bitmap = Buffer.alloc(481 * 271 * 4);
  const capture = { getScaleFactors: () => [1.5], getSize: () => ({ width: 320, height: 180 }),
    toBitmap: ({ scaleFactor }) => { assert.equal(scaleFactor, 1.5); return bitmap; } };
  let encodes = 0;
  const nativeImage = { createFromBitmap(buffer, size) {
    assert.equal(buffer, bitmap);
    assert.deepEqual(size, { width: 481, height: 271 });
    return { resize({ width, height }) {
      assert.deepEqual([width, height], [320, 180]);
      return { toPNG() { encodes++; return Buffer.from('fixture'); } };
    } };
  } };
  encodeExportPng(capture, 320, 180, nativeImage);
  assert.equal(encodes, 1);
});
