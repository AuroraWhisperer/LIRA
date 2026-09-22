'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NUMBER_LIMITS } = require('../src/ai/config');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { MIN_CHUNK_INTERVAL_MS, MAX_CHUNK_INTERVAL_MS } = require('../src/ai/ai-assistant-helpers');

const ROOT_DIR = path.join(__dirname, '..');

test('AI form number constraints match the server contract', () => {
  const html = readAdminHtml();
  const fieldIds = {
    replyMaxChars: 'xiaomiAiReplyMaxChars',
    generationConcurrency: 'xiaomiAiConcurrency',
    userCooldownSeconds: 'xiaomiAiUserCooldown',
    roomLimitPerMinute: 'xiaomiAiRoomLimit',
  };

  for (const [key, id] of Object.entries(fieldIds)) {
    const input = html.match(new RegExp(`<input\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>`, 's'))?.[0];
    assert.ok(input, `${id} should exist`);
    assert.equal(Number(input.match(/\bmin\s*=\s*["']([^"']+)["']/)?.[1]), NUMBER_LIMITS[key][0]);
    assert.equal(Number(input.match(/\bmax\s*=\s*["']([^"']+)["']/)?.[1]), NUMBER_LIMITS[key][1]);
  }
  assert.equal((html.match(/\bdata-ai-secret\b/g) || []).length, 3);
});

