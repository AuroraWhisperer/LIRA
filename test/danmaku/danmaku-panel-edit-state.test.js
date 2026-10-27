'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

test('spooky client and cloned canvas panels share palette overrides, independent alpha and scoped restore', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    const { bindDanmakuParameters } = await import('/js/admin/danmaku-parameter-view.js');
    const { cloneComponentPanel } = await import('/js/admin/component-preview-panel.js');
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
    document.querySelectorAll('.danmaku-advanced').forEach(details => { details.open = true; });
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  assert.equal(await page.locator('#danmakuTextColorField').isVisible(), false);
  assert.equal(await page.locator('#danmakuSpookyMessageOpacity').isVisible(), true, 'alpha is available while color follows the theme');
  for (const [key, value] of [['SpookyFrameColor', '#123456'], ['SpookyMessageColor', '#234567'], ['SpookyEventColor', '#345678'], ['SpookyAccentColor', '#456789'], ['TextColor', '#fce6fa']]) {
    await page.locator(`#danmaku${key}Mode`).selectOption('custom');
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
  await page.locator('#canvas-danmakuSpookyMessageColorMode').selectOption('default');
  const options = await page.evaluate(() => window.paletteState.draft.styleOptions.spooky);
  assert.equal(Object.hasOwn(options, 'spookyMessageColor'), false);
  assert.equal(options.spookyMessageOpacity, 40);
  assert.equal(await page.locator('#danmakuSpookyMessageColorField').isVisible(), false);
  assert.equal(await alpha.isVisible(), true, 'alpha stays available after following the theme again');
  await page.locator('#canvas-danmakuSpookyResetColors').click();
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions), {
    spooky: { fontSize: 24, spookyTheme: 'moonlight', spookyFrame: 'hide' }, signal: { textColor: '#abcdef' },
  });
  assert.equal(await page.locator('#danmakuTextColorMode').inputValue(), 'default');
  assert.equal(await alpha.inputValue(), '100');
  assert.equal(await page.locator('#danmakuSpookyResetColors').isDisabled(), true);
  await page.evaluate(() => window.paletteController.edit({ style: 'signal' }));
  assert.equal(await page.locator('#danmakuSpookyColors').isVisible(), false);
  assert.equal(await page.locator('#danmakuTextColorField').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => { window.paletteBinding.dispose(); window.canvasPaletteBinding.dispose(); });
});

test('snowfox palette controls update the shared draft and restore identity colors', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    const { bindDanmakuParameters } = await import('/js/admin/danmaku-parameter-view.js');
    const listeners = new Set();
    window.paletteState = { loaded: true, draft: { style: 'snowfox', styleOptions: {}, fullscreenDurationSeconds: 6 } };
    const controller = {
      getState: () => window.paletteState,
      edit: patch => {
        Object.assign(window.paletteState.draft, patch);
        listeners.forEach(listener => listener(window.paletteState));
      },
      subscribe: listener => { listeners.add(listener); listener(window.paletteState); return () => listeners.delete(listener); },
    };
    window.paletteBinding = bindDanmakuParameters(document.body, controller, message => window.messages.push(message));
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  assert.equal(await page.locator('#danmakuBubbleColorModeField').isVisible(), true);
  assert.equal(await page.locator('#danmakuBubbleColorField').isVisible(), false);
  await page.locator('#danmakuBubbleColorMode').selectOption('custom');
  assert.equal(await page.locator('#danmakuBubbleColorField').isVisible(), true);
  await page.locator('#danmakuBubbleColor').evaluate(input => {
    input.value = '#ba739c';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await page.evaluate(() => window.paletteState.draft.styleOptions.snowfox.bubbleColor), '#ba739c');
  await page.locator('#danmakuBubbleColorMode').selectOption('default');
  assert.equal(await page.evaluate(() => window.paletteState.draft.styleOptions.snowfox.bubbleColor), 'default');
  await page.locator('#danmakuResetParameters').click();
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.snowfox), {});
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => window.paletteBinding.dispose());
});

