'use strict';

const { createPublicError } = require('../http-client');

const SEARCH_URL = 'https://www.bing.com/search';
const MAX_QUERY_CHARS = 200;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function createWebSearchTool(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function search(config = {}, input = {}) {
    const query = String(input.query || '').trim().slice(0, MAX_QUERY_CHARS);
    if (!query) throw createPublicError('WEB_SEARCH_QUERY_MISSING', '联网搜索缺少关键词。');
    const url = new URL(SEARCH_URL);
    url.searchParams.set('format', 'rss');
    url.searchParams.set('q', query);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(Number(config.requestTimeoutMs) || 12000)
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw createPublicError('WEB_SEARCH_TIMEOUT', '联网搜索超时了，请稍后再试。');
      }
      throw createPublicError('WEB_SEARCH_UNAVAILABLE', '联网搜索暂时不可用。');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw createPublicError('WEB_SEARCH_TOO_LARGE', '联网搜索结果过大，暂时无法处理。');
    }
    if (!response.ok) throw createPublicError('WEB_SEARCH_FAILED', '联网搜索服务返回错误。');
    const results = parseRssResults(text);
    if (!results.length) throw createPublicError('WEB_SEARCH_EMPTY', '没有查到相关联网信息。');
    return { query, results };
  }

  return { search };
}

function parseRssResults(xml) {
  const results = [];
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 5)) {
    const title = readTag(item, 'title');
    const description = readTag(item, 'description');
    const url = readTag(item, 'link');
    if (!title || !url) continue;
    results.push({ title, snippet: description, url });
  }
  return results;
}

function readTag(value, tag) {
  const match = String(value || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeXml(String(match[1]).trim()).replace(/<[^>]+>/g, '').trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

module.exports = { createWebSearchTool, parseRssResults };
