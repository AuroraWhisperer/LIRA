'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getModelReasoning } = require('../../src/ai/model-reasoning');
const { buildResponsesBody, resolveReasoningEffort } = require('../../src/ai/model-protocol');

test('an unlisted model snapshot requires upstream reasoning metadata', () => {
  const config = { modelProvider: 'openai', model: 'gpt-6.1-sol-2099-01-01' };
  assert.equal(getModelReasoning(config), null);

  const reasoning = getModelReasoning(config, {
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
    default_reasoning_level: 'high',
  });
  assert.deepEqual(reasoning.efforts, ['low', 'high']);
  assert.equal(reasoning.defaultEffort, 'high');
  assert.equal(getModelReasoning({ ...config, modelProvider: 'custom' }), null);
});

test('unknown official models omit inherited and forced reasoning parameters', () => {
  const config = { modelProvider: 'openai', model: 'gpt-future', reasoningEffort: 'max' };
  for (const reasoningEnabled of [false, true]) {
    const body = buildResponsesBody({ input: 'hello' }, { ...config, reasoningEnabled }, { officialDeepSeek: false });
    assert.equal(body.reasoning, undefined);
  }
});

test('Pro models and their documented snapshots use their own supported defaults', () => {
  assert.equal(resolveReasoningEffort({ modelProvider: 'openai', model: 'gpt-5.4-pro', reasoningEnabled: false }), 'medium');
  assert.equal(resolveReasoningEffort({ modelProvider: 'openai', model: 'gpt-5.5-pro-2026-04-23',
    reasoningEnabled: true, reasoningEffort: 'max' }), 'high');
});

test('subscription reasoning requires account metadata instead of API defaults', () => {
  const config = { modelProvider: 'openai', modelAuthMode: 'subscription', model: 'gpt-5.4-pro', reasoningEnabled: true };
  assert.equal(getModelReasoning(config), null);
  const modelReasoning = getModelReasoning(config, {
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], default_reasoning_level: 'low',
  });
  assert.equal(resolveReasoningEffort({ ...config, modelReasoning }), 'low');
});

test('catalog levels without a default or with no levels never revive documented fallback levels', () => {
  const config = { modelProvider: 'deepseek', model: 'deepseek-flash', reasoningEnabled: true, reasoningEffort: 'high' };
  const modelReasoning = getModelReasoning(config, { effort: { supported_levels: ['low', 'max'] } });
  assert.deepEqual(modelReasoning.efforts, ['low', 'max']);
  assert.equal(modelReasoning.defaultEffort, undefined);
  assert.equal(resolveReasoningEffort({ ...config, modelReasoning }), undefined);
  assert.equal(resolveReasoningEffort({ ...config, modelReasoning, reasoningEffort: 'max' }), 'max');

  const unavailable = getModelReasoning(config, { effort: { supported_levels: [] } });
  assert.equal(resolveReasoningEffort({ ...config, modelReasoning: unavailable }), undefined);
});
