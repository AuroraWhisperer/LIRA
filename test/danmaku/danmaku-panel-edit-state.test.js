'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { DANMAKU_STYLE_OPTIONS } = require('../../src/shared/danmaku-style-options');

const fixture = createUiFixture();
async function allowAppearanceSamples(page) {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/pages/overlays/danmaku.html'), 'utf8');
  await page.route('**/css/**', route => route.fulfill({ status: 200, contentType: 'text/css',
    body: fs.readFileSync(path.resolve(__dirname, '../../public', new URL(route.request().url()).pathname.slice(1)), 'utf8') }));
  await page.evaluate(html => {
    const fetch = window.fetch;
    window.fetch = (url, ...args) => new URL(url, location.href).pathname === '/danmaku'
      ? Promise.resolve(new Response(html, { status: 200 })) : fetch(url, ...args);
  }, html);
}

test('spooky client and cloned canvas panels share palette overrides, independent alpha and scoped restore', async (t) => {
  const page = await fixture(t, 'danmaku');
  await allowAppearanceSamples(page);
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    window.parameterModule = await import('/js/admin/danmaku-parameter-view.js');
    window.panelModule = await import('/js/admin/component-preview-panel.js');
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  await page.evaluate(() => {
    const { bindDanmakuParameters } = window.parameterModule;
    const { cloneComponentPanel } = window.panelModule;
    const listeners = new Set();
    window.paletteEdits = [];
    window.paletteState = { loaded: true, draft: { style: 'spooky', fullscreenDurationSeconds: 6,
      styleOptions: { spooky: { fontSize: 24, spookyTheme: 'autumn', spookyFrame: 'hide' }, signal: { textColor: '#abcdef' } },
    } };
    const controller = {
      getState: () => window.paletteState,
      edit: patch => { window.paletteEdits.push(patch); Object.assign(window.paletteState.draft, patch); listeners.forEach(listener => listener(window.paletteState)); },
      subscribe: listener => { listeners.add(listener); listener(window.paletteState); return () => listeners.delete(listener); },
    };
    window.paletteController = controller;
    window.paletteBinding = bindDanmakuParameters(document.body, controller, message => window.messages.push(message));
    const clone = cloneComponentPanel(document.querySelector('.danmaku-parameters'), 'canvas');
    document.body.append(clone);
    window.canvasPaletteBinding = bindDanmakuParameters(clone, controller, message => window.messages.push(message));
    document.querySelectorAll('[data-preview-field="danmakuAppearanceOptions"]').forEach(details => { details.open = true; });
  });
  for (const [key, value] of [['SpookyFrameColor', '#123456'], ['SpookyMessageColor', '#234567'], ['SpookyEventColor', '#345678'], ['SpookyAccentColor', '#456789'], ['TextColor', '#fce6fa']]) {
    await page.locator(`#danmaku${key}`).evaluate((input, color) => {
      input.value = color; input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    assert.equal(await page.locator(`#canvas-danmaku${key}`).inputValue(), value);
  }
  await page.evaluate(() => { window.paletteEdits = []; });
  const alpha = page.locator('#danmakuSpookyMessageOpacity');
  await alpha.evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => window.paletteEdits.length), 0);
  await alpha.dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.paletteEdits.length), 1);
  assert.equal(await page.locator('#canvas-danmakuSpookyMessageOpacity').inputValue(), '40');
  await page.locator('#danmakuSpookyTheme').selectOption('moonlight');
  assert.equal(await page.locator('#danmakuTextColor').inputValue(), '#fce6fa');
  assert.equal(await page.locator('#danmakuSpookyMessageColor').inputValue(), '#234567');
  assert.equal(await page.locator('#canvas-danmakuSpookyMessageOpacity').inputValue(), '40');
  await page.locator('#canvas-danmakuSpookyResetColors').click();
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions), {
    spooky: { fontSize: 24, spookyTheme: 'moonlight', spookyFrame: 'hide' }, signal: { textColor: '#abcdef' },
  });
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => { window.paletteBinding.dispose(); window.canvasPaletteBinding.dispose(); });
});

