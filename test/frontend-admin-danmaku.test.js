'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');
const { createUiFixture } = require('./helpers/ui-edit-state-fixture');

const browserFixture = createUiFixture();

const ROOT_DIR = path.join(__dirname, '..');

test('admin danmaku input has no fixed character limit', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );

  assert.doesNotMatch(html, /id="danmakuMessage"[^>]*maxlength=/);
  assert.match(html, /id="danmakuCounter"[^>]*>0 字</);
  assert.doesNotMatch(source, /enableCheckinBot/);
  assert.doesNotMatch(source, /enableFortuneBot/);
  assert.doesNotMatch(source, /mentionRequester: toggle\.checked/);
  assert.match(html, /随机点歌回复/);
  assert.match(html, /点歌未匹配时，会自动回复点歌人/);
  assert.match(html, /id="danmakuReplyToggle"[^>]*aria-labelledby="danmakuReplyTitle"/);
  assert.match(html, /签到机器人/);
  assert.match(html, /收到“签到”后回复累计天数/);
  assert.match(html, /id="danmakuCheckinToggle"[^>]*aria-labelledby="danmakuCheckinTitle"/);
  assert.match(html, /抽签机器人/);
  assert.match(html, /收到“抽签”后回复每日一签/);
  assert.match(html, /id="danmakuFortuneToggle"[^>]*aria-labelledby="danmakuFortuneTitle"/);
  assert.match(html, /自定义关键词回复/);
  assert.match(html, /收到自定义关键词后回复固定文案/);
  assert.match(html, /id="danmakuCustomReplyToggle"[^>]*aria-labelledby="danmakuCustomReplyTitle"/);
  assert.doesNotMatch(html, /id="danmaku(?:Blessings|Fortunes)Panel"/);
  assert.doesNotMatch(source, /createBlessingEditor|createFortuneEditor|checkinToggle|fortuneToggle/);
  assert.match(source, /initDanmakuDailyBots/);
  assert.doesNotMatch(html, /id="dailyBotTakeover"/);
  assert.match(html, /id="dailyBotRefresh"/);
});

