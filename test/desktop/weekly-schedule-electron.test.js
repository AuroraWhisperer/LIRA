'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { launchElectron } = require('../helpers/shared-electron');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

const ROOT = path.resolve(__dirname, '../..');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><path id="shape" d="M64 16a48 48 0 1 0 0 96a48 48 0 1 0 0-96Z"/></defs><use href="#shape" fill="#d34261"/></svg>';

async function fixture(t) {
  const directory = createScratchDirectory('weekly-schedule-electron-');
  let app;
  t.after(async () => {
    try { await app?.close(); }
    finally { removeScratchDirectory(directory); }
  });
  app = await launchElectron({ cwd: ROOT, args: ['test/fixtures/weekly-schedule-editor.cjs', directory], timeout: 15000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('**/admin');
  await page.locator('[data-weekly-action="export"]:enabled').waitFor();
  assert.equal((await fetch(page.url())).status, 401);
  const assets = await app.evaluate(() => global.weeklyScheduleTest.assets);
  await app.evaluate(({ app }) => {
    global.weeklyScheduleTest.renderDiagnostics = [];
    app.on('browser-window-created', (_event, window) => {
      for (const [target, name] of [[window, 'loadURL'], [window.webContents, 'executeJavaScript'], [window.webContents, 'capturePage']]) {
        const original = target[name].bind(target);
        target[name] = async (...args) => {
          try { return await original(...args); }
          catch (error) { global.weeklyScheduleTest.renderDiagnostics.push(`${name}: ${error.stack}`); throw error; }
        };
      }
    });
  });
  return { app, page, assets, directory, errors };
}

async function openGroup(page, text) {
  const group = page.locator('.weekly-editor-group').filter({ has: page.getByText(text, { exact: true }) });
  const category = await group.evaluate(node => node.closest('[data-weekly-panel]').dataset.weeklyPanel);
  await page.locator(`[data-weekly-tab="${category}"]`).click();
  if (await group.evaluate(node => node.tagName === 'DETAILS' && !node.open)) await group.locator(':scope > summary').click();
}

async function saved(page) {
  await page.locator('[data-weekly-save-state]').filter({ hasText: '已保存到本机' }).waitFor();
}

async function uploadAsset(page, key, file) {
  const input = page.locator(`[data-weekly-asset="${key}"]`);
  await input.setInputFiles(file);
  await input.locator(':scope:enabled').waitFor();
  const status = await page.locator(`[data-weekly-upload-slot="${key}"] .weekly-upload-status`).textContent();
  assert.equal(status, '已上传', await page.locator('[data-weekly-error]').textContent());
}

async function chooseTemplate(page, name) {
  await page.getByRole('button', { name: '我的周表模板', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function exportPng(app, page) {
  const before = await app.evaluate(() => global.weeklyScheduleTest.exports.length);
  await page.locator('[data-weekly-action="export"]').click();
  await page.waitForFunction(() => document.querySelector('[data-weekly-action="export"]').textContent === '导出 PNG');
  const results = await app.evaluate(() => global.weeklyScheduleTest.exports);
  assert.equal(results.length, before + 1);
  const result = results.at(-1);
  assert.equal(result.ok, true, `${result.error || ''}\n${(await app.evaluate(() => global.weeklyScheduleTest.renderDiagnostics)).join('\n')}`);
  assert.equal(result.saved, true);
  const bytes = await fs.readFile(result.filePath);
  assert.equal(bytes.readUInt32BE(16), 1920);
  assert.equal(bytes.readUInt32BE(20), 1080);
  assert.ok(bytes.length > 5000, 'The PNG contains the rendered artwork.');
  return result;
}

test('weekly templates retain real uploaded assets and independent edits across copy, reload and desktop PNG export', { timeout: 90000 }, async t => {
  const { app, page, assets, errors } = await fixture(t);
  await page.locator('[data-weekly-template-name]').fill('周表主模板');
  await page.locator('[data-weekly-action="rename"]').click();
  await openGroup(page, '一周安排');
  await page.locator('[data-weekly-field="days.0.theme"]').fill('第一周歌回');
  await page.locator('[data-weekly-field="days.0.time1"]').fill('20:00–22:00');
  await page.locator('[data-weekly-field="days.0.time2"]').fill('23:00');
  await openGroup(page, '图片素材');
  await uploadAsset(page, 'portrait', assets.png);
  await uploadAsset(page, 'icon', { name: 'static-icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) });
  const iconData = await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src');
  assert.match(iconData, /^data:image\/png;base64,/);
  await openGroup(page, '人设图标');
  await page.locator('[data-weekly-icon="star"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-weekly-preview] .wsa-custom-icon'));
  assert.equal(await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src'), iconData);
  await page.locator('[data-weekly-icon="custom"]').click();
  await page.locator('[data-weekly-preview] .wsa-custom-icon').first().waitFor();
  await openGroup(page, '信息模块');
  await page.locator('[data-weekly-field="modules.message.text"]').fill('周五生日会\n欢迎一起听歌');
  await page.locator('[data-weekly-field="modules.rank.names.0"]').fill('合成观众');
  await page.locator('[data-weekly-field="modules.benefits.enabled"]').check();
  await page.locator('[data-weekly-field="modules.benefits.text"]').fill('专属点歌\n月度壁纸');
  await openGroup(page, '排版与配色');
  await page.getByRole('button', { name: '日程字体', exact: true }).click();
  await page.getByRole('option', { name: '站酷小薇', exact: true }).click();
  await saved(page);
  await page.locator('[data-weekly-action="copy"]').click();
  await page.getByRole('button', { name: '日程字体', exact: true }).click();
  await page.getByRole('option', { name: '思源黑体', exact: true }).click();
  await openGroup(page, '一周安排');
  await page.locator('[data-weekly-field="days.0.theme"]').fill('副本独立主题');
  await saved(page);
  await chooseTemplate(page, '周表主模板');
  assert.equal(await page.locator('[data-weekly-field="days.0.theme"]').inputValue(), '第一周歌回');
  await saved(page);
  await page.reload();
  await page.locator('[data-weekly-action="export"]:enabled').waitFor();
  assert.equal(await page.locator('[data-weekly-field="days.0.theme"]').inputValue(), '第一周歌回');
  assert.equal(await page.locator('[data-weekly-field="days.0.time2"]').inputValue(), '23:00');
  assert.equal(await page.locator('[data-weekly-field="modules.message.text"]').inputValue(), '周五生日会\n欢迎一起听歌');
  assert.equal(await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src'), iconData);
  assert.match(await page.locator('[data-weekly-upload-slot="portrait"] img').getAttribute('src'), /^data:image\/png;base64,/);
  await exportPng(app, page);
  await chooseTemplate(page, '周表主模板 副本');
  assert.equal(await page.locator('[data-weekly-field="days.0.theme"]').inputValue(), '副本独立主题');
  assert.deepEqual(errors, []);
});

test('expanded appearance and schedule controls persist and reach the real PNG renderer', { timeout: 90000 }, async t => {
  const { app, page, assets, errors } = await fixture(t);
  await page.getByRole('tab', { name: '外观', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '排期', exact: true }).getAttribute('aria-selected'), 'true');
  await page.locator('[data-weekly-field="days.0.theme"]').fill('新年歌回');
  await page.locator('[data-weekly-field="monday"]').fill('2026-12-28');
  await page.locator('[data-weekly-action="next-week"]').click();
  assert.equal(await page.locator('[data-weekly-field="monday"]').inputValue(), '2027-01-04');
  assert.equal(await page.locator('[data-weekly-field="days.0.theme"]').inputValue(), '新年歌回');
  await page.locator('[data-weekly-field="days.0.time1"]').fill('19:30');
  await page.locator('[data-weekly-day="1"] > summary').click();
  await page.locator('[data-weekly-field="days.1.rest"]').check();
  await page.locator('[data-weekly-action="apply-times"]').click();
  await page.getByRole('button', { name: '应用时间', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-weekly-field="days.6.time1"]').value === '19:30');
  assert.equal(await page.locator('[data-weekly-field="days.6.time1"]').inputValue(), '19:30');
  assert.equal(await page.locator('[data-weekly-field="days.1.rest"]').isChecked(), true);

  await openGroup(page, '排版与配色');
  await page.locator('[data-weekly-layout="celestial"]').click();
  await page.locator('.weekly-parameter-details > summary').click();
  await page.locator('[data-weekly-number="typography.theme"]').fill('135');
  await openGroup(page, '图片素材');
  await uploadAsset(page, 'logo', assets.png);
  await uploadAsset(page, 'background', assets.png);
  const scale = page.locator('[data-weekly-number="logo.scale"]');
  await scale.fill('350');
  assert.equal(await page.locator('[data-weekly-field="logo.scale"]').inputValue(), '350');
  await scale.fill('');
  await scale.press('Tab');
  assert.equal(await scale.inputValue(), '350');
  const x = page.locator('[data-weekly-number="logo.x"]');
  await x.fill('9000');
  await x.press('Tab');
  assert.equal(await x.inputValue(), '1920');
  await page.locator('[data-weekly-reset="logo"]').click();
  assert.equal(await scale.inputValue(), '100');
  for (const [key, value] of [['logo.scale', '350'], ['logo.rotation', '-25'], ['logo.opacity', '55'], ['background.x', '75'], ['background.blur', '8']]) {
    await page.locator(`[data-weekly-number="${key}"]`).fill(value);
  }
  await page.locator('[data-weekly-field="logo.flip"]').check();
  await page.getByRole('button', { name: '图片适配', exact: true }).click();
  await page.getByRole('option', { name: '完整显示（保留留白）', exact: true }).click();
  await saved(page);
  await page.reload();
  await page.locator('[data-weekly-action="export"]:enabled').waitFor();
  assert.equal(await page.locator('[data-weekly-number="logo.scale"]').inputValue(), '350');
  assert.equal(await page.locator('[data-weekly-number="typography.theme"]').inputValue(), '135');
  assert.equal(await page.locator('[data-weekly-field="days.6.time1"]').inputValue(), '19:30');
  await app.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, window) => {
      const execute = window.webContents.executeJavaScript.bind(window.webContents);
      window.webContents.executeJavaScript = async (...args) => {
        const result = await execute(...args);
        if (args[0].startsWith('window.renderWeeklyScheduleExport(')) {
          global.weeklyScheduleTest.appearance = await execute(`(() => {
            const root = document.querySelector('.weekly-schedule-art');
            const logo = root.querySelector('.wsa-logo');
            const background = getComputedStyle(root.querySelector('.wsa-background-image'));
            return { opacity: getComputedStyle(logo).opacity, rotation: logo.style.getPropertyValue('--wsa-asset-rotation'),
              scale: logo.style.getPropertyValue('--wsa-asset-scale'), theme: root.style.getPropertyValue('--wsa-theme-scale'),
              fit: background.objectFit, position: background.objectPosition, filter: background.filter };
          })()`);
        }
        return result;
      };
    });
  });
  await exportPng(app, page);
  const appearance = await app.evaluate(() => global.weeklyScheduleTest.appearance);
  assert.equal(appearance.opacity, '0.55');
  assert.equal(appearance.rotation, '-25deg');
  assert.equal(appearance.scale, '3.5');
  assert.equal(appearance.theme, '1.35');
  assert.equal(appearance.fit, 'contain');
  assert.equal(appearance.position, '75% 50%');
  assert.equal(appearance.filter, 'blur(8px)');
  assert.deepEqual(errors, []);
});

test('export captures the clicked template while an unfinished save allows further editing', { timeout: 30000 }, async t => {
  const { page } = await fixture(t);
  await page.evaluate(async () => {
    const { createWeeklyScheduleEditor } = await import('/js/admin/weekly-schedule/editor.js');
    const { createWeeklyScheduleTemplate } = await import('/js/admin/weekly-schedule/model.js');
    const previous = document.getElementById('weeklyScheduleEditor');
    const root = previous.cloneNode(true);
    previous.replaceWith(root);
    const template = createWeeklyScheduleTemplate({ id: 'snapshot-check' });
    const state = { version: 1, activeId: template.id, templates: [template] };
    window.weeklySnapshotEditor = await createWeeklyScheduleEditor(root, {
      storage: { load: async () => state, save: () => new Promise(resolve => { window.releaseWeeklySave = resolve; }), close() {} },
      bridge: { async exportPng(value) { window.weeklyExportSnapshot = value; return { ok: true, cancelled: true }; } },
    });
  });
  await page.locator('[data-weekly-field="title"]').fill('点击时的标题');
  await page.locator('[data-weekly-action="export"]').click();
  await page.waitForFunction(() => typeof window.releaseWeeklySave === 'function');
  await page.locator('[data-weekly-field="title"]').fill('下一张图片的标题');
  await page.evaluate(() => window.releaseWeeklySave());
  await page.waitForFunction(() => Boolean(window.weeklyExportSnapshot));
  assert.equal(await page.evaluate(() => window.weeklyExportSnapshot.title), '点击时的标题');
  assert.equal(await page.locator('[data-weekly-field="title"]').inputValue(), '下一张图片的标题');
  await page.evaluate(() => { window.weeklySnapshotEditor.dispose(); window.releaseWeeklySave(); });
});

test('WebP assets export through the real bridge and rejected SVG replacements preserve the saved icon', { timeout: 90000 }, async t => {
  const { app, page, assets, errors } = await fixture(t);
  await openGroup(page, '图片素材');
  await uploadAsset(page, 'portrait', assets.webp);
  await uploadAsset(page, 'icon', { name: 'good.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) });
  const original = await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src');
  for (const source of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>window.svgAttack=1</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://invalid-weekly-asset.test/icon.svg#shape"/></svg>',
  ]) {
    const input = page.locator('[data-weekly-asset="icon"]');
    await input.setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(source) });
    await input.locator(':scope:enabled').waitFor();
    await page.locator('[data-weekly-error]:not([hidden])').waitFor();
    assert.equal(await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src'), original);
  }
  assert.equal(await page.evaluate(() => window.svgAttack), undefined);
  await saved(page);
  await page.reload();
  await page.locator('[data-weekly-action="export"]:enabled').waitFor();
  assert.equal(await page.locator('[data-weekly-upload-slot="icon"] img').getAttribute('src'), original);
  await exportPng(app, page);
  assert.deepEqual(errors, []);
});

for (const initialWidth of [960, 1920]) {
  test(`desktop PNG export retains all four canvas corners from an initial ${initialWidth}px window`, { timeout: 90000 }, async t => {
    const { app, page, errors } = await fixture(t);
    await app.evaluate(({ app }, initialWidth) => {
      app.once('browser-window-created', (_event, window) => {
        const load = window.loadURL.bind(window);
        window.loadURL = async (...args) => {
          await load(...args);
          // Reproduce a display constraining the initial hidden window on any monitor.
          window.setContentSize(initialWidth, initialWidth * 9 / 16);
          await execute('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        };
        const execute = window.webContents.executeJavaScript.bind(window.webContents);
        window.webContents.executeJavaScript = async (...args) => {
          const result = await execute(...args);
          if (args[0].startsWith('window.renderWeeklyScheduleExport(')) {
            await execute(`new Promise(resolve => {
              const root = document.querySelector('.weekly-schedule-art');
              for (const [x, y] of [[8, 8], [1888, 8], [8, 1048], [1888, 1048]]) {
                const marker = document.createElement('div');
                marker.style.cssText = 'position:absolute;width:24px;height:24px;background:#ff00ff;z-index:99999;left:' + x + 'px;top:' + y + 'px';
                root.append(marker);
              }
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            })`);
          }
          return result;
        };
      });
    }, initialWidth);
    const result = await exportPng(app, page);
    const corners = await app.evaluate(({ nativeImage }, filePath) => {
      const image = nativeImage.createFromPath(filePath);
      const bitmap = image.toBitmap();
      return [[16, 16], [1904, 16], [16, 1064], [1904, 1064]].map(([x, y]) => {
        const offset = (y * 1920 + x) * 4;
        return { x, y, pixel: Array.from(bitmap.subarray(offset, offset + 4)) };
      });
    }, result.filePath);
    for (const { x, y, pixel } of corners) {
      assert.deepEqual(pixel, [255, 0, 255, 255], `Canvas corner at ${x},${y} was lost or rescaled.`);
    }
    assert.deepEqual(errors, []);
  });
}
