'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');
const { getCurrentTime } = require('../src/ai/tools/current-time-tool');
const { createQWeatherTool } = require('../src/ai/tools/qweather-tool');
const { createAmapTool } = require('../src/ai/tools/amap-tool');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('DeepSeek client sends Responses request with hosted search and no reasoning effort', async () => {
  let captured;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return jsonResponse({ id: 'resp_1', output_text: '连接正常', usage: { input_tokens: 2, output_tokens: 2 } });
    }
  });
  const result = await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://example.test/responses', deepseekApiKey: 'secret',
      model: 'ds-v4-flash', reasoningEnabled: false, requestTimeoutMs: 3000
    },
    instructions: 'system', input: 'hello', tools: [{ type: 'web_search' }]
  });
  assert.equal(captured.url, 'https://example.test/responses');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(captured.body.tools, [{ type: 'web_search' }]);
  assert.deepEqual(captured.body.reasoning, { effort: 'none' });
  assert.equal(result.text, '连接正常');
});

test('DeepSeek client parses function calls from Responses output', async () => {
  const client = createDeepSeekClient({ fetchImpl: async () => jsonResponse({
    id: 'resp_tool',
    output: [{ type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"location":"苏州","date":"today","dataType":"weather"}' }]
  }) });
  const result = await client.createResponse({
    config: { deepseekResponsesUrl: 'https://example.test/responses', deepseekApiKey: 'x', model: 'm', requestTimeoutMs: 3000 },
    input: '天气', tools: []
  });
  assert.deepEqual(result.functionCalls[0].arguments, { location: '苏州', date: 'today', dataType: 'weather' });
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
        choices: [{ message: {
          content: '苏州今天晴',
          tool_calls: [{
            id: 'call_1', type: 'function',
            function: { name: 'get_weather', arguments: '{"location":"苏州"}' }
          }]
        } }],
        usage: { prompt_tokens: 12, completion_tokens: 8 }
      });
    }
  });
  const config = {
    deepseekResponsesUrl: 'https://api.deepseek.com',
    deepseekApiKey: 'secret',
    model: 'deepseek-chat',
    requestTimeoutMs: 3000
  };

  const testResult = await client.testConnection(config);
  const response = await client.createResponse({
    config,
    instructions: 'system',
    input: 'hello',
    tools: [{
      type: 'function', name: 'get_weather', description: 'weather',
      parameters: { type: 'object', properties: {} }, strict: true
    }]
  });

  assert.deepEqual(testResult, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    reply: 'ok',
    endpointAdapted: true
  });
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(requests[0].body.messages[0], { role: 'user', content: '你好' });
  assert.equal(requests[0].body.max_tokens, 128);
  assert.equal(requests[1].url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(requests[1].body.messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'hello' }
  ]);
  assert.deepEqual(requests[1].body.tools[0], {
    type: 'function',
    function: {
      name: 'get_weather', description: 'weather',
      parameters: { type: 'object', properties: {} }, strict: true
    }
  });
  assert.equal(response.text, '苏州今天晴');
  assert.deepEqual(response.functionCalls, [{
    callId: 'call_1', name: 'get_weather', arguments: { location: '苏州' }
  }]);
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
          choices: [{ message: {
            content: null,
            tool_calls: [{
              id: 'call_1', type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"苏州"}' }
            }]
          } }]
        });
      }
      return jsonResponse({ id: 'chat_answer', choices: [{ message: { content: '苏州今天晴' } }] });
    }
  });
  const config = {
    deepseekResponsesUrl: 'https://api.deepseek.com/v1/chat/completions',
    deepseekApiKey: 'secret', model: 'deepseek-chat', requestTimeoutMs: 3000
  };

  const first = await client.createResponse({ config, instructions: 'system', input: '苏州天气', tools: [] });
  const second = await client.createResponse({
    config,
    previousResponseId: first.id,
    input: [{ type: 'function_call_output', call_id: 'call_1', output: '{"temp":"25"}' }],
    tools: []
  });

  assert.ok(requests.every(({ url }) => url === 'https://api.deepseek.com/v1/chat/completions'));
  assert.deepEqual(requests[1].body.messages.slice(-2), [
    {
      role: 'assistant', content: null,
      tool_calls: [{
        id: 'call_1', type: 'function',
        function: { name: 'get_weather', arguments: '{"location":"苏州"}' }
      }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"temp":"25"}' }
  ]);
  assert.equal(second.text, '苏州今天晴');
});

