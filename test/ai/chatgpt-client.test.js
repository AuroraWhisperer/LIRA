'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatGptClient } = require('../../src/ai/chatgpt-client');
const { createDeepSeekClient } = require('../../src/ai/deepseek-client');

function stream(events) {
  const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.subarray(offset, offset + 7));
    controller.close();
  } }));
}
const completed = output => ({ type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output,
  usage: { input_tokens: 10, output_tokens: 5 } } });
const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '你好' }] };
const config = { modelProvider: 'openai', modelAuthMode: 'subscription', model: 'gpt-fixture', requestTimeoutMs: 3000,
  deepseekApiKey: 'must-not-use-api-key', deepseekResponsesUrl: 'https://attacker.test', modelApiProtocol: 'chat_completions' };
function fixture(fetchImpl) {
  const controller = new AbortController();
  const session = { getSessionRevision: () => 'fixture-session', getStatus: () => ({ ready: true }),
    withAccessToken: async work => work('subscription-token', controller.signal) };
  const logs = [];
  const chatgpt = createChatGptClient({ session, fetchImpl, logEvent: event => logs.push(event) });
  const client = createDeepSeekClient({ chatgpt, fetchImpl: () => assert.fail('subscription must not fall back to API') });
  return { client, logs, session };
}

test('subscription uses the public Responses endpoint and completes the existing response contract', async () => {
  let captured;
  const { client, logs } = fixture(async (url, options) => {
    captured = { url, ...options, body: JSON.parse(options.body) };
    return stream([{ type: 'response.output_text.delta', delta: 'unverified partial' }, completed([message])]);
  });
  const result = await client.createResponse({ config, input: '你好', maxOutputTokens: 128, instructions: 'rules' });
  assert.equal(result.text, '你好');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.headers.Authorization, 'Bearer subscription-token');
  assert.equal(captured.redirect, 'error');
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.stream, true);
  assert.equal(captured.body.max_output_tokens, undefined);
  assert.deepEqual(captured.body.input, [{ role: 'user', content: '你好' }]);
  assert.doesNotMatch(JSON.stringify(logs), /subscription-token|must-not-use-api-key|unverified partial/);
});

test('subscription discovers only visible account models preserving catalog order', async () => {
  const { client } = fixture(async url => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    return new Response(JSON.stringify({ models: [{ slug: 'z-first', visibility: 'list' }, { slug: 'hidden' }, { slug: 'a-second', visibility: 'list' }] }));
  });
  assert.deepEqual(await client.listModels(config), { models: ['z-first', 'a-second'] });
});

test('subscription model discovery does not expose malformed upstream response content', async () => {
  const { client } = fixture(async () => new Response('private-upstream-content'));
  await assert.rejects(client.listModels(config), error => {
    assert.equal(error.code, 'CHATGPT_REQUEST_FAILED');
    assert.doesNotMatch(error.message, /private-upstream-content/);
    return true;
  });
});

test('subscription wraps functions and replays reasoning and tool history without previous_response_id', async () => {
  const bodies = [];
  const output = [{ type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque' },
    { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'get_time', namespace: 'lira', arguments: '{}' }];
  const { client } = fixture(async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return stream([completed(bodies.length === 1 ? output : [message])]);
  });
  const tools = [{ type: 'function', name: 'get_time', parameters: { type: 'object', properties: {} } }];
  const first = await client.createResponse({ config, input: '现在几点', tools });
  const toolOutput = { type: 'function_call_output', call_id: 'call-1', output: '10:00' };
  await client.createResponse({ config, input: [toolOutput], previousResponseId: first.id, tools });
  assert.equal(bodies[0].tools[0].type, 'namespace');
  assert.deepEqual(bodies[0].tools[0].tools, tools);
  assert.equal(bodies[1].previous_response_id, undefined);
  assert.deepEqual(bodies[1].input.slice(1), [...output, toolOutput]);
});

for (const [label, events, code] of [
  ['usage error after partial output', [{ type: 'response.output_text.delta', delta: 'partial' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }], 'CHATGPT_USAGE_LIMIT'],
  ['interrupted stream', [{ type: 'response.output_text.delta', delta: 'partial' }], 'CHATGPT_RESPONSE_INCOMPLETE'],
  ['incomplete response', [{ type: 'response.incomplete', response: { output: [message] } }], 'CHATGPT_RESPONSE_INCOMPLETE'],
]) {
  test(`subscription rejects ${label} without API fallback`, async () => {
    const { client } = fixture(async () => stream(events));
    await assert.rejects(client.createResponse({ config, input: '你好' }), { code });
  });
}
