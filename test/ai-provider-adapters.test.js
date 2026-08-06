'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');
const { getCurrentTime } = require('../src/ai/tools/current-time-tool');

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

test('current time tool uses IANA timezone without an external API', () => {
  const result = getCurrentTime({ timeZone: 'Asia/Shanghai' }, { now: '2026-08-06T04:00:00.000Z' });
  assert.equal(result.timeZone, 'Asia/Shanghai');
  assert.match(result.formatted, /12:00:00/);
  assert.throws(() => getCurrentTime({ timeZone: 'Not/AZone' }), /时区/);
});
