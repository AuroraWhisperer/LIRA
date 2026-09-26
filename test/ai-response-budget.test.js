'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchJson } = require('../src/ai/http-client');
const { createWebSearchTool } = require('../src/ai/tools/web-search-tool');

function oversizedResponse() {
  const state = { pulls: 0, cancelled: false };
  const response = new Response(new ReadableStream({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (state.pulls === 8) controller.close();
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 }));
  return { response, state };
}

test('AI JSON response rejects chunked overflow while retaining only bounded diagnostics', async () => {
  const { response, state } = oversizedResponse();
  const logs = [];
  await assert.rejects(fetchJson('https://model.test', {
    fetchImpl: async () => response,
    onResponse: (entry) => logs.push(entry),
  }), { code: 'UPSTREAM_TOO_LARGE' });
  assert.equal(state.pulls, 3);
  assert.equal(state.cancelled, true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].text, '');
});

test('web search stops a chunked RSS response at its byte budget', async () => {
  const { response, state } = oversizedResponse();
  const tool = createWebSearchTool({ fetchImpl: async () => response });
  await assert.rejects(tool.search({}, { query: 'test' }), { code: 'WEB_SEARCH_TOO_LARGE' });
  assert.equal(state.pulls, 3);
  assert.equal(state.cancelled, true);
});