test('RIPPLOID colors edit independently, switch styles safely and reset only their own draft', async (t) => {
  const page = await fixture(t, 'danmaku');
  await allowAppearanceSamples(page);
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    window.queryLocalFonts = async () => [{ family: 'Georgia' }];
    window.parameterModule = await import('/js/admin/danmaku-parameter-view.js');
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  await page.evaluate(() => {
    const { bindDanmakuParameters } = window.parameterModule;
    const listeners = new Set();
    window.paletteState = { loaded: true, draft: {
      style: 'ripploid',
      styleOptions: { ripploid: { giftColor50: '#123456' }, snowfox: { bubbleColor: '#ba739c' } },
      fullscreenDurationSeconds: 6,
    } };
    const controller = {
      getState: () => window.paletteState,
      edit: patch => {
        Object.assign(window.paletteState.draft, patch);
        listeners.forEach(listener => listener(window.paletteState));
      },
      subscribe: listener => { listeners.add(listener); listener(window.paletteState); return () => listeners.delete(listener); },
    };
    window.paletteController = controller;
    window.paletteBinding = bindDanmakuParameters(document.body, controller, message => window.messages.push(message));
    document.querySelector('#danmakuAppearanceOptions').open = true;
  });
  assert.equal(await page.locator('#danmakuGiftColor50').inputValue(), '#123456');
  await page.locator('#danmakuGiftColor50').click();
  const picker = page.locator('.lira-color-picker');
  assert.equal(await picker.getByLabel('不透明度（%）', { exact: true }).isVisible(), false,
    'event colors cannot offer opacity that the saved style contract rejects');
  await picker.getByLabel('十六进制颜色', { exact: true }).fill('#a1b2c3');
  await picker.getByRole('button', { name: '完成', exact: true }).click();
  for (const [id, value] of [['danmakuGuardColorAdmiral', '#654321'], ['danmakuSuperchatColor2000', '#abcdef']]) {
    await page.locator(`#${id}`).evaluate((input, color) => {
      input.value = color;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid), {
    giftColor50: '#a1b2c3', guardColorAdmiral: '#654321', superchatColor2000: '#abcdef',
  });
  await page.waitForFunction(() => !document.getElementById('danmakuNicknamePart1FontFamily').disabled);
  assert.equal(await page.locator('#danmakuNicknamePart2FontFamilyField').isHidden(), true);
  await page.locator('#danmakuNicknamePart1FontFamily').selectOption('"Georgia"');
  const mergedFonts = await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid);
  assert.equal(mergedFonts.nicknamePart1FontFamily, '"Georgia"');
  assert.equal(mergedFonts.nicknamePart2FontFamily, '"Georgia"', 'Equal fonts share one control and update together.');
  assert.equal(mergedFonts.nicknamePart3FontFamily, undefined, 'The ticket signature keeps its own font.');
  assert.equal(await page.locator('#danmakuBubbleColor').inputValue(), DANMAKU_STYLE_OPTIONS.ripploid.defaultBubbleColor);
  await page.locator('#danmakuBubbleColor').evaluate(input => { input.value = '#ab7890'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid.bubbleColor), '#ab7890');
  await page.evaluate(() => window.paletteController.edit({ style: 'snowfox' }));
  await page.evaluate(() => window.paletteController.edit({ style: 'ripploid' }));
  await page.locator('#danmakuTitleSuperchatFontSize').press('ArrowRight');
  await page.locator('#danmakuTitleSuperchatFontSize').press('Tab');
  assert.equal(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid.titleSuperchatOutlineFontSize), 56.01);
  assert.equal(await page.locator('#danmakuTitleFontSize').inputValue(), '25', 'Adjusting SC leaves the gift ticket cluster unchanged.');
  assert.equal(await page.locator('#danmakuTitleGuardFontSize').inputValue(), '38', 'The member card remains independently adjustable.');
  await page.locator('#danmakuResetParameters').click();
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid), {});
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.snowfox), { bubbleColor: '#ba739c' });
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => window.paletteBinding.dispose());
});