test('admin page uses one ordered module entrypoint', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  assert.match(html, /<script type="module" src="\/js\/admin\/index\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  assert.ok(entrySource.includes("import './gifts/index.js';"));
  const giftEntry = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin/gifts/index.js'), 'utf8');
  for (const name of ['notification', 'detection', 'sprint', 'recent', 'blindbox', 'history']) {
    assert.ok(giftEntry.includes(`from './${name}.js'`), `${name} is an explicit dependency`);
    assert.ok(
      !entrySource.includes(`import './gifts/${name}.js';`),
      'composition does not rely on side-effect ordering',
    );
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('parameter ranges preserve centered values and opt in without changing playback controls', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'components', 'parameter-range.css'), 'utf8');
  const { getParameterRangeOrigin, getParameterRangeProgress } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'parameter-range.js'),
  );

  assert.equal(getParameterRangeProgress({ min: '0', max: '100', value: '25' }), 25);
  assert.equal(getParameterRangeProgress({ min: '-3000', max: '3000', value: '0' }), 50);
  const origin = (input) => JSON.parse(JSON.stringify(getParameterRangeOrigin(input)));
  assert.deepEqual(origin({ min: '-20', max: '20', value: '-5' }), {
    zeroProgress: 50,
    startProgress: 37.5,
    lengthProgress: 12.5,
    polarity: 'negative',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '10' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 25,
    polarity: 'positive',
  });
  assert.deepEqual(origin({ min: '-20', max: '20', value: '0' }), {
    zeroProgress: 50,
    startProgress: 50,
    lengthProgress: 0,
    polarity: 'neutral',
  });

  const expectedVariants = {
    tempo: ['queueScrollSpeedRange', 'identityQueueScrollSpeedRange', 'scrollSecondsRange'],
    scale: [
      'queueSongFontSize',
      'queueTitleFontSize',
      'identityQueueFontSize',
      'overlayRuleFontSize',
      'songBoardFontSize',
      'songBoardSongFontSize',
      'songBoardTitleFontSize',
      'desktopLyricFontSize',
      'desktopLyricLineHeight',
      'desktopLyricStrokeWidth',
      'desktopLyricShadowBlur',
      'desktopLyricTranslationScale',
      'desktopLyricScale',
      'desktopLyricAlignPosition',
      'desktopLyricPerspective',
    ],
    intensity: [
      'themeOpacity',
      'backdropBlur',
      'glowIntensity',
      'songBoardBackdropBlur',
      'songBoardGlowIntensity',
      'songBoardThemeOpacity',
      'desktopLyricShadowIntensity',
      'desktopLyricOpacity',
      'desktopLyricBaseOpacity',
      'desktopLyricTranslationOpacity',
      'desktopLyricBgOpacity',
      'desktopLyricGlobalOpacity',
      'desktopLyricBrightness',
      'desktopLyricContrast',
      'desktopLyricSaturation',
    ],
    centered: [
      'desktopLyricLetterSpacing',
      'desktopLyricShadowOffsetX',
      'desktopLyricShadowOffsetY',
      'desktopLyricInterludeOffsetEm',
      'desktopLyricTimeOffsetMs',
      'desktopLyricTranslateX',
      'desktopLyricTranslateY',
      'desktopLyricRotateX',
      'desktopLyricRotateY',
      'weSingLyricOffsetMs',
    ],
  };
  for (const [variant, ids] of Object.entries(expectedVariants)) {
    for (const id of ids) {
      assert.match(
        html,
        new RegExp(`id="${id}"\\s+class="parameter-range parameter-range--${variant}"\\s+type="range"`),
      );
    }
  }
  assert.doesNotMatch(html, /id="playbackSeek" class="parameter-range"/);
  assert.doesNotMatch(html, /id="playbackVolume" class="[^\"]*parameter-range/);
  assert.match(styles, /\.parameter-range\s*\[\s*type\s*=\s*['"]range['"]\s*\]/);
  assert.match(styles, /:focus-visible\s*\{[^}]*outline: 2px solid/);
  assert.match(styles, /\.parameter-range--centered\[type='range'\]/);
  assert.match(styles, /var\(--parameter-range-origin-length\)/);
  assert.match(styles, /var\(--parameter-range-zero-position\)/);
  assert.doesNotMatch(styles, /\.parameter-range--(?:tempo|scale|intensity)/);
});

test('admin form refresh preserves the active edit and updates inactive fields', async () => {
  const edited = { value: '正在输入', dataset: {}, closest: () => null };
  const inactive = { value: '旧值', dataset: {}, closest: () => null };
  const document = {
    activeElement: edited,
    getElementById: (id) => ({ edited, inactive })[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/forms.js'), {
    document,
    window: { AdminApp: {} },
  });
  new FormsService().fillForm({ edited: '服务端值', inactive: '新值' });
  assert.equal(edited.value, '正在输入');
  assert.equal(inactive.value, '新值');
});

test('AI panel mounts its controls with safe defaults', () => {
  const html = readAdminHtml();
  assert.match(html, /id="xiaomiAiTitle">AI 互动助手<\/h3>/);
  assert.match(html, /id="xiaomiAiProviderBadge">自动识别</);
  assert.match(html, /选择你使用的 AI 平台/);
  assert.match(html, /id="xiaomiAiEnabled"[^>]*checked/);
  assert.match(html, /id="xiaomiAiModelState">未配置</);
  assert.match(html, /id="xiaomiAiModel"[^>]*placeholder="填写模型 ID"[^>]*aria-controls="xiaomiAiModelMenu"/);
  assert.doesNotMatch(html, /id="xiaomiAiModel"[^>]*\blist=/);
  assert.doesNotMatch(html, /id="xiaomiAiModel"[^>]*value=/);
  assert.match(html, /id="xiaomiAiFetchModelsBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiQWeatherTestBtn"[^>]*type="button"/);
  assert.match(html, /id="xiaomiAiAmapTestBtn"[^>]*type="button"/);
  assert.doesNotMatch(html, /<datalist\b/);
  assert.match(html, /id="xiaomiAiWebSearch"[^>]*checked/);
  assert.match(html, /id="xiaomiAiReasoning"[^>]*type="checkbox"(?![^>]*checked)/);
  assert.match(html, /id="xiaomiAiReplyMaxChars"[^>]*value="50"/);
  assert.match(html, /回复长度偏好/);
  assert.match(html, /优先一条；内容较多时两条，必要时三条/);
  assert.equal(
    html.match(/value="(不同回复随机[^"]+)"\s+readonly/)?.[1],
    `不同回复随机 500–2000 毫秒；同一回复分段随机 ${MIN_CHUNK_INTERVAL_MS}–${MAX_CHUNK_INTERVAL_MS} 毫秒`,
  );
  assert.match(html, /id="xiaomiAiUserCooldown"[^>]*min="0"[^>]*value="0"/);
  assert.doesNotMatch(html, /id="xiaomiAiSendInterval"/);
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
  assert.match(html, /id="xiaomiAiReasoningEffort"[\s\S]*?value="high">高<[\s\S]*?value="max">最高</);
  assert.match(html, /id="xiaomiAiProviderManagedReasoning"[^>]*hidden/);
  assert.match(html, /id="xiaomiAiDeepSeekKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiQWeatherKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiAmapKey"[^>]*type="password"/);
  assert.match(html, /id="xiaomiAiTrigger"[^>]*placeholder="请自定义触发关键词"/);
  assert.doesNotMatch(html, /id="xiaomiAiTrigger"[^>]*value="小米"/);
  assert.match(html, /id="xiaomiAiTestBtn"[^>]*>\s*测试 AI 连接/);
  assert.match(html, /id="xiaomiAiQWeatherHost"[^>]*type="text"[^>]*placeholder="nn7mdbwku9\.re\.qweatherapi\.com"/);
  assert.match(html, /<details class="xiaomi-ai-collapsible">[\s\S]*?扩展能力/);
  assert.match(html, /<details class="xiaomi-ai-collapsible xiaomi-ai-advanced">[\s\S]*?高级设置/);
  assert.match(html, /id="xiaomiAiSaveBtn"[^>]*type="submit"[^>]*>\s*保存设置/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{8,}/);
});

test('AI configuration renders API text without HTML injection', () => {
  for (const name of ['ai-assistant-settings.js', 'ai-assistant-config-view.js']) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin', name), 'utf8');
    assert.doesNotMatch(source, /innerHTML\s*=/);
  }
});
