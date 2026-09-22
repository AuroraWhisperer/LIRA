'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');
const { createQWeatherTool } = require('../src/ai/tools/qweather-tool');
const { createAmapTool } = require('../src/ai/tools/amap-tool');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('DeepSeek reports a length-truncated empty Chat Completions response precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () =>
      jsonResponse({
        choices: [
          {
            message: { content: '', reasoning_content: 'still thinking' },
            finish_reason: 'length',
          },
        ],
      }),
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://api.deepseek.com',
        deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash',
        requestTimeoutMs: 3000,
      },
      input: '南阳怎么去加州最快',
      tools: [],
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED',
  );
});

test('DeepSeek reports an incomplete Responses API output precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () =>
      jsonResponse({
        id: 'resp_incomplete',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      }),
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://gateway.example.test/responses',
        deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash',
        requestTimeoutMs: 3000,
      },
      instructions: 'very long system prompt',
      input: 'route question',
      tools: [],
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED',
  );
});

test('DeepSeek reports truncated Responses tool arguments precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () =>
      jsonResponse({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_route',
            arguments: '{"origin":"太原',
          },
        ],
      }),
  });
  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://gateway.example.test/responses',
        deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash',
        requestTimeoutMs: 3000,
      },
      input: 'route question',
      tools: [],
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED',
  );
});

test('DeepSeek success logs retain metrics without request or response content', async () => {
  const events = [];
  const client = createDeepSeekClient({
    logEvent: async (event) => events.push(event),
    fetchImpl: async () =>
      jsonResponse({
        choices: [{ message: { content: 'PRIVATE MODEL ANSWER' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
  });
  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com',
      deepseekApiKey: 'secret',
      model: 'deepseek-chat',
      requestTimeoutMs: 3000,
    },
    instructions: 'PRIVATE PRESET SHOULD NOT BE LOGGED',
    input: 'PRIVATE USER PROMPT',
    tools: [],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'request_succeeded');
  assert.equal(events[0].provider, 'deepseek');
  assert.equal(events[0].model, 'deepseek-chat');
  assert.equal(events[0].protocol, 'chat_completions');
  assert.equal(events[0].inputTokens, 7);
  assert.equal(events[0].outputTokens, 3);
  assert.equal(events[0].functionCallCount, 0);
  assert.ok(events[0].durationMs >= 0);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /PRIVATE PRESET/);
  assert.doesNotMatch(serialized, /PRIVATE USER PROMPT/);
  assert.doesNotMatch(serialized, /PRIVATE MODEL ANSWER/);
  assert.doesNotMatch(serialized, /"(?:body|payload|rawText|result)"/);
});

test('DeepSeek reports length-truncated tool arguments instead of generic invalid JSON', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'search_places',
                    arguments: '{"keywords":"酒店","district":"宛城区"',
                  },
                },
              ],
            },
            finish_reason: 'length',
          },
        ],
      }),
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://api.deepseek.com',
        deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash',
        requestTimeoutMs: 3000,
      },
      input: '白河湿地公园附近酒店',
      tools: [],
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED',
  );
});

test('DeepSeek chat adapter exposes web search as a local function tool', async () => {
  let body;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({
        choices: [
          {
            message: { content: '当前接口无法联网查询航班。' },
            finish_reason: 'stop',
          },
        ],
      });
    },
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com',
      deepseekApiKey: 'secret',
      model: 'deepseek-v4-flash',
      requestTimeoutMs: 3000,
    },
    instructions: '航班必须使用 web_search。',
    input: '南阳怎么去加州最快',
    tools: [{ type: 'web_search' }],
  });

  assert.doesNotMatch(body.messages[0].content, /当前接口不支持 web_search/);
  assert.deepEqual(body.tools[0], {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        '联网搜索最新网页信息，必须用于美食小吃饮料推荐、特产、菜单价格、新闻、演唱会、车次、航班等时效性问题。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      strict: true,
    },
  });
});

test('DeepSeek client emits one metadata-only success event', async () => {
  const events = [];
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({ id: 'resp_1', output_text: 'ok' }),
    logEvent: async (event, options) => events.push({ event, options }),
  });
  const config = {
    deepseekResponsesUrl: 'https://gateway.example.test/responses',
    deepseekApiKey: 'secret-key',
    model: 'custom-model',
    requestTimeoutMs: 3000,
  };

  await client.createResponse({
    config,
    purpose: 'generation',
    input: 'hello',
  });

  assert.deepEqual(
    events.map(({ event }) => event.type),
    ['request_succeeded'],
  );
  assert.equal(events[0].event.purpose, 'generation');
  assert.equal(events[0].event.provider, 'custom');
  assert.equal(events[0].event.status, 200);
  assert.equal(events[0].event.model, 'custom-model');
  assert.equal(events[0].event.protocol, 'responses');
  assert.equal(events[0].event.functionCallCount, 0);
  assert.doesNotMatch(JSON.stringify(events), /"(?:body|payload|rawText|result)"/);
  assert.deepEqual(events[0].options.secrets, ['secret-key']);
});