test('danmaku fields retain pending input and synchronize committed values while still focused', async (t) => {
  const page = await fixture(t, 'danmaku');
  await allowAppearanceSamples(page);
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    window.parameterModule = await import('/js/admin/danmaku-parameter-view.js');
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  await page.evaluate(() => {
    const { bindDanmakuParameters } = window.parameterModule;
    const listeners = new Set();
    window.parameterState = { loaded: true, draft: { style: 'starveil', styleOptions: {}, fullscreenDurationSeconds: 6 } };
    window.parameterEdits = [];
    window.refreshParameters = () => listeners.forEach(listener => listener(window.parameterState));
    const controller = {
      getState: () => window.parameterState,
      edit: patch => { window.parameterEdits.push(patch); Object.assign(window.parameterState.draft, patch); window.refreshParameters(); },
      subscribe: listener => { listeners.add(listener); listener(window.parameterState); return () => listeners.delete(listener); },
    };
    window.parameterBinding = bindDanmakuParameters(document.body, controller, message => window.messages.push(message));
  });
  await page.locator('#danmakuMotionOptions > summary').click();
  const entrance = page.locator('#danmakuEntranceAnimation');
  await entrance.focus();
  await entrance.evaluate(input => { input.value = 'rise'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 0);
  await entrance.dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
  assert.equal(await page.evaluate(() => window.parameterState.draft.styleOptions.starveil.entranceAnimation), 'rise');
  await page.evaluate(() => {
    window.parameterState.draft.styleOptions.starveil.entranceAnimation = 'none';
    window.refreshParameters();
  });
  assert.equal(await entrance.inputValue(), 'none', 'An edit from the other panel updates a committed select without requiring blur.');
  await page.locator('#danmakuAppearanceOptions > summary').click();
  for (const [style, id, key, value, saved] of [
    ['starveil', 'FontSize', 'fontSize', 34, 34],
    ['starveil', 'NicknameFontSize', 'nicknameFontSize', 26, 26],
    ['starveil', 'BackgroundOpacity', 'backgroundOpacity', 55, 55],
    ['floating', 'FloatingSpeed', 'speedPixelsPerSecond', 100, 360],
  ]) {
    await page.evaluate(style => { window.parameterState.draft.style = style; window.refreshParameters(); window.parameterEdits = []; }, style);
    const input = page.locator(`#danmaku${id}`);
    await input.focus();
    await input.evaluate((input, value) => {
      for (const current of [value - 2, value - 1, value]) {
        input.value = String(current);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window.refreshParameters();
    }, value);
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 0, `${id} must not submit during dragging`);
    assert.equal(await input.inputValue(), String(value));
    await input.dispatchEvent('change');
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
    assert.equal(await page.evaluate(({ style, key }) => window.parameterState.draft.styleOptions[style][key], { style, key }), saved);
    await page.evaluate(({ style, key }) => {
      delete window.parameterState.draft.styleOptions[style][key];
      window.refreshParameters();
    }, { style, key });
    assert.notEqual(await input.inputValue(), String(value), 'A committed slider follows changes from the other panel while focused.');
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 1, 'Synchronizing a field does not submit another edit.');
    if (key === 'nicknameFontSize') {
      await input.press('ArrowRight');
      assert.equal(await page.evaluate(() => window.parameterState.draft.styleOptions.starveil.nicknameFontSize), 24.01);
      await input.press('Home');
      assert.equal(await page.evaluate(() => window.parameterState.draft.styleOptions.starveil.nicknameFontSize), 8,
        'The first stop is the numeric minimum, not an original-style sentinel.');
    }
  }
  await page.locator('#danmakuAdvancedOptions > summary').click();
  await page.locator('[data-effect-group="shadow"] > summary').click();
  await page.locator('[data-effect-enabled="shadow"]').check();
  await page.evaluate(() => { window.parameterEdits = []; });
  const slider = page.getByRole('slider', { name: '外投影 · 模糊滑块', exact: true });
  const number = page.locator('[data-effect-field="shadow.blur"]');
  await slider.focus();
  await slider.evaluate(input => { input.value = '24'; input.dispatchEvent(new Event('input', { bubbles: true })); window.refreshParameters(); });
  assert.equal(await number.inputValue(), '24', 'paired number retains the pending slider value');
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 0);
  await slider.dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
  await number.fill('19');
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 1, 'typing waits for completion');
  await number.press('Tab');
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 2);
  assert.equal(await page.evaluate(() => window.parameterState.draft.styleParameters.floating.shadow.blur), 19);
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => window.parameterBinding.dispose());
});