test('danmaku tool separates the fixed live overlay from the sender and reply groups', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const connectionSection =
    html.match(
      /<section\b[^>]*class="danmaku-feature-section danmaku-connection-section"[^>]*>[\s\S]*?<\/section>/,
    )?.[0] || '';
  const headingHtml = html.replace(
    /<svg\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/g,
    '',
  );

  assert.doesNotMatch(html, /class="danmaku-tool-heading"/);
  assert.match(connectionSection, /id="danmakuConnectionTitle"/);
  assert.match(connectionSection, /id="danmakuRefreshBtn"/);
  assert.match(headingHtml, /id="danmakuStyleTitle">\s*弹幕姬\s*<lira-help/);
  assert.match(html, /id="danmakuOverlayUrl"/);
  assert.match(html, /id="danmakuCopyOverlayUrlBtn"/);
  assert.match(html, /id="danmakuOpenOverlayBtn"/);
  assert.match(
    html,
    /id="danmakuPreviewOverlayBtn"[^>]*>\s*预览效果\s*<\/button>/,
  );
  const styleOptions = Array.from(
    html.matchAll(
      /<button\b[^>]*data-danmaku-style="([^"]+)"[^>]*>[\s\S]*?<span class="danmaku-style-name">([^<]+)<\/span>[\s\S]*?<\/button>/g,
    ),
    ([, style, label]) => [style, label.trim()],
  );
  assert.deepEqual(styleOptions, [
    ['bubble', '聊天气泡'],
    ['signal', '深色面板'],
    ['minimal', '蝴蝶结'],
    ['ranked', '经典样式'],
    ['transparent', '透明文字'],
    ['identity', '头像横卡'],
    ['outline', '简洁白卡'],
    ['cream', '奶油气泡'],
    ['glow', '流光气泡'],
  ]);
  assert.match(html, /data-danmaku-style="signal"[^>]+aria-pressed="true"/);
  assert.match(
    html,
    /class="danmaku-style-group danmaku-style-group-fixed"[^>]+aria-labelledby="danmakuFixedStyleTitle"[\s\S]*id="danmakuFixedStyleTitle">固定位置弹幕<[\s\S]*aria-label="选择固定位置弹幕样式"/,
  );
  assert.match(
    html,
    /class="danmaku-style-group danmaku-style-group-random"[^>]+aria-labelledby="danmakuRandomStyleTitle"[\s\S]*id="danmakuRandomStyleTitle">全屏随机弹幕<[\s\S]*aria-label="选择全屏随机弹幕样式"/,
  );
  assert.doesNotMatch(html, /danmaku-style-option-(?:visual|copy)/);
  assert.match(
    html,
    /id="danmakuStyleSaveState"[^>]+role="status"[^>]+aria-live="polite"[^>]*><\/p>/,
  );
  assert.match(
    html,
    /id="danmakuFullscreenDurationSeconds"[^>]+type="number"[^>]+min="2"[^>]+max="30"[^>]+step="1"/,
  );
  assert.match(html, /id="danmakuFullscreenDurationField"[^>]+hidden/);
  assert.doesNotMatch(html, /id="danmakuStylePreview(?:Frame)?"/);
  const styleSectionStart = html.indexOf(
    'class="danmaku-feature-section danmaku-style-section"',
  );
  const composeSectionStart = html.indexOf(
    'class="danmaku-feature-section danmaku-compose-section"',
  );
  const styleSectionEnd = html.indexOf('</section>', styleSectionStart);
  assert.ok(styleSectionStart >= 0 && styleSectionEnd < composeSectionStart);
  assert.ok(
    html.indexOf('id="danmakuStyleTitle"') <
      html.indexOf('id="xiaomiAiSection"'),
  );
  assert.ok(
    html.indexOf('id="xiaomiAiSection"') <
      html.indexOf('id="danmakuFixedReplyTitle"'),
  );
  assert.match(headingHtml, /id="danmakuFixedReplyTitle">\s*固定回复\s*<\/h3>/);
  assert.doesNotMatch(html, /id="danmakuSongReplySectionTitle"/);
  const fixedReplySectionStart = html.indexOf(
    'class="danmaku-feature-section danmaku-fixed-reply-section"',
  );
  const fixedReplySectionEnd = html.indexOf(
    '</section>',
    fixedReplySectionStart,
  );
  assert.ok(fixedReplySectionStart < html.indexOf('id="danmakuReplyTitle"'));
  assert.ok(html.indexOf('id="danmakuReplyTitle"') < fixedReplySectionEnd);
  assert.doesNotMatch(source, /createDanmakuFeed/);
  assert.match(source, /initDanmakuOverlaySettings/);
  assert.doesNotMatch(source, /localOverlayOrigin/);
  assert.doesNotMatch(source, /saveSetting\('danmakuOverlayStyle'/);
  assert.match(html, /id="danmakuApplyOverlayBtn"/);
  assert.match(html, /id="danmakuReloadOverlayBtn"/);
  const overlaySource = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin/danmaku-overlay-settings.js'), 'utf8');
  assert.match(overlaySource, /observeServerOverlayUrl/);
  assert.match(overlaySource, /bridge\.updateOverlaySettings/);
  assert.match(overlaySource, /preview: '1'/);
  assert.match(styles, /\.danmaku-style-options/);
  assert.match(
    styles,
    /\.danmaku-style-picker\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(220px, 1fr\);/s,
  );
  assert.match(
    styles,
    /\.danmaku-style-options-fixed\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s,
  );
  assert.match(
    styles,
    /@container danmaku-style-picker \(max-width: 800px\)[\s\S]*\.danmaku-style-group\s*\{[^}]*grid-column:\s*1 \/ -1;/,
  );
  assert.doesNotMatch(styles, /\.danmaku-style-option-visual/);
  assert.match(
    styles,
    /\.danmaku-style-save-state:empty\s*\{\s*display:\s*none;/,
  );
  assert.match(styles, /\.danmaku-style-option\[aria-pressed='true'\]/);
  assert.doesNotMatch(styles, /\.danmaku-style-preview/);
  assert.match(
    html,
    /class="danmaku-feature-section danmaku-connection-section"[\s\S]*?id="danmakuAccountState"[\s\S]*?id="danmakuRoomState"[\s\S]*?id="danmakuToolStatus"/,
  );
  assert.match(
    html,
    /class="danmaku-feature-section danmaku-compose-section"[\s\S]*?id="danmakuSendForm"[\s\S]*?id="danmakuSendResult"/,
  );
  assert.match(
    html,
    /id="danmakuCounter"[\s\S]*?id="danmakuAutoBtn"[\s\S]*?id="danmakuSendBtn"/,
  );
  assert.match(
    styles,
    /\.danmaku-tool-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/,
  );
  assert.match(
    styles,
    /\.danmaku-bot-switch-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /#danmakuSendForm \.form-actions-row > \.hint\s*\{[^}]*margin-right:\s*auto/,
  );
  assert.match(
    styles,
    /@media \(max-width: 600px\)[\s\S]*?\.danmaku-bot-switch-grid\s*\{\s*grid-template-columns:\s*1fr;/,
  );
});

async function createDanmakuPage(t, state = {}) {
  const page = await browserFixture(t, 'danmaku');
  await page.evaluate(
    async ({ html, state }) => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      document.body.append(parsed.getElementById('otherAssistantPage'));
      for (const id of [
        'bilibiliAuthStatus',
        'bilibiliAuthProfile',
        'bilibiliAuthAvatar',
        'bilibiliAuthName',
        'bilibiliAuthUid',
        'bilibiliLoginBtn',
        'bilibiliLogoutBtn',
      ]) {
        document.body.append(parsed.getElementById(id));
      }
      document.getElementById('otherDanmakuFeature').hidden = false;
      window.danmakuState = {
        loggedIn: true,
        accountUid: 123,
        accountName: '测试账号',
        roomId: 456,
        roomName: '测试直播间',
        canSend: true,
        connected: true,
        ...state,
      };
      window.danmakuRequests = [];
      window.reconnects = 0;
      window.AdminApp = {
        utils: { toast() {} },
        settings: {
          async reconnectBilibili() {
            window.reconnects++;
            window.danmakuState.connected = true;
          },
        },
      };
      window.fetch = async (url) => {
        if (url !== '/api/bilibili/danmaku/state')
          throw new Error(`Unexpected danmaku request: ${url}`);
        window.danmakuRequests.push(url);
        return {
          ok: true,
          json: async () => ({ ok: true, data: window.danmakuState }),
        };
      };
      await import('/js/admin/danmaku-tool.js');
      window.AdminApp.danmakuTool.init({
        reconnectBilibili: window.AdminApp.settings.reconnectBilibili,
        toast() {},
      });
      await window.AdminApp.danmakuTool.refresh();
    },
    { html: readAdminHtml(), state },
  );
  return page;
}

