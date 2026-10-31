'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient } = require('../../src/ai/model-client');

test('Kimi preset discovers official models and keeps thinking content across tool calls', async () => {
  const requests = [];
  const client = createModelClient({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), body: options.body && JSON.parse(options.body) });
    if (!options.body) return jsonResponse({ data: [{ id: 'kimi-k2.6' }] });
    return jsonResponse({ id: `kimi-${requests.length}`, choices: [{ message: requests.length === 2
      ? { content: null, reasoning_content: 'fixture thinking', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_time', arguments: '{}' } }] }
      : { content: '你好' } }] });
  } });
  const config = { modelProvider: 'kimi', model: 'kimi-k2.6', deepseekApiKey: 'fixture-key', reasoningEnabled: true };
  assert.deepEqual(await client.listModels({ ...config, apiKey: 'fixture-key' }), { models: ['kimi-k2.6'] });
  const response = await client.createResponse({ config, input: '几点了' });
  await client.createResponse({ config, previousResponseId: response.id, input: [{ type: 'function_call_output', call_id: 'call-1', output: '10:00' }] });
  assert.equal(requests[0].url, 'https://api.moonshot.cn/v1/models');
  assert.equal(requests[1].url, 'https://api.moonshot.cn/v1/chat/completions');
  assert.deepEqual(requests[1].body.thinking, { type: 'enabled' });
  assert.equal(requests[1].body.max_tokens, undefined);
  assert.ok(requests[1].body.max_completion_tokens >= 64);
  assert.equal(requests[2].body.messages.at(-2).reasoning_content, 'fixture thinking');
});

test('Kimi K3 review and connection requests use low thinking with enough generation budget', async () => {
  let body;
  const client = createModelClient({ fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  } });
  const result = await client.testConnection({ modelProvider: 'kimi', model: 'kimi-k3', deepseekApiKey: 'fixture-key', reasoningEnabled: false });
  assert.equal(result.provider, 'kimi');
  assert.equal(body.thinking, undefined);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 4096);
});

for (const { name, modelProvider, responsesUrl, provider } of [
  { name: 'automatic official DeepSeek', modelProvider: 'auto', responsesUrl: 'https://api.deepseek.com', provider: 'deepseek' },
  { name: 'automatic third-party', modelProvider: 'auto', responsesUrl: 'https://models.example.test/v1/responses', provider: 'custom' },
  { name: 'explicit custom', modelProvider: 'custom', responsesUrl: 'https://models.example.test/v1/responses', provider: 'custom' },
]) {
  test(`${name} connection test reports the resolved provider`, async () => {
    const client = createModelClient({ fetchImpl: async () => jsonResponse({
      output_text: 'ok', choices: [{ message: { content: 'ok' } }],
    }) });
    const result = await client.testConnection({ modelProvider, model: 'fixture-model',
      deepseekResponsesUrl: responsesUrl, deepseekApiKey: 'fixture-key', reasoningEnabled: false });
    assert.equal(result.provider, provider);
    assert.equal(result.model, 'fixture-model');
    assert.equal(result.reply, 'ok');
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('DeepSeek client sends Responses request with hosted search and no reasoning effort', async () => {
  let captured;
  const client = createModelClient({
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

for (const code of ['AI_SHUTDOWN', 'AI_DISABLED']) test(`DeepSeek preserves ${code} without failure logging`, async () => {
  const controller = new AbortController();
  const shutdownError = new Error('AI service is shutting down.');
  shutdownError.code = code;
  const logs = [];
  const client = createModelClient({
    logEvent: event => logs.push(event),
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
  assert.deepEqual(logs, []);
});

test('DeepSeek client parses function calls from Responses output', async () => {
  const client = createModelClient({
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
  const client = createModelClient({
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
  const client = createModelClient({
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
  const client = createModelClient({
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
  const client = createModelClient({
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

for (const scenario of [
  {
    name: 'OpenAI',
    config: {
      modelProvider: 'openai',
      deepseekResponsesUrl: 'https://untrusted.example.test',
      modelApiProtocol: 'chat_completions',
      model: 'gpt-test',
      reasoningEffort: 'high',
    },
    response: { id: 'resp_openai', output_text: 'ok' },
    url: 'https://api.openai.com/v1/responses',
    assertBody: (body) => assert.deepEqual(body.reasoning, { effort: 'high' }),
  },
  {
    name: 'Claude',
    config: { modelProvider: 'anthropic', model: 'claude-test', reasoningEffort: 'high' },
    response: { choices: [{ message: { content: 'ok' } }] },
    url: 'https://api.anthropic.com/v1/chat/completions',
    assertBody(body) {
      assert.equal(body.reasoning, undefined);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.thinking, undefined);
    },
  },
  {
    name: 'Gemini',
    config: { modelProvider: 'gemini', model: 'gemini-test', reasoningEffort: 'xhigh' },
    response: { choices: [{ message: { content: 'ok' } }] },
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    assertBody(body) {
      assert.equal(body.reasoning_effort, 'high');
      assert.equal(body.thinking, undefined);
    },
  },
]) {
  test(`${scenario.name} provider preset fixes its official endpoint and reasoning mapping`, async () => {
    let captured;
    const client = createModelClient({
      fetchImpl: async (url, options) => {
        captured = { url: String(url), body: JSON.parse(options.body) };
        return jsonResponse(scenario.response);
      },
    });

    await client.createResponse({
      config: {
        deepseekApiKey: 'secret',
        reasoningEnabled: true,
        requestTimeoutMs: 3000,
        ...scenario.config,
      },
      input: 'hello',
    });

    assert.equal(captured.url, scenario.url);
    scenario.assertBody(captured.body);
  });
}
