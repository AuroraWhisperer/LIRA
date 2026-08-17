'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  createLyricToggleButton,
  loadModuleExports,
  response
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('admin page uses one ordered module entrypoint', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/admin\/index\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  const giftModulePaths = [
    './gifts/notification.js',
    './gifts/detection.js',
    './gifts/sprint.js',
    './gifts/recent.js',
    './gifts/blindbox.js',
    './gifts/blindbox-analysis.js',
    './gifts/history.js'
  ];
  const giftIndexPosition = entrySource.indexOf("import './gifts/index.js';");
  assert.ok(giftIndexPosition > -1, 'gift index import should remain present');
  for (const modulePath of giftModulePaths) {
    const modulePosition = entrySource.indexOf(`import '${modulePath}';`);
    assert.ok(modulePosition > -1, `${modulePath} import should remain present`);
    assert.ok(modulePosition < giftIndexPosition, `${modulePath} should load before the gift index`);
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('parameter ranges use the shared sky-blue component without changing playback controls', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'parameter-range.css'), 'utf8');
  const { getParameterRangeProgress } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js')
  );

  assert.equal(getParameterRangeProgress({ min: '0', max: '100', value: '25' }), 25);
  assert.equal(getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }), 50);
  for (const id of [
    'queueScrollSpeedRange', 'queueSongFontSize', 'queueTitleFontSize',
    'themeOpacity', 'backdropBlur', 'glowIntensity', 'identityQueueFontSize',
    'identityQueueScrollSpeedRange', 'overlayRuleFontSize', 'scrollSecondsRange',
    'songBoardFontSize', 'songBoardSongFontSize', 'songBoardTitleFontSize',
    'songBoardBackdropBlur', 'songBoardGlowIntensity', 'songBoardThemeOpacity',
    'desktopLyricFontSize', 'desktopLyricStrokeWidth', 'desktopLyricOpacity',
    'desktopLyricBgOpacity', 'desktopLyricScale', 'desktopLyricLineHeight',
    'desktopLyricShadowIntensity', 'desktopLyricTranslationScale', 'weSingLyricOffsetMs'
  ]) {
    assert.match(html, new RegExp(`id="${id}" class="parameter-range" type="range"`));
  }
  assert.doesNotMatch(html, /id="playbackSeek" class="parameter-range"/);
  assert.doesNotMatch(html, /id="playbackVolume" class="[^\"]*parameter-range/);
  assert.match(styles, /\.parameter-range\[type="range"\]/);
  assert.match(styles, /#43c7ff/);
  assert.match(styles, /#bdebff/);
});

test('admin form refresh does not overwrite the field currently being edited', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), 'utf8');

  assert.match(source, /if \(element && element !== document\.activeElement\) element\.value = inputValue;/);
});

