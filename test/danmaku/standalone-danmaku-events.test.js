'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();
const SC_ID = 'a'.repeat(64);

async function openDisplay(t, style, options = {}, parameters = {}) {
  const f = await startCanvasOutputFixture({ notifications: true });
  t.after(() => f.close());
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(4000);
  async function configure(styleOptions) {
    const saved = await f.appearance.read();
    await f.appearance.save({ ...saved, config: { ...saved.config, style, styleOptions: { [style]: styleOptions },
      styleParameters: { [style]: parameters } } });
  }
  await configure(options);
  const url = `${f.origin}/danmaku?source=component`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByText('合成开播确认', { exact: true }).waitFor();
  function send(event) {
    assert.equal(f.updateCloud({ liveSessionId: 'synthetic-live', name: '合成用户', ...event }), true);
  }
  return { page, configure, send };
}

test('Harbor retracts a visible SC after 50 filtered gifts evict its event from recent history', async t => {
  const { page, send } = await openDisplay(t, 'harbor', { minGiftAmount: 10 });
  send({ type: 'danmaku', message: '保留这条弹幕' });
  send({ type: 'superchat', messageId: SC_ID, price: 30, message: '待撤回的原文' });
  const card = page.locator('.is-superchat').filter({ hasText: '待撤回的原文' });
  await card.waitFor();
  for (let index = 0; index < 50; index++)
    send({ type: 'gift', giftName: `低价礼物${index}`, giftCount: 1, giftTotalPrice: 1 });
  await page.waitForFunction(() => document.querySelector('#danmakuMessageCount').textContent === '50');
  assert.equal(await page.locator('#danmakuFeed .is-gift').count(), 0);
  assert.equal(await card.count(), 1);
  send({ type: 'superchat-delete', messageIds: [SC_ID] });
  await card.waitFor({ state: 'detached' });
  assert.equal(await page.getByText('保留这条弹幕', { exact: true }).count(), 1);
});

test('Ranked colors and badges follow room guard and medal fields on both conflicting messages', async t => {
  const { page, send } = await openDisplay(t, 'ranked');
  send({ type: 'danmaku', message: '本房舰长', roomGuardLevel: 3, guardLevel: 0, roomMedal: { name: '本房牌', level: 7 } });
  send({ type: 'danmaku', message: '本房观众', roomGuardLevel: 0, guardLevel: 1, medalName: '别房牌', medalLevel: 12 });
  const result = [];
  for (const message of ['本房舰长', '本房观众']) {
    const item = page.locator('.draw-danmaku-item').filter({ hasText: message });
    await item.waitFor();
    result.push(await item.evaluate(el => [el.dataset.identity, el.querySelector('.draw-danmaku-guard')?.textContent,
      el.querySelector('.draw-danmaku-medal')?.textContent]));
  }
  assert.deepEqual(result, [['captain', '舰长', '本房牌 7'], ['viewer', undefined, undefined]]);
});

test('Stargazer applies a retention edit to same-session messages using their original timestamps', async t => {
  const { page, send, configure } = await openDisplay(t, 'stargazer', { stargazerHideSeconds: 0 });
  for (const [message, age] of [['过期弹幕', 75000], ['新弹幕甲', 3000], ['新弹幕乙', 1000]]) {
    send({ type: 'danmaku', message, timestamp: new Date(Date.now() - age).toISOString() });
    await page.getByText(message, { exact: true }).waitFor();
  }
  await configure({ stargazerHideSeconds: 60 });
  await page.getByText('过期弹幕', { exact: true }).waitFor({ state: 'detached' });
  assert.deepEqual(await page.locator('#danmakuFeed').getByText(/^新弹幕[甲乙]$/).allTextContents(), ['新弹幕甲', '新弹幕乙']);
  await configure({ stargazerHideSeconds: 0 });
  send({ type: 'danmaku', message: '设置还原后的新消息' });
  await page.getByText('设置还原后的新消息', { exact: true }).waitFor();
  assert.equal(await page.getByText('过期弹幕', { exact: true }).count(), 0);
  send({ type: 'live-ended' });
  await page.getByText('新弹幕甲', { exact: true }).waitFor({ state: 'detached' });
});

test('Notebook applies the configured outline to normal and SC cards', async t => {
  const { page, send } = await openDisplay(t, 'notebook', {}, { outline: { width: 5, color: '#123456', opacity: 100 } });
  send({ type: 'danmaku', message: '普通纸卡' });
  send({ type: 'superchat', messageId: SC_ID, price: 30, message: '醒目纸卡' });
  const outlined = [];
  for (const text of ['普通纸卡', '醒目纸卡']) {
    const card = page.locator('.notebook-item').filter({ hasText: text });
    await card.waitFor();
    outlined.push(await card.evaluate(async root => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return [root, ...root.querySelectorAll('*')].filter(node => {
        const style = getComputedStyle(node);
        return node.style.borderWidth === '5px' && parseFloat(style.borderTopWidth) > 0 && style.borderTopColor === 'rgb(18, 52, 86)';
      }).length;
    }));
  }
  assert.deepEqual(outlined, [1, 1]);
});