test('DeepSeek reports a length-truncated empty Chat Completions response precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: '', reasoning_content: 'still thinking' }, finish_reason: 'length' }]
    })
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://api.deepseek.com', deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash', requestTimeoutMs: 3000
      },
      input: '南阳怎么去加州最快', tools: []
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED'
  );
});

test('DeepSeek reports length-truncated tool arguments instead of generic invalid JSON', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1', type: 'function',
            function: { name: 'search_places', arguments: '{"keywords":"酒店","district":"宛城区"' }
          }]
        },
        finish_reason: 'length'
      }]
    })
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://api.deepseek.com', deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash', requestTimeoutMs: 3000
      },
      input: '白河湿地公园附近酒店', tools: []
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED'
  );
});

test('DeepSeek chat adapter tells the model when hosted web search is unavailable', async () => {
  let body;
  const client = createDeepSeekClient({
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: '当前接口无法联网查询航班。' }, finish_reason: 'stop' }] });
    }
  });

  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com', deepseekApiKey: 'secret',
      model: 'deepseek-v4-flash', requestTimeoutMs: 3000
    },
    instructions: '航班必须使用 web_search。', input: '南阳怎么去加州最快',
    tools: [{ type: 'web_search' }]
  });

  assert.match(body.messages[0].content, /当前接口不支持 web_search/);
  assert.doesNotMatch(JSON.stringify(body.tools || []), /web_search/);
});

test('DeepSeek client traces request, raw response, normalized response, and errors', async () => {
  const events = [];
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({ id: 'resp_1', output_text: 'ok' }),
    logEvent: async (event, options) => events.push({ event, options })
  });
  const config = {
    deepseekResponsesUrl: 'https://gateway.example.test/responses',
    deepseekApiKey: 'secret-key', model: 'custom-model', requestTimeoutMs: 3000
  };

  await client.createResponse({ config, purpose: 'generation', input: 'hello' });

  assert.deepEqual(events.map(({ event }) => event.type), [
    'request', 'response', 'normalized_response'
  ]);
  assert.equal(events[0].event.purpose, 'generation');
  assert.equal(events[0].event.requestId, events[1].event.requestId);
  assert.equal(events[1].event.status, 200);
  assert.equal(events[1].event.payload.output_text, 'ok');
  assert.equal(events[2].event.result.text, 'ok');
  assert.deepEqual(events[0].options.secrets, ['secret-key']);
});

test('DeepSeek connection test keeps a complete Responses API URL unchanged', async () => {
  let capturedUrl;
  const client = createDeepSeekClient({
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse({ id: 'resp_1', output_text: 'ok' });
    }
  });

  const result = await client.testConnection({
    deepseekResponsesUrl: 'https://gateway.example.test/responses',
    deepseekApiKey: 'secret',
    model: 'custom-model',
    requestTimeoutMs: 3000
  });

  assert.equal(capturedUrl, 'https://gateway.example.test/responses');
  assert.deepEqual(result, {
    provider: 'deepseek', model: 'custom-model', reply: 'ok', endpointAdapted: false
  });
});

