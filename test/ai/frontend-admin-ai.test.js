'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NUMBER_LIMITS } = require('../../src/ai/config');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { MIN_CHUNK_INTERVAL_MS, MAX_CHUNK_INTERVAL_MS } = require('../../src/ai/ai-assistant-helpers');

const ROOT_DIR = path.join(__dirname, '../..');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('AI form number constraints match the server contract', () => {
  const html = readAdminHtml();
  const fieldIds = {
    replyMaxChars: 'xiaomiAiReplyMaxChars',
    generationConcurrency: 'xiaomiAiConcurrency',
    userCooldownSeconds: 'xiaomiAiUserCooldown',
    roomLimitPerMinute: 'xiaomiAiRoomLimit',
  };

  for (const [key, id] of Object.entries(fieldIds)) {
    const input = tagById(html, id);
    assert.match(input, /^<input\b/);
    assert.equal(Number(input.match(/\smin\s*=\s*["']([^"']+)["']/)?.[1]), NUMBER_LIMITS[key][0]);
    assert.equal(Number(input.match(/\smax\s*=\s*["']([^"']+)["']/)?.[1]), NUMBER_LIMITS[key][1]);
  }
  assert.equal((html.match(/\bdata-ai-secret\b/g) || []).length, 3);
});

test('admin page uses one ordered module entrypoint', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  const scripts = html.match(/<script\b[^>]*>/g) || [];
  const entries = scripts.filter((tag) => /\ssrc=["']\/js\/admin\/index\.js(?:\?[^"']*)?["']/.test(tag));
  assert.equal(entries.length, 1);
  assert.match(entries[0], /\stype=["']module["']/);
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

test('parameter ranges preserve centered values and leave playback controls independent', async () => {
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

  for (const id of [
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
  ]) {
    const input = tagById(html, id);
    assert.match(input, /^<input\b/);
    assert.match(input, /\stype=["']range["']/);
    const classes = input.match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.ok(classes.includes('parameter-range'));
    assert.ok(classes.includes('parameter-range--centered'));
  }
  for (const id of ['playbackSeek', 'playbackVolume']) {
    const classes = tagById(html, id).match(/\sclass=["']([^"']*)["']/)?.[1].split(/\s+/) || [];
    assert.equal(classes.includes('parameter-range'), false);
  }
  assert.match(styles, /var\(--parameter-range-origin-length\)/);
  assert.match(styles, /var\(--parameter-range-zero-position\)/);
  const focusRule = styles.match(/:focus-visible\s*\{([^}]+)\}/)?.[1];
  assert.ok(focusRule, 'keyboard focus has a visible indicator');
  const outline = focusRule.match(/(?:^|;)\s*outline\s*:\s*([^;]+)/)?.[1];
  assert.ok(outline);
  assert.doesNotMatch(outline, /\b(?:none|transparent)\b|^0(?:px)?(?:\s|$)/);
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
  assert.match(tagById(html, 'xiaomiAiForm'), /^<form\b/);
  for (const id of [
    'xiaomiAiTitle',
    'xiaomiAiProviderBadge',
    'xiaomiAiModelState',
    'xiaomiAiProtocolCapability',
    'xiaomiAiWebSearchCapability',
    'xiaomiAiReasoningCapability',
  ]) tagById(html, id);
  for (const id of ['xiaomiAiEnabled', 'xiaomiAiWebSearch']) {
    const input = tagById(html, id);
    assert.match(input, /\stype=["']checkbox["']/);
    assert.match(input, /\schecked(?:\s|\/?>)/);
  }
  const model = tagById(html, 'xiaomiAiModel');
  assert.match(model, /\saria-controls=["']xiaomiAiModelMenu["']/);
  assert.doesNotMatch(model, /\s(?:list|value)\s*=/);
  tagById(html, 'xiaomiAiModelMenu');
  for (const id of ['xiaomiAiFetchModelsBtn', 'xiaomiAiTestBtn', 'xiaomiAiQWeatherTestBtn', 'xiaomiAiAmapTestBtn']) {
    const button = tagById(html, id);
    assert.match(button, /^<button\b/);
    assert.match(button, /\stype=["']button["']/);
  }
  const reasoning = tagById(html, 'xiaomiAiReasoning');
  assert.match(reasoning, /\stype=["']checkbox["']/);
  assert.doesNotMatch(reasoning, /\schecked(?:\s|=|\/?>)/);
  assert.match(tagById(html, 'xiaomiAiReplyMaxChars'), /\svalue=["']50["']/);
  const interval = (html.match(/<input\b[^>]*>/g) || []).find((tag) => /\svalue="不同回复随机/.test(tag));
  assert.ok(interval);
  assert.match(interval, /\sreadonly(?:\s|\/?>)/);
  assert.equal(
    interval.match(/\svalue="([^"]+)"/)?.[1],
    `不同回复随机 500–2000 毫秒；同一回复分段随机 ${MIN_CHUNK_INTERVAL_MS}–${MAX_CHUNK_INTERVAL_MS} 毫秒`,
  );
  assert.match(tagById(html, 'xiaomiAiUserCooldown'), /\svalue=["']0["']/);
  assert.doesNotMatch(html, /id="xiaomiAiSendInterval"/);
  for (const [id, expected] of [
    ['xiaomiAiModelProvider', ['deepseek', 'openai', 'anthropic', 'gemini', 'custom']],
    ['xiaomiAiModelApiProtocol', ['auto', 'responses', 'chat_completions']],
    ['xiaomiAiReasoningEffort', ['high', 'max']],
  ]) {
    assert.match(tagById(html, id), /^<select\b/);
    const select = html.match(new RegExp(`<select\\b[^>]*\\sid=["']${id}["'][^>]*>[\\s\\S]*?<\\/select>`))?.[0];
    const values = [...select.matchAll(/<option\b[^>]*\svalue=["']([^"']*)["']/g)].map((match) => match[1]);
    for (const value of expected) assert.ok(values.includes(value), `${id} supports ${value}`);
  }
  assert.match(tagById(html, 'xiaomiAiProviderManagedReasoning'), /\shidden(?:\s|\/?>)/);
  for (const id of ['xiaomiAiDeepSeekKey', 'xiaomiAiQWeatherKey', 'xiaomiAiAmapKey']) {
    assert.match(tagById(html, id), /\stype=["']password["']/);
  }
  assert.doesNotMatch(tagById(html, 'xiaomiAiTrigger'), /\svalue=["']小米["']/);
  assert.match(tagById(html, 'xiaomiAiDeepSeekUrl'), /^<input\b/);
  assert.match(tagById(html, 'xiaomiAiQWeatherHost'), /\stype=["']text["']/);
  assert.match(tagById(html, 'xiaomiAiSaveBtn'), /\stype=["']submit["']/);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{8,}/);
});

test('AI configuration renders API text without HTML injection', () => {
  for (const name of ['ai-assistant-settings.js', 'ai-assistant-config-view.js']) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin', name), 'utf8');
    assert.doesNotMatch(source, /innerHTML\s*=/);
  }
});