test('admin danmaku input has no fixed character limit', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');
  const libraries = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-libraries.js'), 'utf8');

  assert.doesNotMatch(html, /id="danmakuMessage"[^>]*maxlength=/);
  assert.match(html, /id="danmakuCounter"[^>]*>0 字</);
  assert.match(source, /Array\.from\(elements\.message\.value\)\.length/);
  assert.match(source, /enableRandomTagReply/);
  assert.match(source, /enableCheckinBot/);
  assert.match(source, /enableFortuneBot/);
  assert.match(source, /enableCustomReplyBot/);
  assert.doesNotMatch(source, /mentionRequester: toggle\.checked/);
  assert.match(html, /随机点歌回复/);
  assert.match(html, /条件不匹配时，自动回复点歌人/);
  assert.match(html, /启用回复/);
  assert.match(html, /签到机器人/);
  assert.match(html, /收到“签到”弹幕后回复累计天数/);
  assert.match(html, /启用签到/);
  assert.match(html, /抽签机器人/);
  assert.match(html, /收到“抽签”弹幕后回复每日一签/);
  assert.match(html, /启用抽签/);
  assert.match(html, /DIY 关键词回复/);
  assert.match(html, /收到自定义关键词后回复固定文案/);
  assert.match(html, /启用 DIY/);
  assert.match(html, /<details id="danmakuBlessingsPanel" class="danmaku-blessings-section">/);
  assert.match(html, /id="danmakuBlessingList"/);
  assert.match(html, /id="danmakuBlessingAddBtn"/);
  assert.match(html, /id="danmakuBlessingSaveBtn"/);
  assert.match(source, /createBlessingEditor/);
  assert.match(source, /createFortuneEditor/);
  assert.match(source, /createCustomReplyEditor/);
  assert.doesNotMatch(source, /items\.splice\(index, 1\)/);
  assert.match(libraries, /saveSetting\('checkinBlessings', JSON\.stringify\(cleaned\)\)/);
  assert.match(libraries, /items\.splice\(index, 1\)/);
  assert.ok(html.indexOf('id="danmakuComposeTitle"') < html.indexOf('id="danmakuBlessingsPanel"'));
  assert.ok(html.indexOf('id="danmakuComposeTitle"') < html.indexOf('id="danmakuCustomRepliesPanel"'));
  assert.ok(html.indexOf('id="danmakuCustomRepliesPanel"') < html.indexOf('id="danmakuBlessingsPanel"'));
  assert.ok(html.indexOf('id="danmakuBlessingsPanel"') < html.indexOf('id="danmakuFortunesPanel"'));
  assert.match(html, /id="danmakuFortuneList"/);
  assert.match(html, /id="danmakuFortuneAddBtn"/);
  assert.match(html, /id="danmakuFortuneSaveBtn"/);
  assert.match(source, /fortuneEditor\.load\(state\.fortunePool\)/);
  assert.match(source, /customReplyEditor\.load\(state\.customReplyRules\)/);
  assert.match(libraries, /saveSetting\('fortunePool', JSON\.stringify\(cleaned\)\)/);
  assert.match(libraries, /saveSetting\('customReplyRules', JSON\.stringify\(cleaned\)\)/);
  assert.match(libraries, /export function createFortuneEditor/);
  assert.match(libraries, /export function createCustomReplyEditor/);
});

test('admin danmaku status prefers account and room display names', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');

  assert.match(source, /state\.accountName \|\| `UID \$\{state\.accountUid \|\| '-'\}`/);
  assert.match(source, /state\.roomName \|\| `房间 \$\{state\.roomId\}`/);
  assert.match(source, /accountState\.title = state\.loggedIn && state\.accountUid \? `UID \$\{state\.accountUid\}` : '';/);
  assert.match(source, /roomState\.title = state\.roomId \? `房间 \$\{state\.roomId\}` : '';/);
});

