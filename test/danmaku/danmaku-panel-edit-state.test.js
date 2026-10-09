'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

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
      getProfile: async () => ({
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
  for (const key of ['random', 'diy', 'welcome', 'pk']) {
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
    await page.locator('[data-fixed-open="pk"]').evaluate((button) => button === document.activeElement),
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
  assert.equal(await visibleGroups.locator('[data-danmaku-style]').count(), 5);
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