test('RIPPLOID colors edit independently, switch styles safely and reset only their own draft', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    const { bindDanmakuParameters } = await import('/js/admin/danmaku-parameter-view.js');
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
    document.querySelector('.danmaku-advanced').open = true;
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  assert.equal(await page.locator('#danmakuBubbleColorLabel').textContent(), '聊天主色');
  assert.equal(await page.locator('#danmakuRipploidColors').isVisible(), true);
  assert.equal(await page.locator('#danmakuRipploidColors input[type="color"]').count(), 15);
  assert.equal(await page.locator('#danmakuGiftColor50').inputValue(), '#123456');
  assert.equal(await page.locator('#danmakuGiftColor0').inputValue(), '#f39749');
  for (const [id, value] of [['danmakuGiftColor50', '#a1b2c3'], ['danmakuGuardColorAdmiral', '#654321'], ['danmakuSuperchatColor2000', '#abcdef']]) {
    await page.locator(`#${id}`).evaluate((input, color) => {
      input.value = color;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid), {
    giftColor50: '#a1b2c3', guardColorAdmiral: '#654321', superchatColor2000: '#abcdef',
  });
  await page.locator('#danmakuBubbleColorMode').selectOption('custom');
  assert.equal(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid.bubbleColor), '#eb945e');
  await page.evaluate(() => window.paletteController.edit({ style: 'snowfox' }));
  assert.equal(await page.locator('#danmakuRipploidColors').isVisible(), false);
  assert.equal(await page.locator('#danmakuBubbleColorLabel').textContent(), '弹幕配色');
  await page.evaluate(() => window.paletteController.edit({ style: 'ripploid' }));
  await page.locator('#danmakuResetParameters').click();
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.ripploid), {});
  assert.deepEqual(await page.evaluate(() => window.paletteState.draft.styleOptions.snowfox), { bubbleColor: '#ba739c' });
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => window.paletteBinding.dispose());
});

test('starlight decoration selector edits once, restores saved choices and resets only its style', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    const { bindDanmakuParameters } = await import('/js/admin/danmaku-parameter-view.js');
    const listeners = new Set();
    window.shapeState = { loaded: true, draft: { style: 'starlight', styleOptions: { signal: { fontSize: 32 } }, fullscreenDurationSeconds: 6 } };
    window.shapeEdits = [];
    window.refreshShapes = () => listeners.forEach(listener => listener(window.shapeState));
    const controller = {
      getState: () => window.shapeState,
      edit: patch => { window.shapeEdits.push(patch); Object.assign(window.shapeState.draft, patch); window.refreshShapes(); },
      subscribe: listener => { listeners.add(listener); listener(window.shapeState); return () => listeners.delete(listener); },
    };
    window.shapeBinding = bindDanmakuParameters(document.body, controller, message => window.messages.push(message));
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  const select = page.locator('#danmakuDecorationShape');
  assert.equal(await select.inputValue(), 'sparkle');
  assert.deepEqual(await select.locator('option').allTextContents(), ['四角星', '爱心', '圆角方块', '五角星', '小花', '月牙', '蝴蝶结']);
  for (const shape of ['heart', 'square', 'star', 'flower', 'moon', 'bow', 'sparkle']) {
    await page.evaluate(() => { window.shapeEdits = []; });
    await select.selectOption(shape);
    assert.equal(await page.evaluate(() => window.shapeState.draft.styleOptions.starlight.decorationShape), shape);
    assert.equal(await page.evaluate(() => window.shapeEdits.length), 1);
  }
  await select.selectOption('heart');
  await page.evaluate(() => { window.shapeState.draft.style = 'signal'; window.refreshShapes(); });
  assert.equal(await page.locator('#danmakuDecorationShapeField').isVisible(), false);
  await page.evaluate(() => { window.shapeState.draft.style = 'starlight'; window.refreshShapes(); });
  assert.equal(await select.inputValue(), 'heart');
  await page.locator('#danmakuResetParameters').click();
  assert.equal(await select.inputValue(), 'sparkle');
  assert.deepEqual(await page.evaluate(() => window.shapeState.draft.styleOptions), { signal: { fontSize: 32 }, starlight: {} });
  assert.deepEqual(await page.evaluate(() => window.messages), []);
  await page.evaluate(() => window.shapeBinding.dispose());
});