test('danmaku panel saves toggles, previews a selected style and discards failed appearance edits', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['otherDanmakuFeature', 'liveDanmakuFeature']) {
      const panel = parsed.getElementById(id);
      panel.hidden = false;
      document.body.append(panel);
    }
    window.requests = [];
    window.opened = [];
    window.appearanceConfig = { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {} };
    window.open = (url) => window.opened.push(url);
    window.liraLicense = {
      getState: async () => ({
        state: 'authorized',
        streamer: {
          accountName: 'synthetic',
          songPageUrl: 'https://lira-ui.test/',
        },
      }),
    };
    window.fetch = async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      window.requests.push({ url, body });
      let data;
      if (url === '/api/danmaku/appearance') {
        data = { binding: 'synthetic-appearance', config: window.appearanceConfig };
      } else if (url === '/api/bilibili/danmaku/state') {
        data = {
          loggedIn: true,
          accountName: '测试账号',
          accountUid: 123,
          roomId: 456,
          roomName: '测试直播间',
          canSend: true,
          connected: true,
          checkinBlessings: JSON.stringify(['测试祝福']),
          fortunePool: JSON.stringify([{ level: '吉', name: '测试签', text: '测试签文', advice: '测试建议' }]),
          customReplyRules: JSON.stringify([{ keyword: '测试关键词', reply: '测试回复', enabled: true }]),
        };
      } else if (url === '/api/settings') {
        data = body;
      } else {
        throw new Error(`Unexpected danmaku fetch: ${url}`);
      }
      return { ok: true, json: async () => ({ ok: true, data }), text: async () => JSON.stringify({ ok: true, data }) };
    };
    window.danmakuTool = (await import('/js/admin/danmaku-tool.js')).danmakuTool;
  }, readAdminFragmentHtml('pages/admin/toolbox/danmaku.html') +
    readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  await page.evaluate(async () => {
    window.danmakuTool.init({ toast: (message) => window.messages.push(message) });
    await window.danmakuTool.refresh();
  });

  await page.locator('#danmakuStyleChip').filter({ hasText: '已应用' }).waitFor();
  for (const [id, key] of [
    ['danmakuReplyToggle', 'enableRandomTagReply'],
    ['danmakuCustomReplyToggle', 'enableCustomReplyBot'],
  ]) {
    await page.locator(`#${id}`).check();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1).body), { [key]: 'true' });
  }
  assert.equal(await page.locator('#danmakuCustomReplyList input').first().inputValue(), '测试关键词');
  const requestCount = await page.evaluate(() => window.requests.length);
  await page.locator('#danmakuAllStylesBtn').click();
  for (const layout of ['fixed', 'fullscreen-random', 'floating', 'horizontal']) {
    await page.locator(`[data-style-filter-group="layout"] [data-filter-value="${layout}"]`).click();
    assert.equal(await page.locator('#danmakuStyleLibrary [data-danmaku-style="celestial-horizontal"]').isVisible(), layout === 'horizontal');
  }
  await page.locator('[data-style-filter-group="layout"] [data-filter-value="fullscreen-random"]').click();
  assert.equal(await page.evaluate(() => window.requests.length), requestCount, 'Browsing categories must not write settings.');
  // The preview handshake is shared by every style; one selected style proves the panel wiring.
  const style = 'cream';
  await page.locator(`#danmakuStyleLibrary [data-danmaku-style="${style}"]`).click();
  await page.locator('#danmakuPreviewOverlayBtn').click();
  await page.waitForFunction((style) => window.pendingSaves.some((request) =>
    request.url === '/api/component-preview' && request.body.action === 'open'
      && request.body.state.draft.style === style), style);
  const component = await page.evaluate((style) => {
    const request = window.pendingSaves.find((request) => request.body.action === 'open'
      && request.body.state.draft.style === style);
    request.resolve({ data: { id: `preview-${style}`, token: `synthetic-preview-${style}` } });
    return request.body.component;
  }, style);
  assert.equal(component, 'danmaku');
  await page.waitForFunction((style) => window.pendingSaves.some((request) =>
    request.body.action === 'link' && request.body.links[0].id === `preview-${style}`), style);
  const selectedId = await page.evaluate((style) => {
    const request = window.pendingSaves.find((request) => request.body.action === 'link'
      && request.body.links[0].id === `preview-${style}`);
    request.resolve({ data: { key: 'a'.repeat(22) } });
    return request.body.selectedId;
  }, style);
  assert.equal(selectedId, 'danmaku');
  await page.waitForFunction(() => window.pendingSaves.filter((request) =>
    request.url === '/api/component-preview' && request.body.action === 'focus').length === 1);
  const focusKey = await page.evaluate(() => {
    const request = window.pendingSaves.findLast((request) => request.body.action === 'focus');
    request.resolve({ data: { focused: false } });
    return request.body.key;
  });
  assert.equal(focusKey, 'a'.repeat(22));
  await page.waitForFunction(() => window.opened.length === 1);
  const preview = new URL(await page.evaluate(() => window.opened.at(-1)));
  assert.equal(preview.pathname, '/c');
  assert.equal(preview.search, '');
  assert.equal(preview.hash, `#${'a'.repeat(22)}`);
  await page.evaluate(async () => {
    const { closeComponentPreview } = await import('/js/admin/component-preview-session.js');
    closeComponentPreview();
  });
  await page.waitForFunction(() => window.pendingSaves.some(request => request.url === '/api/danmaku/appearance'));
  await page.evaluate(() => window.pendingSaves.find(request => request.url === '/api/danmaku/appearance')
    .reject(new Error('Synthetic appearance failure')));
  await page.locator('#danmakuDiscardOverlayBtn').click();
  assert.equal(await page.locator('[data-recent-danmaku-style="signal"]').getAttribute('aria-pressed'), 'true');
});

