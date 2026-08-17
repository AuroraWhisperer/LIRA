'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload)
  };
}

for (const [configuredUrl, expectedUrl] of [
  ['https://gcli.ggchan.dev/', 'https://gcli.ggchan.dev/v1/chat/completions'],
  ['https://gcli.ggchan.dev/v1', 'https://gcli.ggchan.dev/v1/chat/completions']
]) {
  test(`third-party OpenAI base ${configuredUrl} uses Chat Completions`, async () => {
    let captured;
    const client = createDeepSeekClient({
      fetchImpl: async (url, options) => {
        captured = { url: String(url), body: JSON.parse(options.body) };
        return jsonResponse({
          id: 'chatcmpl-third-party',
          object: 'chat.completion',
          choices: [{
            message: {
              role: 'assistant',
              content: '第三方接口连接正常',
              reasoning_content: 'extra provider field'
            },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 5, completion_tokens: 8 }
        });
      }
    });

    const result = await client.createResponse({
      config: {
        deepseekResponsesUrl: configuredUrl,
        deepseekApiKey: 'temporary-test-key',
        model: 'agy-gemini-3.7-flash-medium',
        requestTimeoutMs: 3000,
        reasoningEnabled: false
      },
      instructions: '简短回复。',
      input: '你好',
      tools: [],
      maxOutputTokens: 128
    });

    assert.equal(captured.url, expectedUrl);
    assert.equal(captured.body.stream, false);
    assert.equal(captured.body.thinking, undefined);
    assert.deepEqual(captured.body.messages, [
      { role: 'system', content: '简短回复。' },
      { role: 'user', content: '你好' }
    ]);
    assert.equal(result.text, '第三方接口连接正常');
    assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 8 });
  });
}

test('complete third-party Chat Completions URL remains unchanged', async () => {
  let capturedUrl;
  const client = createDeepSeekClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }
  });

  const result = await client.testConnection({
    deepseekResponsesUrl: 'https://gateway.example.test/openai/v1/chat/completions',
    deepseekApiKey: 'temporary-test-key',
    model: 'custom-model',
    requestTimeoutMs: 3000
  });

  assert.equal(capturedUrl, 'https://gateway.example.test/openai/v1/chat/completions');
  assert.equal(result.reply, 'ok');
  assert.equal(result.endpointAdapted, true);
});

test('third-party site root derives the conventional v1 models endpoint', async () => {
  let capturedUrl;
  const client = createDeepSeekClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ data: [{ id: 'custom-model' }] });
    }
  });

  const result = await client.listModels({
    apiKey: 'temporary-test-key',
    responsesUrl: 'https://gcli.ggchan.dev/',
    requestTimeoutMs: 3000
  });

  assert.equal(capturedUrl, 'https://gcli.ggchan.dev/v1/models');
  assert.deepEqual(result.models, ['custom-model']);
});

test('explicit Responses protocol adapts a third-party root and sends reasoning effort', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ id: 'resp_custom', output_text: 'ok' });
    }
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://www.aiyoyoo.com',
      modelApiProtocol: 'responses',
      deepseekApiKey: 'temporary-test-key',
      model: 'gpt-5.6-sol',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000
    },
    instructions: '简短回复。',
    input: '你好',
    tools: []
  });

  assert.equal(captured.url, 'https://www.aiyoyoo.com/v1/responses');
  assert.deepEqual(captured.body.reasoning, { effort: 'high' });
  assert.equal(captured.body.messages, undefined);
});

test('explicit Chat Completions protocol adapts a third-party root without reasoning fields', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://gateway.example.test',
      modelApiProtocol: 'chat_completions',
      deepseekApiKey: 'temporary-test-key',
      model: 'custom-reasoning-model',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000
    },
    input: '你好',
    tools: []
  });

  assert.equal(captured.url, 'https://gateway.example.test/v1/chat/completions');
  assert.equal(captured.body.reasoning, undefined);
  assert.equal(captured.body.thinking, undefined);
});
