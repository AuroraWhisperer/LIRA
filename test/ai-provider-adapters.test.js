'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('DeepSeek client sends Responses request with hosted search and no reasoning effort', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return jsonResponse({
        id: 'resp_1',
        output_text: '连接正常',
        usage: { input_tokens: 2, output_tokens: 2 },
      });
    },
  });
  const result = await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://example.test/responses',
      deepseekApiKey: 'secret',
      model: 'ds-v4-flash',
      reasoningEnabled: false,
      requestTimeoutMs: 3000,
    },
    instructions: 'system',
    input: 'hello',
    tools: [{ type: 'web_search' }],
  });
  assert.equal(captured.url, 'https://example.test/responses');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(captured.body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(captured.body.reasoning, { effort: 'none' });
  assert.equal(result.text, '连接正常');
});

test('DeepSeek preserves the AI shutdown cancellation reason', async () => {
  const controller = new AbortController();
  const shutdownError = new Error('AI service is shutting down.');
  shutdownError.code = 'AI_SHUTDOWN';
  const client = createDeepSeekClient({
    fetchImpl: async (_url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }),
  });
  const request = client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://example.test/responses',
      deepseekApiKey: 'secret',
      model: 'ds-v4-flash',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
    signal: controller.signal,
  });

  controller.abort(shutdownError);

  await assert.rejects(request, (error) => error === shutdownError);
});

test('DeepSeek client parses function calls from Responses output', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () =>
      jsonResponse({
        id: 'resp_tool',
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_weather',
            arguments: '{"location":"苏州","date":"today","dataType":"weather"}',
          },
        ],
      }),
  });
  const result = await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://example.test/responses',
      deepseekApiKey: 'x',
      model: 'm',
      requestTimeoutMs: 3000,
    },
    input: '天气',
    tools: [],
  });
  assert.deepEqual(result.functionCalls[0].arguments, {
    location: '苏州',
    date: 'today',
    dataType: 'weather',
  });
});

test('DeepSeek official base uses Chat Completions for connection tests and normal requests', async () => {
  const requests = [];
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      if (requests.length === 1) {
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      }
      return jsonResponse({
        id: 'chat_1',
        choices: [
          {
            message: {
              content: '苏州今天晴',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"苏州"}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      });
    },
  });
  const config = {
    deepseekResponsesUrl: 'https://api.deepseek.com',
    deepseekApiKey: 'secret',
    model: 'deepseek-chat',
    requestTimeoutMs: 3000,
  };

  const testResult = await client.testConnection(config);
  const response = await client.createResponse({
    config,
    instructions: 'system',
    input: 'hello',
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'weather',
        parameters: { type: 'object', properties: {} },
        strict: true,
      },
    ],
  });

  assert.deepEqual(testResult, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    reply: 'ok',
    endpointAdapted: true,
  });
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(requests[0].body.messages[0], {
    role: 'user',
    content: '你好',
  });
  assert.equal(requests[0].body.max_tokens, 128);
  assert.equal(requests[1].url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(requests[1].body.messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'hello' },
  ]);
  assert.deepEqual(requests[1].body.thinking, { type: 'disabled' });
  assert.deepEqual(requests[1].body.tools[0], {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'weather',
      parameters: { type: 'object', properties: {} },
      strict: true,
    },
  });
  assert.equal(response.text, '苏州今天晴');
  assert.deepEqual(response.functionCalls, [
    {
      callId: 'call_1',
      name: 'get_weather',
      arguments: { location: '苏州' },
    },
  ]);
  assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 8 });
});

test('DeepSeek official Chat Completions URL remains usable and carries tool results forward', async () => {
  const requests = [];
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      if (requests.length === 1) {
        return jsonResponse({
          id: 'chat_tool',
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"苏州"}',
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({
        id: 'chat_answer',
        choices: [{ message: { content: '苏州今天晴' } }],
      });
    },
  });
  const config = {
    deepseekResponsesUrl: 'https://api.deepseek.com/v1/chat/completions',
    deepseekApiKey: 'secret',
    model: 'deepseek-chat',
    requestTimeoutMs: 3000,
  };

  const first = await client.createResponse({
    config,
    instructions: 'system',
    input: '苏州天气',
    tools: [],
  });
  const second = await client.createResponse({
    config,
    previousResponseId: first.id,
    input: [
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"temp":"25"}',
      },
    ],
    tools: [],
  });

  assert.ok(requests.every(({ url }) => url === 'https://api.deepseek.com/v1/chat/completions'));
  assert.deepEqual(requests[1].body.messages.slice(-2), [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"location":"苏州"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"temp":"25"}' },
  ]);
  assert.equal(second.text, '苏州今天晴');
});

test('DeepSeek official Chat enables thinking and sends the selected reasoning effort', async () => {
  let capturedBody;
  const client = createDeepSeekClient({
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com',
      deepseekApiKey: 'secret',
      model: 'deepseek-v4-pro',
      reasoningEnabled: true,
      reasoningEffort: 'max',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
  });

  assert.deepEqual(capturedBody.thinking, { type: 'enabled' });
  assert.equal(capturedBody.reasoning_effort, 'max');
});

test('DeepSeek official Responses API uses its root path and mapped reasoning effort', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ id: 'resp_ds', output_text: 'ok' });
    },
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com',
      modelApiProtocol: 'responses',
      deepseekApiKey: 'secret',
      model: 'deepseek-v4-pro',
      reasoningEnabled: true,
      reasoningEffort: 'medium',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
  });

  assert.equal(captured.url, 'https://api.deepseek.com/responses');
  assert.deepEqual(captured.body.reasoning, { effort: 'high' });
});

test('OpenAI provider preset fixes the official Responses endpoint', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ id: 'resp_openai', output_text: 'ok' });
    },
  });

  await client.createResponse({
    config: {
      modelProvider: 'openai',
      deepseekResponsesUrl: 'https://untrusted.example.test',
      modelApiProtocol: 'chat_completions',
      deepseekApiKey: 'secret',
      model: 'gpt-test',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
  });

  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(captured.body.reasoning, { effort: 'high' });
});

test('Claude provider preset uses the official OpenAI compatibility endpoint', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });

  await client.createResponse({
    config: {
      modelProvider: 'anthropic',
      deepseekApiKey: 'secret',
      model: 'claude-test',
      reasoningEnabled: true,
      reasoningEffort: 'high',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
  });

  assert.equal(captured.url, 'https://api.anthropic.com/v1/chat/completions');
  assert.equal(captured.body.reasoning, undefined);
  assert.equal(captured.body.reasoning_effort, undefined);
  assert.equal(captured.body.thinking, undefined);
});

test('Gemini provider preset uses the official compatibility endpoint and reasoning effort', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    },
  });

  await client.createResponse({
    config: {
      modelProvider: 'gemini',
      deepseekApiKey: 'secret',
      model: 'gemini-test',
      reasoningEnabled: true,
      reasoningEffort: 'xhigh',
      requestTimeoutMs: 3000,
    },
    input: 'hello',
  });

  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(captured.body.reasoning_effort, 'high');
  assert.equal(captured.body.thinking, undefined);
});