test('danmaku sliders and effect fields commit once after editing and retain pending readouts', async (t) => {
  const page = await fixture(t, 'danmaku');
  await page.evaluate(async (html) => {
    document.body.innerHTML = html;
    document.getElementById('liveDanmakuFeature').hidden = false;
    const { bindDanmakuParameters } = await import('/js/admin/danmaku-parameter-view.js');
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
  }, readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));
  const entrance = page.locator('#danmakuEntranceAnimation');
  assert.deepEqual(await entrance.locator('option').allTextContents(), ['动画 1 · 渐显', '动画 2 · 上浮弹入']);
  for (const style of ['whiteframe', 'glow', 'starveil']) {
    await page.evaluate(style => { window.parameterState.draft.style = style; window.refreshParameters(); window.parameterEdits = []; }, style);
    assert.equal(await page.locator('#danmakuEntranceAnimationField').isVisible(), true);
    assert.equal(await entrance.inputValue(), 'fade');
    await entrance.evaluate(input => { input.value = 'rise'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 0);
    await entrance.dispatchEvent('change');
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
    assert.equal(await page.evaluate(style => window.parameterState.draft.styleOptions[style].entranceAnimation, style), 'rise');
  }
  await page.locator('#danmakuResetParameters').click();
  assert.equal(await entrance.inputValue(), 'fade');
  assert.deepEqual(await page.evaluate(() => window.parameterState.draft.styleOptions), {
    whiteframe: { entranceAnimation: 'rise' }, glow: { entranceAnimation: 'rise' }, starveil: {},
  });
  await page.locator('.danmaku-advanced > summary').click();
  for (const [style, id, key, value, saved] of [
    ['starveil', 'BackgroundOpacity', 'backgroundOpacity', 55, 55],
    ['starveil', 'CenterBias', 'centerBias', 30, 30],
    ['starveil', 'Dispersion', 'dispersion', 25, 25],
    ['floating', 'FloatingSpeed', 'speedPixelsPerSecond', 100, 360],
    ['floating', 'FloatingDispersion', 'floatingDispersion', 80, 80],
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
    assert.ok((await page.locator(`#danmaku${id}Value`).textContent()).startsWith(String(value)));
    await input.dispatchEvent('change');
    assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
    assert.equal(await page.evaluate(({ style, key }) => window.parameterState.draft.styleOptions[style][key], { style, key }), saved);
  }
  const color = page.locator('#danmakuTextColor');
  await color.evaluate(input => { input.value = '#abcdef'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => window.parameterEdits.length), 1);
  await color.dispatchEvent('change');
  assert.equal(await page.evaluate(() => window.parameterState.draft.styleOptions.floating.textColor), '#abcdef');

  await page.locator('[data-effect-group="shadow"] > summary').click();
  await page.locator('[data-effect-enabled="shadow"]').check();
  await page.evaluate(() => { window.parameterEdits = []; });
  const slider = page.getByRole('slider', { name: '外投影 · 模糊滑块', exact: true });
  const number = page.locator('[data-effect-field="shadow.blur"]');
  await slider.focus();
  await slider.evaluate(input => { input.value = '24'; input.dispatchEvent(new Event('input', { bubbles: true })); window.refreshParameters(); });
  assert.equal(await number.inputValue(), '24', 'paired number retains the pending slider value');
  assert.equal(await slider.inputValue(), '24');
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

test('danmaku panel initializes every shipped style and keeps existing controls working', async (t) => {
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
    window.open = (url) => window.opened.push(url);
    window.AdminApp = { utils: { toast: (message) => window.messages.push(message) } };
    window.liraLicense = {
      getState: async () => ({
        state: 'authorized',
        streamer: {
          accountName: 'synthetic',
          songPageUrl: 'https://lira-ui.test/',
        },
      }),
      getOverlaySettings: async () => ({
        ok: true,
        style: 'signal',
        fullscreenDurationSeconds: 6,
        overlayUrl: 'https://lira-ui.test/overlay/syntheticKey_123',
      }),
    };
    window.fetch = async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      window.requests.push({ url, body });
      let data;
      if (url === '/api/bilibili/danmaku/state') {
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
      } else if (url === '/api/bilibili/danmaku/send') {
        data = { message: body.message };
      } else if (url === '/api/settings') {
        data = body;
      } else {
        throw new Error(`Unexpected danmaku fetch: ${url}`);
      }
      return { ok: true, json: async () => ({ ok: true, data }) };
    };
    await import('/js/admin/danmaku-tool.js');
    window.AdminApp.danmakuTool.init();
    await window.AdminApp.danmakuTool.refresh();
  }, readAdminFragmentHtml('pages/admin/toolbox/danmaku.html') +
    readAdminFragmentHtml('pages/admin/live-components/danmaku.html'));

  assert.equal(await page.locator('#danmakuAccountState').textContent(), '测试账号');
  assert.equal(await page.locator('#danmakuRoomState').textContent(), '测试直播间');
  assert.equal(await page.locator('#danmakuToolStatus').textContent(), '可发送，监听已连接');
  await page.locator('#danmakuRefreshBtn').click();
  assert.equal(await page.evaluate(() => window.requests.length), 2);
  assert.equal(await page.locator('#danmakuAutoBtn').isEnabled(), true);
  await page.locator('#danmakuMessage').fill('测试弹幕');
  assert.equal(await page.locator('#danmakuCounter').textContent(), '4 字');
  await page.locator('#danmakuSendBtn').click();
  assert.equal(await page.locator('#danmakuMessage').inputValue(), '');
  assert.match(await page.locator('#danmakuSendResult').textContent(), /已发送：测试弹幕/);
  assert.deepEqual(
    await page.evaluate(() => window.requests.find((request) => request.url === '/api/bilibili/danmaku/send').body),
    { message: '测试弹幕' },
  );

  for (const [id, key] of [
    ['danmakuReplyToggle', 'enableRandomTagReply'],
    ['danmakuCustomReplyToggle', 'enableCustomReplyBot'],
  ]) {
    await page.locator(`#${id}`).check();
    assert.deepEqual(await page.evaluate(() => window.requests.at(-1).body), { [key]: 'true' });
  }
  for (const key of ['diy', 'welcome']) {
    const opener = page.locator(`[data-fixed-open="${key}"]`);
    await opener.click();
    assert.equal(await page.locator('[data-fixed-editor]:visible').count(), 1);
    assert.equal(await page.locator(`[data-fixed-editor="${key}"]`).isVisible(), true);
    assert.equal(await opener.getAttribute('aria-expanded'), 'true');
    await opener.click();
    assert.equal(await page.locator('[data-fixed-editor]:visible').count(), 0);
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    await opener.click();
  }
  await page.locator('#danmakuFixedEditorClose').click();
  assert.equal(await page.locator('[data-fixed-editor]:visible').count(), 0);
  assert.equal(
    await page.locator('[data-fixed-open="welcome"]').evaluate((button) => button === document.activeElement),
    true,
  );
  for (const [id, value] of [['danmakuCustomReplyList', '测试关键词']]) {
    assert.equal(await page.locator(`#${id} input`).first().inputValue(), value);
  }
  const visibleGroups = page.locator('.danmaku-style-group:visible');
  assert.equal(await visibleGroups.count(), 1);
  assert.equal(await visibleGroups.getAttribute('id'), 'danmakuFixedStyles');
  const requestCount = await page.evaluate(() => window.requests.length);
  const randomTab = page.getByRole('tab', { name: '区域随机', exact: true });
  await randomTab.click();
  assert.equal(await visibleGroups.getAttribute('id'), 'danmakuRandomStyles');
  assert.equal(await visibleGroups.locator('[data-danmaku-style]').count(), 6);
  assert.equal(await page.locator('[data-danmaku-style="signal"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#danmakuApplyOverlayBtn').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.requests.length), requestCount, 'Browsing categories must not write settings.');
  await randomTab.press('End');
  assert.equal(await visibleGroups.getAttribute('id'), 'danmakuFloatingStyles');
  await page.getByRole('tab', { name: '飘窗弹幕', exact: true }).press('ArrowRight');
  assert.equal(await visibleGroups.getAttribute('id'), 'danmakuFixedStyles');
  assert.equal(await page.locator('#danmakuFixedStyleTab').evaluate(tab => tab === document.activeElement), true);
  const styleButtons = page.locator('#liveDanmakuFeature [data-danmaku-style]');
  assert.ok(await styleButtons.count() > 0);
  for (let index = 0; index < (await styleButtons.count()); index += 1) {
    const button = styleButtons.nth(index);
    const groupId = await button.evaluate(node => node.closest('[role="tabpanel"]').id);
    await page.locator(`[aria-controls="${groupId}"]`).click();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    const style = await button.getAttribute('data-danmaku-style');
    assert.equal(await page.locator('#danmakuEntranceAnimationField').isVisible(), ['whiteframe', 'glow', 'starveil'].includes(style));
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
    await page.waitForFunction((count) => window.pendingSaves.filter((request) =>
      request.url === '/api/component-preview' && request.body.action === 'focus').length === count, index + 1);
    const focusKey = await page.evaluate(() => {
      const request = window.pendingSaves.findLast((request) => request.body.action === 'focus');
      request.resolve({ data: { focused: false } });
      return request.body.key;
    });
    assert.equal(focusKey, 'a'.repeat(22));
    await page.waitForFunction((count) => window.opened.length === count, index + 1);
    const preview = new URL(await page.evaluate(() => window.opened.at(-1)));
    assert.equal(preview.pathname, '/c');
    assert.equal(preview.search, '');
    assert.equal(preview.hash, `#${'a'.repeat(22)}`);
    assert.equal(await page.locator('.component-preview-dialog').count(), 0);
    await page.evaluate(async () => {
      const { closeComponentPreview } = await import('/js/admin/component-preview-session.js');
      closeComponentPreview();
    });
  }
  await page.locator('#danmakuDiscardOverlayBtn').click();
  assert.equal(await visibleGroups.getAttribute('id'), 'danmakuFixedStyles');
  assert.equal(await page.locator('[data-danmaku-style="signal"]').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => {
    window.liraLicense.getOverlaySettings = async () => ({ ok: true, style: 'cream', fullscreenDurationSeconds: 6,
      overlayUrl: 'https://lira-ui.test/overlay/syntheticKey_123' });
  });
  await page.locator('#danmakuReloadOverlayBtn').click();
  await page.waitForFunction(() => !document.getElementById('danmakuRandomStyles').hidden);
  assert.equal(await page.locator('[data-danmaku-style="cream"]').getAttribute('aria-pressed'), 'true');
});

