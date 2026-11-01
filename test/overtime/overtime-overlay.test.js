'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '../..');

test('overtime overlay retains its access scope', () => {
  assert.equal(require('../../src/server/access-policy').getOverlayScope('/overtime'), 'overtime');
});

test('overtime clock uses bounded calendar tiers for large durations', async () => {
  const source = read('public/js/shared/overtime-time-format.js');
  const helpers = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  assert.equal(helpers.formatClock(23 * 60 * 60 * 1000 + 59_000), '23:00:59');
  assert.equal(helpers.formatClock(24 * 60 * 60 * 1000), '1天 00:00');
  assert.equal(helpers.formatClock(365 * 24 * 60 * 60 * 1000), '1年 0天 0小时');
  assert.equal(helpers.formatClock(9_999 * 365 * 24 * 60 * 60 * 1000), '9999年 0天 0小时');
  assert.equal(helpers.formatClockDisplay(0, 'paused'), '00:00:00');
});

test('overtime wakeups follow rounded display changes within and across calendar tiers', async () => {
  const source = read('public/js/shared/overtime-time-format.js');
  const { formatClock, nextClockDelay } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const day = 86_400_000;
  const year = 365 * day;
  for (const [remaining, expectedDelay] of [
    [1000, 1000], [9500.5, 501],
    [day + 60_000, 1000], [day + 90_000, 31_000], [day + 59_000, 60_000],
    [day + 60_000.25, 1001], [day - 0.25, 1000],
    [year + 3_600_000, 1000], [year + 3_600_000 + 123.75, 1124], [year - 0.25, 1000],
  ]) {
    const delay = nextClockDelay(remaining);
    assert.equal(delay, expectedDelay, `next displayed change for ${remaining}ms`);
    assert.equal(formatClock(remaining - delay + 1), formatClock(remaining), 'no earlier visible change is skipped');
    assert.notEqual(formatClock(remaining - delay), formatClock(remaining), 'the wakeup changes visible text');
  }
  assert.equal(nextClockDelay(1000.25), 25, 'sub-millisecond boundaries retain the minimum timer interval');
  assert.equal(nextClockDelay(year - 999.75), 25);
});

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}