test('danmaku character counter counts Chinese and emoji as code points', async (t) => {
  const page = await createDanmakuPage(t);
  await page.locator('#danmakuMessage').fill('中文🙂');
  assert.equal(await page.locator('#danmakuCounter').textContent(), '3 字');
});

for (const scenario of [
  {
    name: 'display names',
    state: {},
    account: '测试账号',
    room: '测试直播间',
    accountTitle: 'UID 123',
    roomTitle: '房间 456',
  },
  {
    name: 'identity fallbacks',
    state: { accountName: '', roomName: '' },
    account: 'UID 123',
    room: '房间 456',
    accountTitle: 'UID 123',
    roomTitle: '房间 456',
  },
  {
    name: 'missing login and room',
    state: { loggedIn: false, roomId: null },
    account: '未登录',
    room: '未设置',
    accountTitle: '',
    roomTitle: '',
  },
]) {
  test(`danmaku status renders ${scenario.name}`, async (t) => {
    const page = await createDanmakuPage(t, scenario.state);
    assert.equal(
      await page.locator('#danmakuAccountState').textContent(),
      scenario.account,
    );
    assert.equal(
      await page.locator('#danmakuRoomState').textContent(),
      scenario.room,
    );
    assert.equal(
      await page.locator('#danmakuAccountState').getAttribute('title'),
      scenario.accountTitle,
    );
    assert.equal(
      await page.locator('#danmakuRoomState').getAttribute('title'),
      scenario.roomTitle,
    );
  });
}