test('successful Bilibili login refreshes the danmaku tool automatically', () => {
  const settingsSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings.js'), 'utf8');
  const toolSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');

  assert.match(
    settingsSource,
    /if \(result\.state\.loggedIn\) \{[\s\S]*?document\.dispatchEvent\(new CustomEvent\('app:bilibili-auth-changed'\)\)/
  );
  assert.match(
    toolSource,
    /document\.addEventListener\('app:bilibili-auth-changed', \(\) => refreshState\(\)\)/
  );
});

test('opening disconnected danmaku tool refreshes live once and distinguishes connection states', () => {
  const toolSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'), 'utf8');
  const navigationSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(navigationSource, /refresh\(\{ reconnectIfDisconnected: true \}\)/);
  assert.match(toolSource, /if \(reconnectIfDisconnected && !state\.connected\) \{[\s\S]*?reconnectBilibili/);
  assert.match(toolSource, /state\.connected \? 'connection-good' : 'connection-bad'/);
  assert.match(styles, /strong\.connection-good\s*\{/);
  assert.match(styles, /strong\.connection-bad\s*\{/);
  assert.match(styles, /strong\.connection-good::before/);
  assert.match(styles, /strong\.connection-bad::before/);
});

test('danmaku tool places the AI interaction assistant after the manual sender with safe defaults', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'ai-assistant-settings.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.ok(html.indexOf('id="xiaomiAiSection"') > html.indexOf('id="danmakuSendForm"'));
  assert.ok(html.indexOf('id="xiaomiAiSection"') < html.indexOf('id="danmakuCustomRepliesPanel"'));
  assert.match(html, /id="xiaomiAiTitle">AI 互动助手</);
  assert.match(html, /按昵称响应直播间弹幕，并通过已配置的模型服务生成回复/);
  assert.match(html, /Responses API 兼容/);
  assert.match(html, /支持 DeepSeek、OpenAI 等官方服务/);
  assert.match(html, /id="xiaomiAiEnabled"[^>]*checked/);
  assert.match(html, /id="xiaomiAiModelState">未配置</);
  assert.match(html, /id="xiaomiAiModel"[^>]*list="xiaomiAiModelOptions"[^>]*placeholder="填写模型 ID"/);
  assert.doesNotMatch(html, /id="xiaomiAiModel"[^>]*value=/);
  assert.match(html, /id="xiaomiAiFetchModelsBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiQWeatherTestBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiAmapTestBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiModelOptions"/);
  assert.match(html, /id="xiaomiAiWebSearch"[^>]*checked/);
  assert.match(html, /id="xiaomiAiReasoning"[^>]*type="checkbox"(?![^>]*checked)/);
  assert.match(html, /id="xiaomiAiReplyMaxChars"[^>]*value="50"/);
  assert.match(html, /id="xiaomiAiReplyMaxChars"[^>]*min="10"[^>]*max="50"/);
  assert.match(html, /回复长度偏好/);
  assert.match(html, /优先一条，信息较多时两条，确有必要才三条/);
  assert.match(html, /不同回复随机 500–2000 毫秒；同一回复分段随机 500–1000 毫秒/);
  assert.match(html, /id="xiaomiAiUserCooldown"[^>]*min="0"[^>]*value="0"/);
  assert.doesNotMatch(html, /id="xiaomiAiSendInterval"/);
  assert.doesNotMatch(source, /sendIntervalMs: \['xiaomiAiSendInterval'/);
  assert.match(html, /id="xiaomiAiDeepSeekUrl"[^>]*placeholder="例如：https:\/\/api\.openai\.com\/v1\/responses"/);
  assert.match(html, /id="xiaomiAiDeepSeekKey"[^>]*type="text"/);
  assert.match(html, /id="xiaomiAiQWeatherKey"[^>]*type="text"/);
  assert.match(html, /id="xiaomiAiAmapKey"[^>]*type="text"/);
  assert.match(html, /id="xiaomiAiTrigger"[^>]*placeholder="例如：小米"/);
  assert.doesNotMatch(html, /id="xiaomiAiTrigger"[^>]*value="小米"/);
  assert.match(html, /id="xiaomiAiTestBtn"[^>]*>测试模型服务</);
  assert.match(html, /id="xiaomiAiQWeatherHost"[^>]*type="text"[^>]*placeholder="nn7mdbwku9\.re\.qweatherapi\.com"/);
  assert.match(html, /<details class="xiaomi-ai-collapsible">[\s\S]*?扩展能力/);
  assert.match(html, /<details class="xiaomi-ai-collapsible xiaomi-ai-advanced">[\s\S]*?高级设置/);
  assert.match(html, /id="xiaomiAiSaveBtn"[^>]*type="submit"[^>]*>保存配置</);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{8,}/);
  assert.match(indexSource, /import '\.\/ai-assistant-settings\.js';/);
  assert.match(source, /element\.textContent = text/);
  assert.match(source, /const AUTOSAVE_DELAY_MS = 700/);
  assert.match(source, /form\.addEventListener\('input'/);
  assert.match(source, /form\.addEventListener\('change'/);
  assert.match(source, /enabledInput\.addEventListener\('change'/);
  assert.match(source, /deepseekApiKey: \['xiaomiAiDeepSeekKey', 'value'\]/);
  assert.match(source, /qweatherApiKey: \['xiaomiAiQWeatherKey', 'value'\]/);
  assert.match(source, /amapApiKey: \['xiaomiAiAmapKey', 'value'\]/);
  assert.match(source, /config\.model \|\| '未配置'/);
  assert.match(source, /if \(saving\) \{[\s\S]*?pendingSave = true/);
  assert.match(source, /if \(value && value !== '\*\*\*\*\*\*\*\*'\)/);
  assert.match(source, /element\.type = 'password'/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.match(styles, /\.xiaomi-ai-section\s*\{/);
  assert.match(styles, /\.xiaomi-ai-integration-grid\s*\{/);
  assert.match(styles, /\.xiaomi-ai-test-actions\s*\{/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});

test('AI assistant autosaves toggles immediately and text after a debounce', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'ai-assistant-settings.js'), 'utf8');
  const listeners = new Map();
  const fetchCalls = [];
  const timers = [];
  const values = {
    xiaomiAiEnabled: false,
    xiaomiAiTrigger: '小米',
    xiaomiAiDeepSeekUrl: '',
    xiaomiAiModel: 'deepseek-v4-flash',
    xiaomiAiWebSearch: true,
    xiaomiAiReasoning: false,
    xiaomiAiQWeatherHost: '',
    xiaomiAiAmapHost: '',
    xiaomiAiReplyMaxChars: '50',
    xiaomiAiConcurrency: '3',
    xiaomiAiUserCooldown: '0',
    xiaomiAiRoomLimit: '20',
    xiaomiAiSystemPrompt: '',
    xiaomiAiDeepSeekKey: '',
    xiaomiAiQWeatherKey: '',
    xiaomiAiAmapKey: ''
  };
  const elements = new Map(Object.entries(values).map(([id, value]) => [id, {
    id,
    value: typeof value === 'boolean' ? '' : value,
    checked: value === true,
    textContent: '',
    className: '',
    disabled: false,
    attributes: {},
    setAttribute(name, attributeValue) { this.attributes[name] = attributeValue; },
    addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); }
  }]));
  for (const id of [
    'xiaomiAiSaveState', 'xiaomiAiTestBtn', 'xiaomiAiQWeatherTestBtn', 'xiaomiAiAmapTestBtn',
    'xiaomiAiFetchModelsBtn', 'xiaomiAiDeepSeekKeyHint',
    'xiaomiAiQWeatherKeyHint', 'xiaomiAiAmapKeyHint', 'xiaomiAiConfigState',
    'xiaomiAiModelState', 'xiaomiAiQueueState', 'xiaomiAiModelFetchState'
  ]) {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', checked: false, textContent: '', className: '', disabled: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); }
    });
  }
  elements.set('xiaomiAiModelOptions', {
    children: [],
    replaceChildren(...children) { this.children = children; }
  });
  elements.set('xiaomiAiModelMenu', {
    hidden: true,
    children: [],
    replaceChildren(...children) { this.children = children; }
  });
  const form = {
    checkValidity: () => true,
    reportValidity: () => true,
    addEventListener(type, handler) { listeners.set(`form:${type}`, handler); }
  };
  elements.set('xiaomiAiForm', form);

  const publicConfig = {
    enabled: false,
    trigger: '小米',
    deepseekResponsesUrl: 'https://api.example.com/responses',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    reasoningEnabled: false,
    qweatherApiHost: '',
    amapApiHost: '',
    replyMaxChars: 50,
    generationConcurrency: 3,
    sendIntervalMs: 3000,
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: false,
    hasAmapApiKey: false
  };
  let resolveInitialConfig;
  const initialConfigResponse = new Promise((resolve) => { resolveInitialConfig = resolve; });
  const sandbox = {
    console,
    document: {
      getElementById: id => elements.get(id),
      createElement: tagName => ({
        tagName,
        value: '',
        textContent: '',
        className: '',
        attributes: {},
        listeners: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, handler) { this.listeners[type] = handler; }
      })
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (url === '/api/ai/config' && !options.method) return initialConfigResponse;
      if (url === '/api/ai/models') {
        return { ok: true, json: async () => ({ ok: true, data: { models: ['deepseek-v4-flash', 'deepseek-v4-pro'] } }) };
      }
      if (url === '/api/ai/test/deepseek') {
        return { ok: true, json: async () => ({
          ok: true,
          data: {
            provider: 'deepseek', model: 'deepseek-chat', reply: '你好！有什么可以帮你？', endpointAdapted: true
          }
        }) };
      }
      const data = url === '/api/ai/status' ? { queued: 0 } : publicConfig;
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
    setTimeout: handler => { timers.push(handler); return timers.length; },
    clearTimeout() {},
    window: { AdminApp: { utils: { showStackedToast(options) { fetchCalls.push({ toast: options }); } } } }
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.aiAssistantSettings.init();

  elements.get('xiaomiAiDeepSeekUrl').value = 'https://api.deepseek.com/responses';
  listeners.get('form:input')({ target: { id: 'xiaomiAiDeepSeekUrl', matches: () => false } });
  elements.get('xiaomiAiDeepSeekKey').value = 'deepseek-secret';
  listeners.get('form:input')({ target: { id: 'xiaomiAiDeepSeekKey', matches: () => false } });
  elements.get('xiaomiAiQWeatherHost').value = 'nn7mdbwku9.re.qweatherapi.com';
  listeners.get('form:input')({ target: { id: 'xiaomiAiQWeatherHost', matches: () => false } });
  elements.get('xiaomiAiQWeatherKey').value = 'qweather-secret';
  listeners.get('form:input')({ target: { id: 'xiaomiAiQWeatherKey', matches: () => false } });
  elements.get('xiaomiAiAmapHost').value = 'https://restapi.amap.com';
  listeners.get('form:input')({ target: { id: 'xiaomiAiAmapHost', matches: () => false } });
  elements.get('xiaomiAiAmapKey').value = 'amap-secret';
  listeners.get('form:input')({ target: { id: 'xiaomiAiAmapKey', matches: () => false } });
  listeners.get('form:submit')({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    elements.get('xiaomiAiSaveState').textContent,
    '配置尚未加载，暂时无法保存；请等待或刷新页面重试。'
  );
  assert.equal(fetchCalls.filter(call => call.options.method === 'PUT').length, 0);

  resolveInitialConfig({ ok: true, json: async () => ({ ok: true, data: publicConfig }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').value, 'https://api.deepseek.com/responses');
  assert.equal(elements.get('xiaomiAiSystemPrompt').value, publicConfig.systemPrompt);

  listeners.get('form:submit')({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  let saves = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(saves.length, 1);
  const firstSavedConfig = JSON.parse(saves[0].options.body);
  assert.equal(firstSavedConfig.enabled, false);
  assert.equal(firstSavedConfig.deepseekResponsesUrl, 'https://api.deepseek.com/responses');
  assert.equal(firstSavedConfig.deepseekApiKey, 'deepseek-secret');
  assert.equal(firstSavedConfig.qweatherApiHost, 'nn7mdbwku9.re.qweatherapi.com');
  assert.equal(firstSavedConfig.qweatherApiKey, 'qweather-secret');
  assert.equal(firstSavedConfig.amapApiHost, 'https://restapi.amap.com');
  assert.equal(firstSavedConfig.amapApiKey, 'amap-secret');
  assert.equal(firstSavedConfig.systemPrompt, publicConfig.systemPrompt);
  assert.equal(elements.get('xiaomiAiDeepSeekKey').value, 'deepseek-secret');
  assert.equal(elements.get('xiaomiAiQWeatherKey').value, 'qweather-secret');
  assert.equal(elements.get('xiaomiAiAmapKey').value, 'amap-secret');

  elements.get('xiaomiAiEnabled').checked = true;
  listeners.get('xiaomiAiEnabled:change')();
  await new Promise(resolve => setImmediate(resolve));
  saves = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(saves.length, 2);
  assert.equal(JSON.parse(saves[1].options.body).enabled, true);

  listeners.get('xiaomiAiFetchModelsBtn:click')();
  await new Promise(resolve => setImmediate(resolve));
  const modelRequest = fetchCalls.find(call => call.url === '/api/ai/models');
  assert.equal(JSON.parse(modelRequest.options.body).apiKey, 'deepseek-secret');
  assert.equal(JSON.parse(modelRequest.options.body).apiUrl, 'https://api.deepseek.com/responses');
  assert.deepEqual(
    elements.get('xiaomiAiModelOptions').children.map(option => option.value),
    ['deepseek-v4-flash', 'deepseek-v4-pro']
  );
  assert.equal(elements.get('xiaomiAiModelMenu').hidden, false);
  assert.deepEqual(
    elements.get('xiaomiAiModelMenu').children.map(option => option.textContent),
    ['deepseek-v4-flash', 'deepseek-v4-pro']
  );
  assert.equal(elements.get('xiaomiAiModelFetchState').textContent, '已获取 2 个可用模型；可选择或直接输入。');

  elements.get('xiaomiAiModelMenu').children[1].listeners.click();
  assert.equal(elements.get('xiaomiAiModel').value, 'deepseek-v4-pro');
  assert.equal(elements.get('xiaomiAiModelMenu').hidden, true);
  timers.at(-1)();
  await new Promise(resolve => setImmediate(resolve));
  saves = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(saves.length, 3);
  assert.equal(JSON.parse(saves[2].options.body).model, 'deepseek-v4-pro');

  elements.get('xiaomiAiModel').value = 'new-model';
  listeners.get('form:input')({ target: { id: 'xiaomiAiModel', matches: () => false } });
  assert.equal(fetchCalls.filter(call => call.options.method === 'PUT').length, 3);
  timers.at(-1)();
  await new Promise(resolve => setImmediate(resolve));
  saves = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(saves.length, 4);
  assert.equal(JSON.parse(saves[3].options.body).model, 'new-model');

  elements.get('xiaomiAiDeepSeekUrl').value = 'https://api.deepseek.com';
  listeners.get('form:input')({ target: { id: 'xiaomiAiDeepSeekUrl', matches: () => false } });
  listeners.get('xiaomiAiTestBtn:click')();
  await new Promise(resolve => setImmediate(resolve));
  const callsAfterDeepSeekTest = fetchCalls.filter(call => call.url);
  const deepSeekSaveIndex = callsAfterDeepSeekTest.findIndex(call => (
    call.url === '/api/ai/config' && call.options.method === 'PUT'
    && JSON.parse(call.options.body).deepseekResponsesUrl === 'https://api.deepseek.com'
  ));
  const deepSeekTestIndex = callsAfterDeepSeekTest.findIndex(call => call.url === '/api/ai/test/deepseek');
  assert.ok(deepSeekSaveIndex >= 0 && deepSeekTestIndex > deepSeekSaveIndex);
  assert.equal(elements.get('xiaomiAiDeepSeekUrl').value, 'https://api.deepseek.com');
  assert.equal(
    fetchCalls.find(call => call.toast?.message?.includes('你好！'))?.toast.message,
    '模型 deepseek-chat 回复：你好！有什么可以帮你？'
  );

  elements.get('xiaomiAiQWeatherHost').value = 'new-weather.test';
  listeners.get('form:input')({ target: { id: 'xiaomiAiQWeatherHost', matches: () => false } });
  listeners.get('xiaomiAiQWeatherTestBtn:click')();
  await new Promise(resolve => setImmediate(resolve));
  const callsAfterWeatherTest = fetchCalls.filter(call => call.url);
  const weatherSaveIndex = callsAfterWeatherTest.findIndex(call => (
    call.url === '/api/ai/config' && call.options.method === 'PUT'
    && JSON.parse(call.options.body).qweatherApiHost === 'new-weather.test'
  ));
  const weatherTestIndex = callsAfterWeatherTest.findIndex(call => call.url === '/api/ai/test/qweather');
  assert.ok(weatherSaveIndex >= 0 && weatherTestIndex > weatherSaveIndex);
  assert.match(fetchCalls.find(call => call.toast)?.toast.className, /xiaomi-ai-test-toast-good/);
});

test('AI assistant masks saved secrets and omits mask placeholders from submission', async () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'ai-assistant-settings.js'), 'utf8');
  const listeners = new Map();
  const fetchCalls = [];
  const timers = [];
  const values = {
    xiaomiAiEnabled: true,
    xiaomiAiTrigger: '小米',
    xiaomiAiDeepSeekUrl: 'https://api.example.com/responses',
    xiaomiAiDeepSeekKey: '',
    xiaomiAiQWeatherKey: '',
    xiaomiAiAmapKey: '',
    xiaomiAiModel: 'deepseek-v4-flash',
    xiaomiAiWebSearch: true,
    xiaomiAiReasoning: false,
    xiaomiAiQWeatherHost: '',
    xiaomiAiAmapHost: '',
    xiaomiAiReplyMaxChars: '50',
    xiaomiAiConcurrency: '3',
    xiaomiAiUserCooldown: '0',
    xiaomiAiRoomLimit: '20',
    xiaomiAiSystemPrompt: '这是一个长度足够的测试人格预设。'
  };
  const elements = new Map(Object.entries(values).map(([id, value]) => [id, {
    id,
    value: typeof value === 'boolean' ? '' : value,
    type: 'text',
    checked: value === true,
    textContent: '',
    className: '',
    disabled: false,
    attributes: {},
    setAttribute(name, attributeValue) { this.attributes[name] = attributeValue; },
    addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); }
  }]));
  for (const id of [
    'xiaomiAiSaveState', 'xiaomiAiTestBtn', 'xiaomiAiQWeatherTestBtn', 'xiaomiAiAmapTestBtn',
    'xiaomiAiFetchModelsBtn', 'xiaomiAiDeepSeekKeyHint',
    'xiaomiAiQWeatherKeyHint', 'xiaomiAiAmapKeyHint', 'xiaomiAiConfigState',
    'xiaomiAiModelState', 'xiaomiAiQueueState', 'xiaomiAiModelFetchState'
  ]) {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', checked: false, textContent: '', className: '', disabled: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); }
    });
  }
  elements.set('xiaomiAiModelOptions', { children: [], replaceChildren(...children) { this.children = children; } });
  elements.set('xiaomiAiModelMenu', { hidden: true, children: [], replaceChildren(...children) { this.children = children; } });
  const form = {
    checkValidity: () => true,
    reportValidity: () => true,
    addEventListener(type, handler) { listeners.set(`form:${type}`, handler); }
  };
  elements.set('xiaomiAiForm', form);

  const publicConfig = {
    enabled: true,
    trigger: '小米',
    deepseekResponsesUrl: 'https://api.example.com/responses',
    model: 'deepseek-v4-flash',
    webSearchEnabled: true,
    reasoningEnabled: false,
    qweatherApiHost: '',
    amapApiHost: '',
    replyMaxChars: 50,
    generationConcurrency: 3,
    sendIntervalMs: 3000,
    userCooldownSeconds: 0,
    roomLimitPerMinute: 20,
    systemPrompt: '这是一个长度足够的测试人格预设。',
    hasDeepSeekApiKey: true,
    hasQWeatherApiKey: true,
    hasAmapApiKey: false
  };

  const sandbox = {
    console,
    document: {
      getElementById: id => elements.get(id),
      createElement: tagName => ({
        tagName,
        value: '',
        textContent: '',
        className: '',
        attributes: {},
        listeners: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(type, handler) { this.listeners[type] = handler; }
      })
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      const data = url === '/api/ai/status' ? { queued: 0 } : publicConfig;
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
    setTimeout: handler => { timers.push(handler); return timers.length; },
    clearTimeout() {},
    window: { AdminApp: { utils: { showStackedToast() {} } } }
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.aiAssistantSettings.init();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(elements.get('xiaomiAiDeepSeekKey').type, 'password');
  assert.equal(elements.get('xiaomiAiDeepSeekKey').value, '********');
  assert.equal(elements.get('xiaomiAiQWeatherKey').type, 'password');
  assert.equal(elements.get('xiaomiAiQWeatherKey').value, '********');
  assert.equal(elements.get('xiaomiAiAmapKey').type, 'password');
  assert.equal(elements.get('xiaomiAiAmapKey').value, '');
  assert.equal(elements.get('xiaomiAiDeepSeekKeyHint').textContent, '已加密保存；清空或输入新值以更新');
  assert.equal(elements.get('xiaomiAiQWeatherKeyHint').textContent, '已加密保存；清空或输入新值以更新');
  assert.equal(elements.get('xiaomiAiAmapKeyHint').textContent, '尚未保存');

  elements.get('xiaomiAiTrigger').value = '猫猫';
  listeners.get('form:input')({ target: { id: 'xiaomiAiTrigger', matches: () => false } });
  timers.at(-1)();
  await new Promise(resolve => setImmediate(resolve));
  const saves = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(saves.length, 1);
  const savedConfig = JSON.parse(saves[0].options.body);
  assert.equal(savedConfig.trigger, '猫猫');
  assert.equal(savedConfig.deepseekApiKey, undefined);
  assert.equal(savedConfig.qweatherApiKey, undefined);
  assert.equal(savedConfig.amapApiKey, undefined);

  elements.get('xiaomiAiDeepSeekKey').value = 'new-deepseek-key';
  listeners.get('form:input')({ target: { id: 'xiaomiAiDeepSeekKey', matches: () => false } });
  timers.at(-1)();
  await new Promise(resolve => setImmediate(resolve));
  const savesWithNewKey = fetchCalls.filter(call => call.url === '/api/ai/config' && call.options.method === 'PUT');
  assert.equal(savesWithNewKey.length, 2);
  const configWithNewKey = JSON.parse(savesWithNewKey[1].options.body);
  assert.equal(configWithNewKey.deepseekApiKey, 'new-deepseek-key');
  assert.equal(configWithNewKey.qweatherApiKey, undefined);
});