test('style library combines filters, orders recent picks immediately and restores applied styles per account', async (t) => {
  const page = await fixture(t, 'danmaku');
  const mount = async (firstStyle = 'ripploid') => {
    await page.evaluate(({ html, firstStyle }) => {
      document.body.innerHTML = html;
      document.getElementById('liveDanmakuFeature').hidden = false;
      window.activeAppearanceAccount = 'first';
      window.appearanceConfigs = {
        first: { style: firstStyle, fullscreenDurationSeconds: 6, styleOptions: { signal: { fontSize: 34 } } },
        second: { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {} },
      };
      window.appearanceSnapshot = (accountName) => ({
        state: 'authorized', streamer: { accountName, songPageUrl: `https://${accountName}.example.test/` },
      });
      window.liraLicense = {
        getState: async () => window.appearanceSnapshot(window.activeAppearanceAccount),
        onStateChanged: (callback) => { window.appearanceAccountChanged = callback; return () => {}; },
      };
      window.fetch = async (url) => {
        if (url !== '/api/danmaku/appearance') throw new Error(`Unexpected appearance request: ${url}`);
        const data = { binding: `synthetic-${window.activeAppearanceAccount}`, config: window.appearanceConfigs[window.activeAppearanceAccount] };
        return { ok: true, json: async () => ({ ok: true, data }), text: async () => JSON.stringify({ ok: true, data }) };
      };
      // Complete the import in the page; CDP waits for explicit readiness below.
      window.appearanceSettingsModule = import('/js/admin/danmaku-overlay-settings.js').then(({ initDanmakuOverlaySettings }) => {
        window.appearanceController = initDanmakuOverlaySettings({
          styleButtons: Array.from(document.querySelectorAll('[data-danmaku-style]')),
          styleChip: document.getElementById('danmakuStyleChip'),
          styleSaveState: document.getElementById('danmakuStyleSaveState'),
          previewOverlayButton: document.getElementById('danmakuPreviewOverlayBtn'),
        }, message => window.messages.push(message));
      });
    }, { html: readAdminFragmentHtml('pages/admin/live-components/danmaku.html'), firstStyle });
    await page.waitForFunction(() => window.appearanceController?.getState().loaded);
  };
  await mount();
  const history = account => page.evaluate((accountName) => {
    const account = JSON.stringify([accountName, `https://${accountName}.example.test/`]);
    return JSON.parse(localStorage.getItem(`lira.danmaku-recent-styles.v1.${encodeURIComponent(account)}`) || '[]');
  }, account);
  const choose = async (style) => {
    await page.locator('#danmakuAllStylesBtn').click();
    await page.locator(`#danmakuStyleLibrary [data-danmaku-style="${style}"]`).click();
  };
  const save = page.locator('#danmakuApplyOverlayBtn');
  const library = page.locator('#danmakuStyleLibrary');
  const recentOrder = () => page.locator('[data-recent-danmaku-style]').evaluateAll(cards => cards.map(card => card.dataset.recentDanmakuStyle));
  await page.locator('#danmakuAllStylesBtn').click();
  const styleOrder = () => library.locator('[data-danmaku-style]').evaluateAll(cards => cards.map(card => card.dataset.danmakuStyle));
  const originalOrder = await styleOrder();
  const favorite = style => library.locator(`[data-danmaku-favorite="${style}"]`);
  await favorite('cream').click();
  await favorite('signal').click();
  assert.deepEqual((await styleOrder()).slice(0, 2), ['signal', 'cream'], 'Newer favorites lead the list.');
  assert.equal(await page.evaluate(() => window.appearanceController.getState().dirty), false, 'Favoriting does not edit the appearance.');
  await favorite('signal').click();
  assert.equal((await styleOrder())[0], 'signal', 'Unfavoriting holds the current position until reopening.');
  assert.equal(await library.isVisible(), true, 'Favorite actions keep the library open.');
  await page.locator('#danmakuCloseStyleLibraryBtn').click();
  await page.locator('#danmakuAllStylesBtn').click();
  assert.deepEqual(await styleOrder(), ['cream', ...originalOrder.filter(style => style !== 'cream')]);
  await page.evaluate(() => {
    window.favoriteStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('lira.danmaku-favorite-styles.')) throw new Error('Synthetic storage failure');
      return window.favoriteStorageWrite.call(this, key, value);
    };
  });
  const resultCount = await page.locator('#danmakuStyleResultCount').textContent();
  await favorite('outline').click();
  assert.equal(await favorite('outline').getAttribute('aria-pressed'), 'false', 'A failed write must not claim a favorite.');
  assert.notEqual(await page.locator('#danmakuStyleResultCount').textContent(), resultCount, 'The open library reports the storage failure.');
  assert.equal((await styleOrder())[0], 'cream');
  await page.evaluate(() => { Storage.prototype.setItem = window.favoriteStorageWrite; });
  await page.locator('[data-style-filter-group="motion"] [data-filter-value="true"]').click();
  assert.equal(await library.locator('[data-danmaku-style="ripploid"]').isVisible(), true, 'Layered entry is style motion.');
  assert.equal(await library.locator('[data-danmaku-style="bubble"]').isVisible(), false, 'Whole-card entry alone is not style motion.');
  await page.locator('[data-style-filter-group="motion"] [data-filter-value="false"]').click();
  assert.equal(await library.locator('[data-danmaku-style="ripploid"]').isVisible(), false);
  assert.equal(await library.locator('[data-danmaku-style="floating"]').isVisible(), true, 'Travel alone is not style motion.');
  await page.locator('[data-style-filter-group="visual"] [data-filter-value="light"]').click();
  assert.equal(await library.locator('[data-danmaku-style="prismatic"]').isVisible(), true, 'A style matches its secondary visual tag as well.');
  assert.equal(await library.locator('[data-danmaku-style="floating"]').isVisible(), false, 'Visual features combine with the active motion filter.');
  await page.locator('#danmakuClearStyleFilters').click();
  await page.locator('[data-style-filter-group="holiday"] [data-filter-value="true"]').click();
  assert.equal(await library.locator('[data-danmaku-style="christmas"]').isVisible(), true);
  await page.locator('[data-style-filter-group="layout"] [data-filter-value="floating"]').click();
  assert.equal(await library.locator('[data-danmaku-style]:visible').count(), 0);
  assert.equal(await page.locator('#danmakuStyleEmpty').isVisible(), true);
  await page.locator('#danmakuClearStyleFilters').click();
  await library.locator('[data-danmaku-style="bubble"]').click();
  assert.equal(await library.isVisible(), false);
  assert.deepEqual(await history('first'), [], 'Browsing and selecting do not record usage.');

  await page.waitForFunction(() => window.appearanceController.getState().saving);
  await page.evaluate(() => window.pendingSaves.at(-1).reject(new Error('Synthetic save failure')));
  await page.waitForFunction(() => !window.appearanceController.getState().saving);
  assert.deepEqual(await history('first'), [], 'A failed save does not record usage.');
  await save.click();
  await page.locator('[data-recent-danmaku-style="ripploid"]').click();
  assert.deepEqual(await recentOrder(), ['ripploid', 'bubble'], 'Returning to the applied style keeps the pending pick in second place.');
  await choose('outline');
  await choose('floating');
  await choose('cream');
  await page.locator('[data-recent-danmaku-style="cream"]').click();
  await page.evaluate(() => {
    const request = window.pendingSaves.at(-1);
    window.appearanceConfigs.first = structuredClone(request.body.config);
    request.resolve({ data: { binding: request.body.binding, config: request.body.config } });
  });
  await page.waitForFunction(() => !window.appearanceController.getState().saving);
  assert.deepEqual(await recentOrder(), ['cream', 'floating', 'outline', 'ripploid'], 'An older save cannot reorder the four most recent picks.');
  assert.equal(await page.evaluate(() => window.appearanceController.getState().draft.style), 'cream');
  assert.equal(await page.evaluate(() => window.appearanceController.getState().saved.styleOptions.signal.fontSize), 34);
  assert.deepEqual(await history('first'), ['bubble', 'ripploid'], 'Keep the newly applied style and its confirmed predecessor.');

  await page.waitForFunction(() => window.appearanceController.getState().saving);
  await page.evaluate(() => {
    window.previousAccountSave = window.appearanceController.save();
    window.activeAppearanceAccount = 'second';
    window.appearanceAccountChanged(window.appearanceSnapshot('second'));
  });
  await page.waitForFunction(() => window.appearanceController.getState().loaded);
  await page.evaluate(async () => {
    const request = window.pendingSaves.at(-1);
    request.resolve({ data: { binding: request.body.binding, config: request.body.config } });
    await window.previousAccountSave;
  });
  assert.deepEqual(await history('second'), []);
  assert.deepEqual(await history('first'), ['bubble', 'ripploid']);
  await page.locator('#danmakuAllStylesBtn').click();
  assert.deepEqual(await styleOrder(), originalOrder, 'Another account has its own favorites.');
  await page.locator('#danmakuCloseStyleLibraryBtn').click();
  assert.deepEqual(await recentOrder(), ['signal']);
  await page.evaluate(() => {
    window.activeAppearanceAccount = 'first';
    window.appearanceAccountChanged(window.appearanceSnapshot('first'));
  });
  await page.waitForFunction(() => window.appearanceController.getState().loaded);
  assert.deepEqual(await recentOrder(), ['bubble', 'ripploid']);
  const savedStyle = await page.evaluate(() => window.appearanceConfigs.first.style);
  await page.reload();
  await mount(savedStyle);
  await page.locator('#danmakuAllStylesBtn').click();
  assert.equal((await styleOrder())[0], 'cream', 'Favorites survive a page reload.');
  assert.equal(await favorite('cream').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await recentOrder(), ['bubble', 'ripploid'], 'Reload restores only applied styles, in order.');
});
