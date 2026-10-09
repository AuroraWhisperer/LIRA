'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tools = require('./lib/page-tools.cjs');
const { OUT_ROOT } = require('./manifest.js');

// Small recipes keep navigation and screenshot subjects reviewable.
const { SHOTS: licenseShots } = require('./supplement-license.cjs');
const { SHOTS: musicShots } = require('./supplement-music.cjs');
const { SHOTS: giftsShots } = require('./supplement-gifts.cjs');
const { SHOTS: toolboxShots } = require('./supplement-toolbox.cjs');

const SHOTS = [...licenseShots, ...musicShots, ...giftsShots, ...toolboxShots];

async function capture(electronApp, shot) {
  const kind = shot.kind || 'admin';
  const size = shot.size || (kind === 'license' ? [1280, 800] : [1440, 900]);
  await electronApp.evaluate(
    async (_electron, { kind, size, license, catalog, update, background, musicAuth }) => {
      Object.assign(global.usageShots.fixture, {
        license: license || { state: 'needs_activation' },
        catalog: catalog || { status: 'ready' },
        update: update || { status: 'idle' },
        musicAuth: musicAuth === true,
        background: background
          ? {
              previewUrl: global.usageShots.baseUrl + '/img/overlays/danmaku-previews/cream.png',
              bytes: 10240,
              updatedAt: new Date().toISOString(),
            }
          : null,
      });
      await global.usageShots.open(kind, ...size);
    },
    {
      kind,
      size,
      license: shot.license,
      catalog: shot.catalog,
      update: shot.update,
      background: shot.background,
      musicAuth: shot.musicAuth,
    },
  );
  const page = electronApp.windows().find((candidate) => !candidate.isClosed());
  page.setDefaultTimeout(4500);
  const componentFeatures = ['liveDanmakuFeature', 'otherGiftFeature', 'otherTextBoxFeature', 'otherOvertimeMachineFeature', 'otherStartAnimationFeature', 'otherClockFeature'];
  if (kind === 'admin') {
    await page.locator('#queueList .queue-row').first().waitFor();
    await tools.applyCovers(page, [
      { selector: shot.keepPending ? '#toast' : '#pendingConfirmPopup, #toast', mode: 'hide' },
    ]);
    await page
      .locator(`[data-main-page="${shot.main || (componentFeatures.includes(shot.feature) ? 'liveComponentsPage' : shot.feature ? 'otherAssistantPage' : 'songAssistantPage')}"]`)
      .click();
  }
  if (shot.feature) await page.locator(`[data-other-feature="${shot.feature}"]`).click();
  if (shot.tab) await page.locator(`[data-tab="${shot.tab}"]`).click();
  if (shot.main === 'playbackAssistantPage') await page.locator('[data-source="qq"]').click();
  for (const selector of shot.click ? [shot.click].flat() : []) await page.locator(selector).click();
  if (shot.setup) await shot.setup(page);
  if (shot.hover) await page.locator(shot.hover).hover();
  if (shot.wait) await page.locator(shot.wait).first().waitFor();
  await tools.settle(page, 200);
  if (shot.scroll) {
    await page
      .locator(shot.scroll)
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await tools.settle(page, 80);
  }
  if (shot.clip) {
    const height = await page.locator(shot.clip).evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    if (height > size[1] - 150) {
      await electronApp.evaluate(
        ({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setContentSize(1440, height + 170),
        height,
      );
    }
    await page.locator(shot.clip).scrollIntoViewIfNeeded();
    await tools.settle(page, 80);
  }
  for (const selector of shot.mustShow || []) {
    const visible = await page.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth)
        return false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
        const bounds = parent.getBoundingClientRect();
        if (r.top < bounds.top || r.bottom > bounds.bottom) return false;
      }
      return true;
    });
    if (!visible) throw new Error(`Required control is clipped: ${selector}`);
  }
  await tools.injectAnnotations(
    page,
    (shot.annotations || []).map((selector, index) => ({ selector, label: index + 1 })),
  );
  const group = shot.id[0];
  const outFile = path.join(OUT_ROOT, 'png', group, `${shot.file}.png`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (shot.clip) await page.locator(shot.clip).screenshot({ path: outFile, scale: 'css' });
  else await page.screenshot({ path: outFile, scale: 'css' });
  const result = {
    id: shot.id,
    group,
    file: shot.file,
    title: shot.title,
    ...tools.pngSize(outFile),
    runtime: 'Electron 43 + real preload + isolated fixture',
  };
  const reportPath = path.join(OUT_ROOT, 'supplement-results.json');
  const results = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : [];
  fs.writeFileSync(reportPath, JSON.stringify([...results.filter((item) => item.id !== result.id), result], null, 2));
  return result;
}

async function main() {
  const { _electron } = require('playwright');
  const selectedIds = process.argv
    .find((arg) => arg.startsWith('--only='))
    ?.slice(7)
    .split(',');
  const app = await _electron.launch({ args: [path.join(__dirname, 'electron-fixture.cjs')], timeout: 30000 });
  try {
    await app.evaluate(async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (global.usageShots) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Screenshot fixture did not start');
    });
    for (const shot of SHOTS.filter((item) => !selectedIds || selectedIds.includes(item.id))) {
      try {
        console.log('[ok]', JSON.stringify(await capture(app, shot)));
      } catch (error) {
        console.error('[fail]', shot.id, error.message);
        process.exitCode = 1;
      }
    }
  } finally {
    await app.close();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { SHOTS, capture };
