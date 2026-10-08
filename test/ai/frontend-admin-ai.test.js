'use strict';

const { readAdminFragmentHtml, readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NUMBER_LIMITS } = require('../../src/ai/config');
const { MIN_CHUNK_INTERVAL_MS, MAX_CHUNK_INTERVAL_MS } = require('../../src/ai/ai-assistant-helpers');

const ROOT_DIR = path.join(__dirname, '../..');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('AI form number constraints match the server contract', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku-ai.html');
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

test('AI panel mounts its controls with safe defaults', () => {
  const html = readAdminFragmentHtml('pages/admin/toolbox/danmaku-ai.html');
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
});

test('the complete admin document contains no hardcoded AI API key', () => {
  assert.doesNotMatch(readAdminHtml(), /sk-[A-Za-z0-9_-]{8,}/);
});

test('AI configuration renders API text without HTML injection', () => {
  for (const name of ['ai-assistant-settings.js', 'ai-assistant-config-view.js']) {
    const source = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin', name), 'utf8');
    assert.doesNotMatch(source, /innerHTML\s*=/);
  }
});