test('DeepSeek client emits one safe failure event at the owning boundary', async () => {
  const events = [];
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({ error: { code: 'UPSTREAM_DOWN', detail: 'PRIVATE RESPONSE BODY' } }, 502),
    logEvent: async (event) => events.push(event),
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://gateway.example.test/responses',
        deepseekApiKey: 'secret-key',
        model: 'custom-model',
        requestTimeoutMs: 3000,
      },
      purpose: 'generation',
      input: 'PRIVATE USER PROMPT',
    }),
    (error) => error.code === 'UPSTREAM_DOWN',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'request_failed');
  assert.equal(events[0].status, 502);
  assert.equal(events[0].error.code, 'UPSTREAM_DOWN');
  assert.doesNotMatch(
    JSON.stringify(events),
    /PRIVATE RESPONSE BODY|PRIVATE USER PROMPT|"(?:body|payload|rawText|result)"/,
  );
});

test('DeepSeek connection test keeps a complete Responses API URL unchanged', async () => {
  let capturedUrl;
  const client = createDeepSeekClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ id: 'resp_1', output_text: 'ok' });
    },
  });

  const result = await client.testConnection({
    deepseekResponsesUrl: 'https://gateway.example.test/responses',
    deepseekApiKey: 'secret',
    model: 'custom-model',
    requestTimeoutMs: 3000,
  });

  assert.equal(capturedUrl, 'https://gateway.example.test/responses');
  assert.deepEqual(result, {
    provider: 'deepseek',
    model: 'custom-model',
    reply: 'ok',
    endpointAdapted: false,
  });
});

test('model client derives and sanitizes model listings from the configured API', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return jsonResponse({
        data: [
          { id: 'deepseek-v4-pro' },
          { id: 'deepseek-v4-flash' },
          { id: 'deepseek-v4-pro' },
          { id: '' },
          { id: 'x'.repeat(81) },
          { id: 42 },
        ],
      });
    },
  });

  const result = await client.listModels({
    apiKey: 'temporary-secret',
    responsesUrl: 'https://gateway.example.test/openai/v1/responses?ignored=true',
    requestTimeoutMs: 3000,
  });

  assert.equal(captured.url, 'https://gateway.example.test/openai/v1/models');
  assert.equal(captured.options.headers.Authorization, 'Bearer temporary-secret');
  assert.doesNotMatch(captured.url, /temporary-secret/);
  assert.deepEqual(result.models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('provider connection tests validate successful responses', async () => {
  const qweather = createQWeatherTool({
    fetchImpl: async () =>
      jsonResponse({
        code: '200',
        location: [{ id: '101010100', name: '北京' }],
      }),
    quotaStore: { consume: () => ({ allowed: true }) },
  });
  assert.deepEqual(
    await qweather.testConnection({
      qweatherApiHost: 'https://weather.test',
      qweatherApiKey: 'weather-secret',
      requestTimeoutMs: 3000,
    }),
    { provider: 'qweather' },
  );

  const amap = createAmapTool({
    fetchImpl: async () => jsonResponse({ status: '1', geocodes: [{ location: '116.397,39.908' }] }),
    quotaStore: { consume: () => ({ allowed: true }) },
  });
  assert.deepEqual(
    await amap.testConnection({
      amapApiHost: 'https://amap.test',
      amapApiKey: 'amap-secret',
      requestTimeoutMs: 3000,
    }),
    { provider: 'amap' },
  );
});

test('provider connection tests distinguish missing fields and rejected keys', async () => {
  const qweather = createQWeatherTool({
    fetchImpl: async () => jsonResponse({ code: '401' }),
    quotaStore: { consume: () => ({ allowed: true }) },
  });
  await assert.rejects(qweather.testConnection({}), (error) => error.code === 'QWEATHER_HOST_MISSING');
  await assert.rejects(
    qweather.testConnection({ qweatherApiHost: 'https://weather.test' }),
    (error) => error.code === 'QWEATHER_KEY_MISSING',
  );
  await assert.rejects(
    qweather.testConnection({
      qweatherApiHost: 'https://weather.test',
      qweatherApiKey: 'bad',
    }),
    (error) => error.code === 'QWEATHER_AUTH_FAILED',
  );

  const amap = createAmapTool({
    fetchImpl: async () => jsonResponse({ status: '0', infocode: '10001' }),
    quotaStore: { consume: () => ({ allowed: true }) },
  });
  await assert.rejects(amap.testConnection({}), (error) => error.code === 'AMAP_HOST_MISSING');
  await assert.rejects(
    amap.testConnection({ amapApiHost: 'https://amap.test' }),
    (error) => error.code === 'AMAP_KEY_MISSING',
  );
  await assert.rejects(
    amap.testConnection({
      amapApiHost: 'https://amap.test',
      amapApiKey: 'bad',
    }),
    (error) => error.code === 'AMAP_AUTH_FAILED',
  );
});
