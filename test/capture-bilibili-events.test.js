'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  parseArguments,
  buildCaptureRecord,
  shouldCaptureMessage
} = require('../scripts/capture-bilibili-events');

test('capture arguments accept room, duration, output, and gift filter', () => {
  const options = parseArguments([
    '--room', '123',
    '--duration', '90',
    '--output', 'tmp/capture.ndjson',
    '--gift-only'
  ], process.cwd());

  assert.equal(options.roomId, '123');
  assert.equal(options.durationMs, 90_000);
  assert.equal(options.outputPath, path.join(process.cwd(), 'tmp', 'capture.ndjson'));
  assert.equal(options.giftOnly, true);
});

test('capture records retain decoded command data without transport credentials', () => {
  assert.deepEqual(buildCaptureRecord({ cmd: 'GUARD_BUY', data: { uid: 42 } }, '2026-08-03T12:00:00.000Z'), {
    type: 'event',
    receivedAt: '2026-08-03T12:00:00.000Z',
    cmd: 'GUARD_BUY',
    data: { uid: 42 }
  });
});

test('gift-only mode retains guard messages and excludes danmaku', () => {
  assert.equal(shouldCaptureMessage({ cmd: 'GUARD_BUY' }, true), true);
  assert.equal(shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, true), false);
  assert.equal(shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, false), true);
});

test('capture arguments reject a missing room and invalid duration', () => {
  assert.throws(() => parseArguments([], process.cwd()), /--room/);
  assert.throws(() => parseArguments(['--room', '123', '--duration', '0'], process.cwd()), /duration/);
});
