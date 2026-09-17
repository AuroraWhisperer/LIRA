'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const {
  MIN_CHUNK_INTERVAL_MS,
  MAX_CHUNK_INTERVAL_MS,
} = require('../src/ai/ai-assistant-helpers');

const ROOT_DIR = path.join(__dirname, '..');

test('admin danmaku input has no fixed character limit', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );
  const libraries = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-libraries.js'),
    'utf8',
  );

  assert.doesNotMatch(html, /id="danmakuMessage"[^>]*maxlength=/);
  assert.match(html, /id="danmakuCounter"[^>]*>0 字</);
  assert.match(source, /Array\.from\(elements\.message\.value\)\.length/);
  assert.match(source, /enableRandomTagReply/);
  assert.match(source, /enableCheckinBot/);
  assert.match(source, /enableFortuneBot/);
  assert.match(source, /enableCustomReplyBot/);
  assert.doesNotMatch(source, /mentionRequester: toggle\.checked/);
  assert.match(html, /随机点歌回复/);
  assert.match(html, /条件不匹配时自动回复点歌人/);
  assert.match(html, /启用回复/);
  assert.match(html, /签到机器人/);
  assert.match(html, /收到“签到”后回复累计天数/);
  assert.match(html, /启用签到/);
  assert.match(html, /抽签机器人/);
  assert.match(html, /收到“抽签”后回复每日一签/);
  assert.match(html, /启用抽签/);
  assert.match(html, /DIY 关键词回复/);
  assert.match(html, /收到自定义关键词后回复固定文案/);
  assert.match(html, /启用 DIY/);
  assert.match(
    html,
    /<details id="danmakuBlessingsPanel" class="danmaku-blessings-section">/,
  );
  assert.match(html, /id="danmakuBlessingList"/);
  assert.match(html, /id="danmakuBlessingAddBtn"/);
  assert.match(html, /id="danmakuBlessingSaveBtn"/);
  assert.match(source, /createBlessingEditor/);
  assert.match(source, /createFortuneEditor/);
  assert.match(source, /createCustomReplyEditor/);
  assert.doesNotMatch(source, /items\.splice\(index, 1\)/);
  assert.match(
    libraries,
    /saveSetting\('checkinBlessings', JSON\.stringify\(cleaned\)\)/,
  );
  assert.match(libraries, /items\.splice\(index, 1\)/);
  assert.ok(
    html.indexOf('id="danmakuComposeTitle"') <
      html.indexOf('id="danmakuBlessingsPanel"'),
  );
  assert.ok(
    html.indexOf('id="danmakuComposeTitle"') <
      html.indexOf('id="danmakuCustomRepliesPanel"'),
  );
  assert.ok(
    html.indexOf('id="danmakuCustomRepliesPanel"') <
      html.indexOf('id="danmakuBlessingsPanel"'),
  );
  assert.ok(
    html.indexOf('id="danmakuBlessingsPanel"') <
      html.indexOf('id="danmakuFortunesPanel"'),
  );
  assert.match(html, /id="danmakuFortuneList"/);
  assert.match(html, /id="danmakuFortuneAddBtn"/);
  assert.match(html, /id="danmakuFortuneSaveBtn"/);
  assert.match(source, /fortuneEditor\.load\(state\.fortunePool\)/);
  assert.match(source, /customReplyEditor\.load\(state\.customReplyRules\)/);
  assert.match(
    libraries,
    /saveSetting\('fortunePool', JSON\.stringify\(cleaned\)\)/,
  );
  assert.match(
    libraries,
    /saveSetting\('customReplyRules', JSON\.stringify\(cleaned\)\)/,
  );
  assert.match(libraries, /export function createFortuneEditor/);
  assert.match(libraries, /export function createCustomReplyEditor/);
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
    /id="danmakuPreviewOverlayBtn"[^>]*>\s*本地预览\s*<\/button>/,
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
    ['ranked', '大头像气泡'],
    ['transparent', '透明文字'],
    ['identity', '头像横卡'],
    ['outline', '简洁白卡'],
    ['cream', '奶油气泡'],
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
    /\.danmaku-style-picker\s*\{[^}]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(220px, 1fr\);/s,
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
});

test('admin danmaku status prefers account and room display names', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );

  assert.match(
    source,
    /state\.accountName \|\| `UID \$\{state\.accountUid \|\| '-'\}`/,
  );
  assert.match(source, /state\.roomName \|\| `房间 \$\{state\.roomId\}`/);
  assert.match(
    source,
    /accountState\.title\s*=\s*state\.loggedIn && state\.accountUid\s*\?\s*`UID \$\{state\.accountUid\}`\s*:\s*''\s*;/,
  );
  assert.match(
    source,
    /roomState\.title\s*=\s*state\.roomId\s*\?\s*`房间 \$\{state\.roomId\}`\s*:\s*''\s*;/,
  );
});