test('DeepSeek client lists sanitized official model ids', async () => {
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
          { id: 42 }
        ]
      });
    }
  });

  const result = await client.listModels({ apiKey: 'temporary-secret', requestTimeoutMs: 3000 });

  assert.equal(captured.url, 'https://api.deepseek.com/models');
  assert.equal(captured.options.headers.Authorization, 'Bearer temporary-secret');
  assert.doesNotMatch(captured.url, /temporary-secret/);
  assert.deepEqual(result.models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('provider connection tests validate successful responses', async () => {
  const qweather = createQWeatherTool({
    fetchImpl: async () => jsonResponse({ code: '200', location: [{ id: '101010100', name: '北京' }] }),
    quotaStore: { consume: () => ({ allowed: true }) }
  });
  assert.deepEqual(await qweather.testConnection({
    qweatherApiHost: 'https://weather.test', qweatherApiKey: 'weather-secret', requestTimeoutMs: 3000
  }), { provider: 'qweather' });

  const amap = createAmapTool({
    fetchImpl: async () => jsonResponse({ status: '1', geocodes: [{ location: '116.397,39.908' }] }),
    quotaStore: { consume: () => ({ allowed: true }) }
  });
  assert.deepEqual(await amap.testConnection({
    amapApiHost: 'https://amap.test', amapApiKey: 'amap-secret', requestTimeoutMs: 3000
  }), { provider: 'amap' });
});

test('provider connection tests distinguish missing fields and rejected keys', async () => {
  const qweather = createQWeatherTool({
    fetchImpl: async () => jsonResponse({ code: '401' }),
    quotaStore: { consume: () => ({ allowed: true }) }
  });
  await assert.rejects(qweather.testConnection({}), (error) => error.code === 'QWEATHER_HOST_MISSING');
  await assert.rejects(
    qweather.testConnection({ qweatherApiHost: 'https://weather.test' }),
    (error) => error.code === 'QWEATHER_KEY_MISSING'
  );
  await assert.rejects(
    qweather.testConnection({ qweatherApiHost: 'https://weather.test', qweatherApiKey: 'bad' }),
    (error) => error.code === 'QWEATHER_AUTH_FAILED'
  );

  const amap = createAmapTool({
    fetchImpl: async () => jsonResponse({ status: '0', infocode: '10001' }),
    quotaStore: { consume: () => ({ allowed: true }) }
  });
  await assert.rejects(amap.testConnection({}), (error) => error.code === 'AMAP_HOST_MISSING');
  await assert.rejects(
    amap.testConnection({ amapApiHost: 'https://amap.test' }),
    (error) => error.code === 'AMAP_KEY_MISSING'
  );
  await assert.rejects(
    amap.testConnection({ amapApiHost: 'https://amap.test', amapApiKey: 'bad' }),
    (error) => error.code === 'AMAP_AUTH_FAILED'
  );
});

test('current time tool uses IANA timezone without an external API', () => {
  const result = getCurrentTime({ timeZone: 'Asia/Shanghai' }, { now: '2026-08-06T04:00:00.000Z' });
  assert.equal(result.timeZone, 'Asia/Shanghai');
  assert.match(result.formatted, /12:00:00/);
  assert.throws(() => getCurrentTime({ timeZone: 'Not/AZone' }), /时区/);
});

test('QWeather does not send a request after its monthly quota is exhausted', async () => {
  let fetchCalls = 0;
  const tool = createQWeatherTool({
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); },
    quotaStore: { consume: () => ({ allowed: false }) }
  });
  await assert.rejects(
    tool.getWeather({ qweatherApiHost: 'https://weather.test', qweatherApiKey: 'key' }, { location: '苏州' }),
    (error) => error.code === 'QWEATHER_MONTHLY_LIMIT'
  );
  assert.equal(fetchCalls, 0);
});

test('AMap separates search and LBS quota categories before sending requests', async () => {
  const categories = [];
  let fetchCalls = 0;
  const tool = createAmapTool({
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ status: '1', pois: [] }); },
    quotaStore: {
      consume(category) {
        categories.push(category);
        return { allowed: category !== 'amap_search' };
      }
    }
  });
  await assert.rejects(
    tool.searchPlaces({ amapApiHost: 'https://amap.test', amapApiKey: 'key' }, { keywords: '餐厅' }),
    (error) => error.code === 'AMAP_SEARCH_MONTHLY_LIMIT'
  );
  assert.deepEqual(categories, ['amap_search']);
  assert.equal(fetchCalls, 0);
});