test('successful Bilibili login refreshes danmaku once and enables sending', async (t) => {
  const page = await createDanmakuPage(t, { loggedIn: false, canSend: false });
  assert.equal(await page.locator('#danmakuSendBtn').isEnabled(), false);
  await page.evaluate(async () => {
    const { initBilibiliAuth } = await import('/js/admin/settings-auth.js');
    window.bilibiliAuth = {
      getAuthState: async () => ({
        loggedIn: window.danmakuState.loggedIn,
        uid: 123,
      }),
      async login() {
        Object.assign(window.danmakuState, { loggedIn: true, canSend: true });
        return { state: { loggedIn: true } };
      },
    };
    initBilibiliAuth({
      documentRef: document,
      windowRef: window,
      toast() {},
      logoutConfirm: async () => false,
    });
  });
  await page.locator('#bilibiliLoginBtn').click();
  await page.waitForFunction(
    () => !document.getElementById('danmakuSendBtn').disabled,
    null,
    { timeout: 2000 },
  );
  assert.equal(
    await page.locator('#danmakuAccountState').textContent(),
    '测试账号',
  );
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 2);
});

test('opening a disconnected danmaku panel reconnects once and renders the refreshed state', async (t) => {
  const page = await createDanmakuPage(t, { connected: false });
  assert.equal(
    await page.locator('#danmakuToolStatus').textContent(),
    '可发送，监听未连接',
  );
  assert.equal(
    await page.locator('#danmakuToolStatus').getAttribute('class'),
    'connection-bad',
  );
  await page.evaluate(async () => {
    window.localStorage.setItem(
      'admin.toolboxSelectedFeature',
      'otherPerformanceFeature',
    );
    await import('/js/admin/other.js');
    window.AdminApp.other.initOtherPage();
    window.AdminApp.other.selectFeatureById('otherDanmakuFeature');
  });
  await page.waitForFunction(
    () =>
      document.getElementById('danmakuToolStatus').className ===
      'connection-good',
    null,
    { timeout: 2000 },
  );
  assert.equal(
    await page.locator('#danmakuToolStatus').textContent(),
    '可发送，监听已连接',
  );
  assert.equal(await page.evaluate(() => window.reconnects), 1);
  assert.equal(await page.evaluate(() => window.danmakuRequests.length), 3);
  await page.evaluate(() =>
    window.AdminApp.other.selectFeatureById('otherDanmakuFeature'),
  );
  await page.waitForFunction(() => window.danmakuRequests.length === 4, null, {
    timeout: 2000,
  });
  assert.equal(await page.evaluate(() => window.reconnects), 1);
});

test('danmaku tool mounts the AI assistant after the sender and before fixed replies', () => {
  const html = readAdminHtml();
  const indexSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public/js/admin/app.js'),
    'utf8',
  );
  assert.ok(
    html.indexOf('id="xiaomiAiSection"') > html.indexOf('id="danmakuSendForm"'),
  );
  assert.ok(
    html.indexOf('id="xiaomiAiSection"') <
      html.indexOf('id="danmakuCustomRepliesPanel"'),
  );
  assert.match(indexSource, /import \{ aiAssistantSettings \} from ["']\.\/ai-assistant-settings\.js["'];/);
});
