'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { OUT_ROOT } = require('./manifest.js');
const { settle, pngSize } = require('./lib/page-tools.cjs');

const SHOTS = [
  { id: 'S6', file: 'server-manage-danmaku', title: '网页主播中心：弹幕姬样式', route: '/manage', workspace: 'overlay' },
  { id: 'S6b', file: 'server-manage-danmaku-url', title: '网页主播中心：OBS 地址与复制按钮', route: '/manage', workspace: 'overlay', scroll: '#overlayUrl', mustShow: ['#overlayUrl', '#overlayCopyBtn', '[data-workspace-link="overlay"]'] },
  { id: 'F3b', file: 'public-song-page-appearance-expanded', title: '网页主播中心：展开歌单外观设置', route: '/manage', workspace: 'song-page', click: '#songAppearanceDetails summary', scroll: '#songAppearanceHeading', block: 'start', mustShow: ['#songAppearanceReset'] },
  { id: 'F7', file: 'public-overlay-queue', title: '点歌板实际输出（隔离示例队列）', route: '/queue', local: true },
  { id: 'F8', file: 'public-overlay-songs', title: '歌曲展示板实际输出（隔离示例歌库）', route: '/songlist', local: true, viewport: { width: 440, height: 650 } },
];

async function capture(page, baseUrl, shot) {
  await page.setViewportSize(shot.viewport || { width: 1440, height: 900 });
  const response = await page.request.get(baseUrl + shot.route);
  if (!response.ok()) throw new Error(`${shot.route}: HTTP ${response.status()}`);
  await response.dispose();
  await page.goto(baseUrl + shot.route, { waitUntil: 'domcontentloaded' });
  if (shot.workspace) await page.locator(`[data-workspace-link="${shot.workspace}"]`).click();
  if (shot.click) await page.locator(shot.click).click();
  await settle(page, 300);
  if (shot.scroll) await page.locator(shot.scroll).evaluate((el, block) => el.scrollIntoView({ block, behavior: 'instant' }), shot.block || 'center');
  for (const selector of shot.mustShow || []) {
    const box = await page.locator(selector).boundingBox();
    if (!box || box.y < 0 || box.y + box.height > page.viewportSize().height) {
      throw new Error(`Required control is clipped: ${selector}`);
    }
  }
  const group = shot.id[0];
  const outFile = path.join(OUT_ROOT, 'png', group, `${shot.file}.png`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile, scale: 'css' });
  const result = { id: shot.id, group, file: shot.file, title: shot.title, ...pngSize(outFile),
    runtime: shot.local ? 'Isolated local overlay renderer' : 'Real server frontend + synthetic GET API' };
  const reportPath = path.join(OUT_ROOT, 'web-supplement-results.json');
  const results = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : [];
  fs.writeFileSync(reportPath, JSON.stringify([...results.filter((item) => item.id !== result.id), result], null, 2));
  return result;
}

async function main() {
  const { chromium } = require('playwright');
  const fixture = await require('./web-fixture.cjs').start();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const selected = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
    // Local overlays use the existing isolated Electron runtime; pass its URL in the REPL.
    for (const shot of SHOTS.filter((item) => !item.local && (!selected || selected.includes(item.id)))) {
      console.log('[ok]', JSON.stringify(await capture(page, fixture.baseUrl, shot)));
    }
  } finally {
    await browser.close();
    fixture.server.closeAllConnections();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { SHOTS, capture };