test('successful Bilibili login refreshes the danmaku tool automatically', () => {
  const settingsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-auth.js'),
    'utf8',
  );
  const toolSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );

  assert.match(
    settingsSource,
    /if \(result\.state\.loggedIn\) \{[\s\S]*?documentRef\.dispatchEvent\([\s\S]*?app:bilibili-auth-changed/,
  );
  assert.match(
    toolSource,
    /document\.addEventListener\(['"]app:bilibili-auth-changed['"],\s*\(\)\s*=>\s*refreshState\(\)\)/,
  );
});

test('opening disconnected danmaku tool refreshes live once and distinguishes connection states', () => {
  const toolSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'danmaku-tool.js'),
    'utf8',
  );
  const navigationSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(
    navigationSource,
    /refresh\(\{ reconnectIfDisconnected: true \}\)/,
  );
  assert.match(
    toolSource,
    /if \(reconnectIfDisconnected && !state\.connected\) \{[\s\S]*?reconnectBilibili/,
  );
  assert.match(
    toolSource,
    /state\.connected\s*\?\s*['"]connection-good['"]\s*:\s*['"]connection-bad['"]/,
  );
  assert.match(styles, /strong\.connection-good\s*\{/);
  assert.match(styles, /strong\.connection-bad\s*\{/);
  assert.match(styles, /strong\.connection-good::before/);
  assert.match(styles, /strong\.connection-bad::before/);
});

test('danmaku tool places the AI interaction assistant after the manual sender with safe defaults', () => {
  const html = readAdminHtml();
  const source = readJsModuleBundle(
    'public',
    'js',
    'admin',
    'ai-assistant-settings.js',
  );
  const indexSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'),
    'utf8',
  );
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.ok(
    html.indexOf('id="xiaomiAiSection"') > html.indexOf('id="danmakuSendForm"'),
  );
  assert.ok(
    html.indexOf('id="xiaomiAiSection"') <
      html.indexOf('id="danmakuCustomRepliesPanel"'),
  );
  assert.match(html, /id="xiaomiAiTitle">AI 互动助手<\/h3>/);
  assert.match(html, /id="xiaomiAiProviderBadge">自动识别</);
  assert.match(html, /可选官方预设/);
  assert.match(html, /id="xiaomiAiEnabled"[^>]*checked/);
  assert.match(html, /id="xiaomiAiModelState">未配置</);
  assert.match(
    html,
    /id="xiaomiAiModel"[^>]*placeholder="填写模型 ID"[^>]*aria-controls="xiaomiAiModelMenu"/,
  );
  assert.doesNotMatch(html, /id="xiaomiAiModel"[^>]*\blist=/);
  assert.doesNotMatch(html, /id="xiaomiAiModel"[^>]*value=/);
  assert.match(html, /id="xiaomiAiFetchModelsBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiQWeatherTestBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiAmapTestBtn"[^>]*type="button"/);
  assert.doesNotMatch(html, /<datalist\b/);
  assert.match(html, /id="xiaomiAiWebSearch"[^>]*checked/);
  assert.match(
    html,
    /id="xiaomiAiReasoning"[^>]*type="checkbox"(?![^>]*checked)/,
  );
  assert.match(html, /id="xiaomiAiReplyMaxChars"[^>]*value="50"/);
  assert.match(html, /id="xiaomiAiReplyMaxChars"[^>]*min="10"[^>]*max="50"/);
  assert.match(html, /回复长度偏好/);
  assert.match(html, /优先一条；内容较多时两条，必要时三条/);
  assert.equal(
    html.match(/value="(不同回复随机[^"]+)"\s+readonly/)?.[1],
    `不同回复随机 500–2000 毫秒；同一回复分段随机 ${MIN_CHUNK_INTERVAL_MS}–${MAX_CHUNK_INTERVAL_MS} 毫秒`,
  );
  assert.match(html, /id="xiaomiAiUserCooldown"[^>]*min="0"[^>]*value="0"/);
  assert.doesNotMatch(html, /id="xiaomiAiSendInterval"/);
  assert.doesNotMatch(source, /sendIntervalMs: \['xiaomiAiSendInterval'/);
  assert.match(
    html,
    /id="xiaomiAiDeepSeekUrl"[^>]*placeholder="例如：https:\/\/gcli\.ggchan\.dev\/ 或 https:\/\/api\.openai\.com\/v1"/,
  );
  assert.match(
    html,
    /id="xiaomiAiModelProvider"[\s\S]*?value="deepseek"[\s\S]*?value="openai"[\s\S]*?value="anthropic"[\s\S]*?value="gemini"[\s\S]*?value="custom"/,
  );
  assert.match(
    html,
    /id="xiaomiAiModelApiProtocol"[\s\S]*?value="auto"[\s\S]*?value="responses"[\s\S]*?value="chat_completions"/,
  );
  assert.match(html, /id="xiaomiAiProtocolCapability">等待配置</);
  assert.match(html, /id="xiaomiAiWebSearchCapability">等待配置</);
  assert.match(html, /id="xiaomiAiReasoningCapability">等待配置</);
  assert.match(
    html,
    /id="xiaomiAiReasoningEffort"[\s\S]*?value="high">High<[\s\S]*?value="max">Max</,
  );
  assert.match(html, /id="xiaomiAiProviderManagedReasoning"[^>]*hidden/);
  assert.match(html, /id="xiaomiAiDeepSeekKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiQWeatherKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiAmapKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiTrigger"[^>]*placeholder="例如：小米"/);
  assert.doesNotMatch(html, /id="xiaomiAiTrigger"[^>]*value="小米"/);
  assert.match(html, /id="xiaomiAiTestBtn"[^>]*>\s*测试模型服务/);
  assert.match(
    html,
    /id="xiaomiAiQWeatherHost"[^>]*type="text"[^>]*placeholder="nn7mdbwku9\.re\.qweatherapi\.com"/,
  );
  assert.match(html, /<details class="xiaomi-ai-collapsible">[\s\S]*?扩展能力/);
  assert.match(
    html,
    /<details class="xiaomi-ai-collapsible xiaomi-ai-advanced">[\s\S]*?高级设置/,
  );
  assert.match(html, /id="xiaomiAiSaveBtn"[^>]*type="submit"[^>]*>\s*保存配置/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{8,}/);
  assert.match(indexSource, /import ["']\.\/ai-assistant-settings\.js["'];/);
  assert.match(source, /element\.textContent = text/);
  assert.match(source, /const AUTOSAVE_DELAY_MS = 700/);
  assert.match(source, /form\.addEventListener\(["']input["']/);
  assert.match(source, /form\.addEventListener\(["']change["']/);
  assert.match(source, /enabledInput\.addEventListener\(["']change["']/);
  assert.match(
    source,
    /deepseekApiKey: \[["']xiaomiAiDeepSeekKey["'], ["']secret["'], ["']hasDeepSeekApiKey["']\]/,
  );
  assert.match(
    source,
    /modelProvider: \[["']xiaomiAiModelProvider["'], ["']value["']\]/,
  );
  assert.match(source, /Claude 官方兼容/);
  assert.match(source, /Gemini 官方兼容/);
  assert.match(
    source,
    /modelApiProtocol: \[["']xiaomiAiModelApiProtocol["'], ["']value["']\]/,
  );
  assert.match(
    source,
    /reasoningEffort: \[["']xiaomiAiReasoningEffort["'], ["']value["']\]/,
  );
  assert.match(source, /provider_managed: ["']供应商管理["']/);
  assert.match(source, /由 LIRA 执行，需要模型支持 tool_calls/);
  assert.match(
    source,
    /qweatherApiKey: \[["']xiaomiAiQWeatherKey["'], ["']secret["'], ["']hasQWeatherApiKey["']\]/,
  );
  assert.match(
    source,
    /amapApiKey: \[["']xiaomiAiAmapKey["'], ["']secret["'], ["']hasAmapApiKey["']\]/,
  );
  assert.doesNotMatch(source, /const secretFields/);
  assert.match(source, /config\.model \|\| ["']未配置["']/);
  assert.match(source, /if \(saving\) \{[\s\S]*?pendingSave = true/);
  assert.match(
    source,
    /value !== ["']\*\*\*\*\*\*\*\*["'] && \(value \|\| kind !== ["']secret["']\)/,
  );
  assert.match(source, /element\.type = ["']password["']/);
  assert.doesNotMatch(source, /innerHTML\s*=/);
  assert.doesNotMatch(source, /modelOptions/);
  assert.match(styles, /\.xiaomi-ai-section\s*\{/);
  assert.match(styles, /\.xiaomi-ai-integration-grid\s*\{/);
  assert.match(styles, /\.xiaomi-ai-test-actions\s*\{/);
  assert.match(styles, /\.xiaomi-ai-capability-rail\s*\{/);
  assert.match(styles, /overscroll-behavior:\s*contain/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});