const libraries = [
  {
    name: 'CustomReply',
    factory: 'createCustomReplyEditor',
    ids: ['List', 'Count', 'AddBtn', 'SaveBtn', 'Status'],
    extraIds: ['danmakuCustomKeywordInput', 'danmakuCustomReplyInput'],
    initial: [
      { keyword: 'A', reply: 'reply', enabled: true },
      { keyword: 'second', reply: 'reply', enabled: true },
    ],
    key: 'customReplyRules',
  },
];

for (const library of libraries) {
  for (const result of [
    'success-edit',
    'failure-edit',
    'failure-unchanged',
    'success-unchanged',
    'success-revert',
    'success-add',
    'success-remove',
  ]) {
    test(`${library.name} save ${result} keeps the edit state consistent`, async (t) => {
      const page = await fixture(t, 'libraries');
      await page.evaluate(async (library) => {
        const ids = library.ids.map((suffix) => `danmaku${library.name}${suffix}`).concat(library.extraIds || []);
        for (const id of ids) {
          const node = document.createElement(/Btn$/.test(id) ? 'button' : /Input$/.test(id) ? 'input' : 'div');
          node.id = id;
          document.body.append(node);
        }
        const module = await import('/js/admin/danmaku-libraries.js');
        window.editor = module[library.factory]({
          document,
          saveSetting: window.saveSetting,
          toast: (message) => window.messages.push(message),
        });
        window.editor.load(JSON.stringify(library.initial));
        window.list = document.getElementById(`danmaku${library.name}List`);
        window.saveButton = document.getElementById(`danmaku${library.name}SaveBtn`);
        window.statusNode = document.getElementById(`danmaku${library.name}Status`);
        window.edit = (value) => {
          const input = window.list.querySelector('input');
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        window.edit(' A ');
        window.saveButton.click();
      }, library);
      await page.evaluate(
        ({ library, result }) => {
          if (result.endsWith('-edit') || result === 'success-revert') {
            window.edit('B');
            if (result === 'success-revert') window.edit(' A ');
          } else if (result === 'success-add') {
            for (const input of document.querySelectorAll('body > input')) input.value = 'new';
            document.getElementById(`danmaku${library.name}AddBtn`).click();
          } else if (result === 'success-remove') {
            window.list.lastElementChild.querySelector('button').click();
          }
        },
        { library, result },
      );
      assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
      assert.equal(await page.evaluate(() => window.saveButton.disabled), true);
      await page.evaluate(() => window.saveButton.dispatchEvent(new Event('click')));
      assert.equal(await page.evaluate(() => window.pendingSaves.length), 1);
      assert.equal(await page.evaluate(() => window.pendingSaves[0].key), library.key);
      await page.evaluate((result) => {
        if (result.startsWith('failure-')) window.pendingSaves[0].reject(new Error('synthetic failure'));
        else window.pendingSaves[0].resolve();
      }, result);
      const dirty = result !== 'success-unchanged';
      assert.equal(await page.evaluate(() => window.saveButton.disabled), !dirty);
      assert.equal(
        await page.evaluate(() => window.list.querySelector('input').value),
        result.endsWith('-edit') ? 'B' : result === 'success-unchanged' ? 'A' : ' A ',
      );
      assert.equal(
        await page.evaluate(() => window.list.children.length),
        result === 'success-add' ? 3 : result === 'success-remove' ? 1 : 2,
      );
      if (dirty) {
        const before = await page.evaluate(() => window.list.innerHTML);
        await page.evaluate((initial) => window.editor.load(JSON.stringify(initial)), library.initial);
        assert.equal(await page.evaluate(() => window.list.innerHTML), before);
        await page.evaluate(() => window.saveButton.click());
        assert.equal(await page.evaluate(() => window.pendingSaves.length), 2);
        const saved = await page.evaluate(() => JSON.parse(window.pendingSaves[1].value));
        const first = typeof saved[0] === 'string' ? saved[0] : (saved[0].level ?? saved[0].keyword);
        assert.equal(first, result.endsWith('-edit') ? 'B' : 'A');
        assert.equal(saved.length, result === 'success-add' ? 3 : result === 'success-remove' ? 1 : 2);
        await page.evaluate(() => window.pendingSaves[1].resolve());
        assert.equal(await page.evaluate(() => window.saveButton.disabled), true);
      }
    });
  }
}
