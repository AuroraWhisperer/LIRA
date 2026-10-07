const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../public/js/overlays/danmaku-random-position.js'), 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const item = (id, previousPosition) => ({ width: 120, height: 42, entry: { item: { id }, previousPosition } });
const distance = (point, target) => Math.hypot(point.left + 60 - target.x, point.top + 21 - target.y);

test('center bias progressively reduces distance from center and the frequency of edge positions', async () => {
  const { findRandomDanmakuPosition: position } = await modulePromise;
  const totals = [0, 0, 0];
  const edges = [0, 0, 0];
  for (let index = 0; index < 2000; index += 1) {
    let previousDistance = Infinity;
    for (const [level, centerBias] of [1, 25, 50].entries()) {
      const point = position(item(`center-${index}`), 1200, 1200, [], { centerBias });
      const d = distance(point, { x: 600, y: 600 });
      const normalized = ((point.left - 540) / 524) ** 2 + ((point.top - 579) / 563) ** 2;
      assert.ok(normalized <= previousDistance + 1e-9);
      previousDistance = normalized;
      totals[level] += d;
      if (point.left < 100 || point.left > 980 || point.top < 100 || point.top > 1058) edges[level] += 1;
    }
  }
  assert.ok(totals[2] < totals[1] && totals[1] < totals[0] * 0.6);
  assert.ok(edges[2] < edges[0] * 0.1);
});

test('dispersion increases actual Euclidean distance on wide and tall regions, including with center bias', async () => {
  const { findRandomDanmakuPosition: position } = await modulePromise;
  for (const [width, height] of [[1600, 500], [500, 1600]]) {
    for (const centerBias of [1, 25, 50]) {
      const previous = { x: width * 0.3, y: height * 0.4 };
      let nearTotal = 0;
      let farTotal = 0;
      for (let index = 0; index < 1000; index += 1) {
        const candidate = item(`dispersion-${index}`, previous);
        const near = position(candidate, width, height, [], { centerBias, dispersion: 1 });
        const middle = position(candidate, width, height, [], { centerBias, dispersion: 25 });
        const far = position(candidate, width, height, [], { centerBias, dispersion: 50 });
        assert.ok(distance(far, previous) + 1e-9 >= distance(middle, previous));
        assert.ok(distance(middle, previous) + 1e-9 >= distance(near, previous));
        nearTotal += distance(near, previous);
        farTotal += distance(far, previous);
      }
      assert.ok(farTotal > nearTotal * 1.1, `dispersion must remain effective at center bias ${centerBias}`);
    }
  }
});

test('random placement is deterministic, keeps existing positions and fits narrow or crowded regions', async () => {
  const { findRandomDanmakuPosition: position } = await modulePromise;
  const candidate = item('stable');
  const point = position(candidate, 800, 400, [], { centerBias: 50, dispersion: 50 });
  assert.deepEqual(position(candidate, 800, 400, [], { centerBias: 50, dispersion: 50 }), point);
  candidate.entry.position = point;
  assert.deepEqual(position(candidate, 800, 400, [], { centerBias: 1, dispersion: 1 }), point);
  assert.deepEqual(position(item('exact-fit'), 152, 74, []), { left: 16, top: 16 });
  assert.equal(position(item('no-fit'), 151, 74, []), undefined);
  const occupied = [{ left: 16, top: 16, width: 120, height: 42 }];
  const narrow = position(item('next'), 152, 126, occupied, { centerBias: 50, dispersion: 50 });
  assert.deepEqual(narrow, { left: 16, top: 68 });
  assert.equal(position(item('full'), 152, 125, occupied), undefined);
});
