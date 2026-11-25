'use strict';

// Serve the sibling repository's streamer song-page screenshot with in-memory responses.
// This does not load its application/configuration, databases or credentials.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function start(serverRoot = path.resolve(__dirname, '../../../lira-server')) {
  const serverRequire = createRequire(path.join(serverRoot, 'package.json'));
  const appearance = serverRequire('./public/song/appearance-catalog.json').defaults;
  const qr = await serverRequire('qrcode').toString('https://demo.example.test', { type: 'svg', margin: 2 });
  const at = '2026-09-22T03:30:00.000Z';
  const streamer = {
    id: 1,
    displayName: '示例主播',
    display_name: '示例主播',
    accountName: 'demo',
    subdomain: 'demo',
    status: 'active',
    songPageUrl: 'https://demo.example.test',
  };
  const songs = ['晴天', '起风了', '小幸运', 'Lemon', '棠梨煎雪', '平凡之路', '勾指起誓'].map((title, index) => ({
    id: index + 1,
    title,
    artist: ['周杰伦', '买辣椒也用券', '田馥甄', '米津玄師', '银临', '朴树', '洛天依'][index],
    categoryName: index === 3 ? '日语' : '华语流行',
    language: index === 3 ? '日语' : '华语',
    tags: index % 2 ? '治愈' : '经典',
    enabled: true,
    requestPrice: '免费',
  }));
  const events = Array.from({ length: 12 }, (_, index) => ({
    eventId: `demo-${index}`,
    gift: {
      giftName: index % 3 === 0 ? '水晶球' : '小花花',
      userName: `观众${'ABCD'[index % 4]}`,
      num: (index % 3) + 1,
      totalPrice: index % 3 === 0 ? 100 : 0.1 * ((index % 3) + 1),
      createdAt: new Date(Date.parse(at) - Math.floor(index / 2) * 86400000 - (index % 2) * 360000).toISOString(),
    },
  }));
  function statistics(range) {
    const summary = {
      eventCount: events.length,
      itemCount: 0,
      totalPriceCents: 0,
      guardValueCents: 0,
      blindBoxValueCents: 0,
      blindBoxEventCount: 0,
      blindProfitCents: 0,
      blindBoxUnknownCostEventCount: 0,
    };
    const gifts = new Map();
    const days = new Map();
    for (const { gift } of events) {
      const cents = Math.round(gift.totalPrice * 100);
      summary.itemCount += gift.num;
      summary.totalPriceCents += cents;
      const aggregate = gifts.get(gift.giftName) || {
        giftId: gift.giftName === '水晶球' ? '1024' : '1001',
        giftName: gift.giftName,
        totalPriceCents: 0,
        eventCount: 0,
        itemCount: 0,
        guardValueCents: 0,
        blindBoxValueCents: 0,
      };
      aggregate.totalPriceCents += cents;
      aggregate.itemCount += gift.num;
      aggregate.eventCount++;
      gifts.set(gift.giftName, aggregate);
      const day = new Date(gift.createdAt.slice(0, 10) + 'T00:00:00+08:00').toISOString();
      const bucket = days.get(day) || {
        bucketStart: day,
        totalPriceCents: 0,
        eventCount: 0,
        itemCount: 0,
        guardValueCents: 0,
        blindBoxValueCents: 0,
      };
      bucket.totalPriceCents += cents;
      bucket.itemCount += gift.num;
      bucket.eventCount++;
      days.set(day, bucket);
    }
    return {
      asOf: at,
      range,
      partial: false,
      summary,
      topGifts: [...gifts.values()],
      timeSeries: [...days.values()].reverse(),
    };
  }
  const defaults = {
    '/api/auth/session': { actor: { type: 'streamer' }, homePath: '/manage' },
    '/api/streamer/me': { streamer },
    '/api/streamer/room-avatar': { avatarUrl: null },
    '/api/streamer/song-page/background': { background: null },
    '/api/streamer/song-page/appearance': { appearance },
    '/api/streamer/song-page/title': {
      titleName: '示例主播的歌单',
      defaultTitleName: '示例主播',
      pageTitle: '示例主播的歌单',
    },
    '/api/streamer/songs': { songs, initialized: true, revision: 1, updatedAt: at },
    '/api/streamer/gift-events': { asOf: at, range: '30d', partial: false, events, hasMore: false, nextBefore: null },
  };
  const publicRoot = path.join(serverRoot, 'public');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (payload, status = 200, type = 'application/json') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(type === 'application/json' ? JSON.stringify(payload) : payload);
    };
    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') return send({ error: 'SCREENSHOT_FIXTURE_ONLY' }, 405);
      if (url.pathname === '/api/streamer/song-page/qr') return send(qr, 200, 'image/svg+xml');
      if (url.pathname === '/api/streamer/gift-statistics') return send(statistics(url.searchParams.get('range') || '30d'));
      return defaults[url.pathname] ? send(defaults[url.pathname]) : send({ error: 'NOT_FOUND' }, 404);
    }
    const asset = url.pathname.match(/^\/(manage|site|song|shared)\/assets\/(.+)$/);
    const relative = url.pathname === '/manage'
      ? 'streamer/manage.html'
      : asset && `${asset[1] === 'manage' ? 'streamer' : asset[1]}/${asset[2]}`;
    if (!relative) return send('Not found', 404, 'text/plain');
    const file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return send('Not found', 404, 'text/plain');
    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
      }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { start };
