'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { saveMedia } = require('../../src/server/component-media-files');
const { createComponentStyleStore } = require('../../src/storage/component-style-store');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createLayout } = require('../../src/shared/danmaku-layout');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
const { readAdminHtml } = require('./admin-html');

async function installResourceStyles(dataDir) {
  const store = createComponentStyleStore(dataDir);
  const id = randomUUID();
  const styles = [];
  for (const [key, name] of [['nautical-guard-thanks', '航海旗帜'], ['moonlit-clock', '配套时钟'], ['moonlit-danmaku', '配套弹幕'],
    ['moonlit-wishes', '配套许愿'], ['moonlit-queue', '配套点歌板'], ['moonlit-lyrics', '配套歌词']]) {
    const preset = COMPONENT_RESOURCE_PRESETS[key];
    const resources = {};
    for (const source of preset.resources) {
      const media = await saveMedia(fs.createReadStream(path.resolve(__dirname, '../../public', `.${source}`)), store.directory(id, true), source, { packageResource: true });
      resources[source] = `/component-media/${id}/${media.basename}`;
    }
    const resourceStyle = { id: randomUUID(), preset: key, preview: Object.values(resources)[0], width: preset.size[0], height: preset.size[1], resources };
    const base = preset.type === 'clock' ? getClockConfig(DEFAULT_SETTINGS)
      : preset.type === 'danmaku' ? { fullscreenDurationSeconds: 6, styleOptions: {}, layout: createLayout() } : {};
    styles.push({ id: resourceStyle.id, type: preset.type, name, config: normalizeSceneConfig(preset.type, { ...base, ...preset.config, resourceStyle }) });
  }
  store.stage({ id, name: '配套样式测试', styles }); store.install(id);
  return styles;
}

async function mountResourceStylePage(page) {
  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  await page.route('**/api/gifts/wishes', route => route.fulfill({ json: { ok: true, data: {
    viewRevision: 'resource-styles', items: [], partial: false, guards: [], session: { state: 'live' },
  } } }));
  await page.route('**/api/overtime/gifts/catalog', route => route.fulfill({ json: { ok: true, data: { gifts: [
    { id: '1', name: '小花花', imagePath: '/img/overlays/gift-feed/flower.webp' },
    { id: '2', name: '牛哇牛哇', imagePath: '/img/overlays/gift-feed/cheer.webp' },
    { id: '3', name: '打call', imagePath: '/img/overlays/gift-feed/call.webp' },
  ] } } }));
  await page.evaluate(async markup => {
    const source = new DOMParser().parseFromString(markup, 'text/html');
    for (const id of ['guardThanksPanel', 'otherClockFeature', 'giftWishesPanel', 'themePage', 'desktopLyricPage']) {
      const panel = source.getElementById(id);
      panel.hidden = false; panel.style.display = 'block'; document.body.append(panel);
    }
    const { initGuardThanks, renderGuardThanks } = await import('/js/admin/gift-guard-thanks.js');
    initGuardThanks(); renderGuardThanks({ guardThanksNauticalEnabled: 'false' });
    const { createGiftWishes } = await import('/js/admin/gifts/wishes.js');
    window.resourceTestWishes = createGiftWishes(); await window.resourceTestWishes.open();
    const { initComponentStyleLibraries } = await import('/js/admin/component-style-client.js');
    initComponentStyleLibraries();
  }, readAdminHtml());
}

module.exports = { installResourceStyles, mountResourceStylePage };
