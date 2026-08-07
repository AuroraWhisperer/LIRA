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
  assert.deepEqual(requests[1].body.thinking, { type: 'disabled' });
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

test('DeepSeek reports an incomplete Responses API output precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({
      id: 'resp_incomplete', status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }, output: []
    })
  });

  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://gateway.example.test/responses', deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash', requestTimeoutMs: 3000
      },
      instructions: 'very long system prompt', input: 'route question', tools: []
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED'
  );
});

test('DeepSeek reports truncated Responses tool arguments precisely', async () => {
  const client = createDeepSeekClient({
    fetchImpl: async () => jsonResponse({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'function_call', call_id: 'call_1', name: 'get_route', arguments: '{"origin":"太原' }]
    })
  });
  await assert.rejects(
    client.createResponse({
      config: {
        deepseekResponsesUrl: 'https://gateway.example.test/responses', deepseekApiKey: 'secret',
        model: 'deepseek-v4-flash', requestTimeoutMs: 3000
      },
      input: 'route question', tools: []
    }),
    (error) => error.code === 'DEEPSEEK_OUTPUT_TRUNCATED'
  );
});

test('DeepSeek request logs omit the system preset while retaining request metadata', async () => {
  const events = [];
  const client = createDeepSeekClient({
    logEvent: async (event) => events.push(event),
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] })
  });
  await client.createResponse({
    config: {
      deepseekResponsesUrl: 'https://api.deepseek.com', deepseekApiKey: 'secret',
      model: 'deepseek-chat', requestTimeoutMs: 3000
    },
    instructions: 'PRIVATE PRESET SHOULD NOT BE LOGGED', input: 'hello', tools: []
  });
  assert.equal(events[0].body.instructions, undefined);
  assert.equal(events[0].body.messages[0].content, '[system prompt omitted]');
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

test('DeepSeek chat adapter exposes web search as a local function tool', async () => {
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

  assert.doesNotMatch(body.messages[0].content, /当前接口不支持 web_search/);
  assert.deepEqual(body.tools[0], {
    type: 'function',
    function: {
      name: 'web_search',
      description: '联网搜索最新网页信息，必须用于美食小吃饮料推荐、特产、菜单价格、新闻、演唱会、车次、航班等时效性问题。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false
      },
      strict: true
    }
  });
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

test('AMap automatically uses the first matching endpoint and completes the route query', async () => {
  const requestedPaths = [];
  const tool = createAmapTool({
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      requestedPaths.push(parsedUrl.pathname);
      if (parsedUrl.pathname.includes('/direction/')) {
        assert.equal(parsedUrl.searchParams.get('origin'), '112.6,37.7');
        assert.equal(parsedUrl.searchParams.get('destination'), '112.6,37.7');
        return jsonResponse({
          status: '1',
          route: { transits: [{ distance: '16000', duration: '2400' }] }
        });
      }
      return jsonResponse({
        status: '1',
        geocodes: [
          { formatted_address: '太原南站候车厅', location: '112.6,37.7' },
          { formatted_address: '太原南站东广场', location: '112.61,37.71' }
        ]
      });
    },
    quotaStore: { consume: () => ({ allowed: true }) }
  });

  const result = await tool.getRoute(
    { amapApiHost: 'https://amap.test', amapApiKey: 'key', requestTimeoutMs: 3000 },
    { origin: '太原南站', destination: '太原武宿机场', city: '太原', mode: 'transit' }
  );

  assert.equal(result.distanceMeters, 16000);
  assert.equal(result.durationSeconds, 2400);
  assert.deepEqual(result.origin.alternatives, ['太原南站东广场']);
  assert.deepEqual(result.destination.alternatives, ['太原南站东广场']);
  assert.deepEqual(requestedPaths, [
    '/v3/geocode/geo',
    '/v3/geocode/geo',
    '/v3/direction/transit/integrated'
  ]);
});

test('AMap prefers a complete place-name match over an earlier unrelated result', async () => {
  const routeDestinations = [];
  const tool = createAmapTool({
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.includes('/direction/')) {
        routeDestinations.push(parsedUrl.searchParams.get('destination'));
        return jsonResponse({
          status: '1',
          route: { paths: [{ distance: '12000', duration: '1800' }] }
        });
      }
      return jsonResponse({
        status: '1',
        geocodes: parsedUrl.searchParams.get('address') === '苏州园区站'
          ? [
            { formatted_address: '江苏省苏州市常熟市园区站(公交站)', location: '120.886491,31.685435' },
            { formatted_address: '江苏省苏州市吴中区苏州园区站(进站口)', location: '120.710567,31.341312' }
          ]
          : [{ formatted_address: '江苏省苏州市吴中区金鸡湖', location: '120.665152,31.316274' }]
      });
    },
    quotaStore: { consume: () => ({ allowed: true }) }
  });

  const result = await tool.getRoute(
    { amapApiHost: 'https://amap.test', amapApiKey: 'key', requestTimeoutMs: 3000 },
    { origin: '金鸡湖', destination: '苏州园区站', city: '苏州', mode: 'driving' }
  );

  assert.equal(result.destination.location, '120.710567,31.341312');
  assert.deepEqual(routeDestinations, ['120.710567,31.341312']);
});
