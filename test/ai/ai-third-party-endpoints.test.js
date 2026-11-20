'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient } = require('../../src/ai/model-client');

test('third-party GPT reasoning uses known tiers and sends the selected mode in either protocol', async () => {
  const requests = [];
  const client = createModelClient({ fetchImpl: async (url, options) => {
    if (!options.body) return jsonResponse({ data: [{ id: 'gpt-6.1-sol' }] });
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return jsonResponse({ output_text: 'ok', choices: [{ message: { content: 'ok' } }] });
  } });
  const config = { modelProvider: 'custom', deepseekResponsesUrl: 'https://gateway.example.test/',
    modelApiProtocol: 'auto', deepseekApiKey: 'fixture-key', model: 'gpt-6.1-sol',
    reasoningEnabled: true, reasoningEffort: 'high' };
  const catalog = await client.listModels({ modelProvider: config.modelProvider,
    responsesUrl: config.deepseekResponsesUrl, apiKey: config.deepseekApiKey });
  assert.ok(catalog.modelReasoning?.[config.model]?.efforts.includes('high'));
  await client.createResponse({ config, input: 'hello' });
  assert.equal(requests.at(-1).body.reasoning_effort, 'high');
  await client.createResponse({ config: { ...config, reasoningEnabled: false }, input: 'hello' });
  assert.equal(requests.at(-1).body.reasoning_effort, 'low');
  await client.createResponse({ config: { ...config, modelProvider: 'auto', model: 'gpt-6-sol', reasoningEnabled: false }, input: 'hello' });
  assert.equal(requests.at(-1).body.reasoning_effort, 'none');
  await client.createResponse({ config: { ...config, modelApiProtocol: 'responses' }, input: 'hello' });
  assert.equal(requests.at(-1).body.reasoning.effort, 'high');
});

test('third-party catalog overrides known GPT tiers, including explicit removal of effort control', async () => {
  let levels = ['none', 'high'];
  let body;
  const client = createModelClient({ fetchImpl: async (_url, options) => {
    if (!options.body) return jsonResponse({ data: [{ id: 'gpt-6.1-sol', supported_reasoning_levels: levels,
      default_reasoning_level: 'high' }] });
    body = JSON.parse(options.body);
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  } });
  const config = { modelProvider: 'custom', deepseekResponsesUrl: 'https://gateway.example.test/',
    deepseekApiKey: 'fixture-key', model: 'gpt-6.1-sol', reasoningEnabled: false, reasoningEffort: 'high' };
  const refresh = () => client.listModels({ modelProvider: config.modelProvider,
    responsesUrl: config.deepseekResponsesUrl, apiKey: config.deepseekApiKey });
  await refresh();
  await client.createResponse({ config, input: 'hello' });
  assert.equal(body.reasoning_effort, 'none');
  levels = [];
  await refresh();
  await client.createResponse({ config, input: 'hello' });
  assert.equal(body.reasoning_effort, undefined);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

for (const [configuredUrl, expectedUrl] of [
  ['https://gcli.ggchan.dev/', 'https://gcli.ggchan.dev/v1/chat/completions'],
  ['https://gcli.ggchan.dev/v1', 'https://gcli.ggchan.dev/v1/chat/completions'],
]) {
  test(`third-party OpenAI base ${configuredUrl} uses Chat Completions`, async () => {
    let captured;
    const client = createModelClient({
      fetchImpl: async (url, options) => {
        captured = { url: String(url), body: JSON.parse(options.body) };
        return jsonResponse({
          id: 'chatcmpl-third-party',
          object: 'chat.completion',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '第三方接口连接正常',
                reasoning_content: 'extra provider field',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 8 },
        });
      },
    });

    const result = await client.createResponse({
      config: {
        deepseekResponsesUrl: configuredUrl,
        deepseekApiKey: 'temporary-test-key',
        model: 'agy-gemini-3.7-flash-medium',
        requestTimeoutMs: 3000,
        reasoningEnabled: false,
      },
      instructions: '简短回复。',
      input: '你好',
      tools: [],
      maxOutputTokens: 128,
    });

    assert.equal(captured.url, expectedUrl);
    assert.equal(captured.body.stream, false);
    assert.equal(captured.body.thinking, undefined);
    assert.equal(result.text, '第三方接口连接正常');
  });
}

test('complete third-party Chat Completions URL remains unchanged', async () => {
  let capturedUrl;
  const client = createModelClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });

  const result = await client.testConnection({
    deepseekResponsesUrl: 'https://gateway.example.test/openai/v1/chat/completions',
    deepseekApiKey: 'temporary-test-key',
    model: 'custom-model',
    requestTimeoutMs: 3000,
  });

  assert.equal(capturedUrl, 'https://gateway.example.test/openai/v1/chat/completions');
  assert.equal(result.endpointAdapted, true);
});

test('third-party site root derives the conventional v1 models endpoint', async () => {
  let capturedUrl;
  const client = createModelClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ data: [{ id: 'custom-model' }] });
    },
  });

  const result = await client.listModels({
    apiKey: 'temporary-test-key',
    responsesUrl: 'https://gcli.ggchan.dev/',
    requestTimeoutMs: 3000,
  });

  assert.equal(capturedUrl, 'https://gcli.ggchan.dev/v1/models');
  assert.deepEqual(result.models, ['custom-model']);
});

test('explicit Responses protocol adapts a third-party root and sends reasoning effort', async () => {
  let captured;
  const client = createModelClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ id: 'resp_custom', output_text: 'ok' });
    },
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://www.aiyoyoo.com',
      modelApiProtocol: 'responses',
      deepseekApiKey: 'temporary-test-key',
      model: 'gpt-5.6-sol',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000,
    },
    instructions: '简短回复。',
    input: '你好',
    tools: [],
  });

  assert.equal(captured.url, 'https://www.aiyoyoo.com/v1/responses');
  assert.deepEqual(captured.body.reasoning, { effort: 'high' });
  assert.equal(captured.body.messages, undefined);
});

test('unrecognized third-party Chat models retain parameter omission', async () => {
  let captured;
  const client = createModelClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://gateway.example.test',
      modelApiProtocol: 'chat_completions',
      deepseekApiKey: 'temporary-test-key',
      model: 'custom-reasoning-model',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000,
    },
    input: '你好',
    tools: [],
  });

  assert.equal(captured.url, 'https://gateway.example.test/v1/chat/completions');
  assert.equal(captured.body.reasoning, undefined);
  assert.equal(captured.body.reasoning_effort, undefined);
  assert.equal(captured.body.thinking, undefined);
});
