'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const fixture = createUiFixture();

test('ranking failures have one status owner while cached rows retain their rank context', async t => {
  const page = await fixture(t, 'rankings');
  await page.evaluate(async () => {
    const { createRankingsView } = await import('/js/shared/live-rankings-view.js');
    document.body.innerHTML = '<div id="admin"></div><div id="overlay"></div>';
    const admin = createRankingsView(document.getElementById('admin'), { scrollable: true, statusExternallyRendered: true });
    const overlay = createRankingsView(document.getElementById('overlay'), { scrollable: true });
    window.updateRankings = snapshot => { admin.update(snapshot); overlay.update(snapshot); };
    window.disposeRankings = () => { admin.dispose(); overlay.dispose(); };
  });
  const board = { id: 'hot', title: '测试榜单', unit: '热度值', limit: 50, rows: [], current: null };
  for (const status of ['loading', 'unavailable', 'stale']) {
    await page.evaluate(snapshot => window.updateRankings(snapshot), { status, message: 'synthetic status',
      boards: [{ ...board, status: status === 'stale' ? 'unavailable' : status, message: 'synthetic status' }] });
    assert.equal(await page.locator('#admin .ranking-empty:visible, #admin .ranking-distance:visible, #admin .ranking-freshness:visible').count(), 0);
    assert.equal(await page.locator('#overlay .ranking-empty:visible, #overlay .ranking-distance:visible, #overlay .ranking-freshness:visible').count(), 1);
  }
  const current = { roomId: '25', uid: '1', rank: 1, name: '测试直播间', score: 3210, avatarUrl: '' };
  await page.evaluate(snapshot => window.updateRankings(snapshot), { status: 'stale', message: 'synthetic status', room: { roomId: '25' },
    boards: [{ ...board, status: 'stale', message: 'synthetic status', rows: [current], current }] });
  for (const host of ['#admin', '#overlay']) {
    assert.equal(await page.locator(`${host} .ranking-list .ranking-row`).count(), 1);
    assert.equal(await page.locator(`${host} .ranking-distance`).isVisible(), true);
    assert.equal(await page.locator(`${host} .ranking-freshness`).isVisible(), true);
    assert.equal(await page.locator(`${host} .ranking-empty`).isVisible(), false);
  }
  await page.evaluate(() => window.disposeRankings());
});
