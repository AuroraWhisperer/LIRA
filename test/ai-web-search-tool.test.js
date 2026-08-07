'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebSearchTool, parseRssResults } = require('../src/ai/tools/web-search-tool');

test('web search parses bounded RSS results and decodes XML', async () => {
  let requestedUrl = '';
  const tool = createWebSearchTool({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        async text() {
          return '<rss><channel><item><title><![CDATA[郑州演唱会]]></title><description>最新 &amp; 信息</description><link>https://example.test/a</link></item></channel></rss>';
        }
      };
    }
  });
  const result = await tool.search({ requestTimeoutMs: 3000 }, { query: '郑州 演唱会' });
  assert.equal(new URL(requestedUrl).searchParams.get('format'), 'rss');
  assert.deepEqual(result.results, [{ title: '郑州演唱会', snippet: '最新 & 信息', url: 'https://example.test/a' }]);
});

test('web search rejects empty or failed responses clearly', async () => {
  const tool = createWebSearchTool({
    fetchImpl: async () => ({ ok: false, async text() { return 'error'; } })
  });
  await assert.rejects(tool.search({}, {}), (error) => error.code === 'WEB_SEARCH_QUERY_MISSING');
  await assert.rejects(tool.search({}, { query: 'test' }), (error) => error.code === 'WEB_SEARCH_FAILED');
  assert.deepEqual(parseRssResults('<rss><channel /></rss>'), []);
});
