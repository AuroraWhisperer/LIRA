'use strict';

// Serve the sibling repository's real web UI with synthetic, in-memory responses.
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
  const streamer = { id: 1, displayName: '示例主播', display_name: '示例主播',
    accountName: 'demo', subdomain: 'demo', status: 'active', songPageUrl: 'https://demo.example.test' };
  const songs = ['晴天', '起风了', '小幸运', 'Lemon', '棠梨煎雪', '平凡之路', '勾指起誓'].map((title, index) => ({
    id: index + 1, title, artist: ['周杰伦', '买辣椒也用券', '田馥甄', '米津玄師', '银临', '朴树', '洛天依'][index],
    categoryName: index === 3 ? '日语' : '华语流行', language: index === 3 ? '日语' : '华语',
    tags: index % 2 ? '治愈' : '经典', enabled: true, requestPrice: '免费',
  }));
  const events = Array.from({ length: 12 }, (_, index) => ({ eventId: `demo-${index}`, gift: {
    giftName: index % 3 === 0 ? '水晶球' : '小花花', userName: `观众${'ABCD'[index % 4]}`,
    num: index % 3 + 1, totalPrice: index % 3 === 0 ? 100 : 0.1 * (index % 3 + 1),
    createdAt: new Date(Date.parse(at) - Math.floor(index / 2) * 86400000 - (index % 2) * 360000).toISOString(),
  } }));
  function statistics(range) {
    const summary = { eventCount: events.length, itemCount: 0, totalPriceCents: 0,
      guardValueCents: 0, blindBoxValueCents: 0, blindBoxEventCount: 0, blindProfitCents: 0, blindBoxUnknownCostEventCount: 0 };
    const gifts = new Map();
    const days = new Map();
    for (const { gift } of events) {
      const cents = Math.round(gift.totalPrice * 100);
      summary.itemCount += gift.num;
      summary.totalPriceCents += cents;
      const aggregate = gifts.get(gift.giftName) || { giftId: gift.giftName === '水晶球' ? '1024' : '1001', giftName: gift.giftName,
        totalPriceCents: 0, eventCount: 0, itemCount: 0, guardValueCents: 0, blindBoxValueCents: 0 };
      aggregate.totalPriceCents += cents;
      aggregate.itemCount += gift.num;
      aggregate.eventCount++;
      gifts.set(gift.giftName, aggregate);
      const day = new Date(gift.createdAt.slice(0, 10) + 'T00:00:00+08:00').toISOString();
      const bucket = days.get(day) || { bucketStart: day, totalPriceCents: 0, eventCount: 0, itemCount: 0, guardValueCents: 0, blindBoxValueCents: 0 };
      bucket.totalPriceCents += cents;
      bucket.itemCount += gift.num;
      bucket.eventCount++;
      days.set(day, bucket);
    }
    return { asOf: at, range, partial: false, summary, topGifts: [...gifts.values()], timeSeries: [...days.values()].reverse() };
  }
  const defaults = {
    '/api/auth/session': { actor: { type: 'streamer' }, homePath: '/manage' },
    '/api/streamer/me': { streamer },
    '/api/streamer/room-avatar': { avatarUrl: null },
    '/api/streamer/cloud-settings': { initialized: true, revision: 1, values: { roomId: '', enableBilibili: false, queueLimit: 50 } },
    '/api/streamer/overlay-settings': { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, overlayUrl: 'https://demo.example.test/overlay/EXAMPLE000000000' },
    '/api/streamer/bilibili-credentials': { loggedIn: false, initialized: true, revision: 1 },
    '/api/streamer/song-page/background': { background: null },
    '/api/streamer/song-page/appearance': { appearance },
    '/api/streamer/song-page/title': { titleName: '示例主播的歌单', defaultTitleName: '示例主播', pageTitle: '示例主播的歌单' },
    '/api/streamer/songs': { songs, initialized: true, revision: 1, updatedAt: at },
    '/api/streamer/gift-events': { asOf: at, range: '30d', partial: false, events, hasMore: false, nextBefore: null },
    '/api/admin/me': { admin: { id: 1, username: '示例管理员', role: 'super_admin' } },
    '/api/admin/streamers': { streamers: [streamer] },
    '/api/admin/monitors': { monitors: [] },
    '/api/admin/devices': { devices: [{ id: 'demo-device-0001', streamer_id: 1, streamer_name: '示例主播', display_name: '示例主播',
      name: '示例电脑', platform: 'win32', app_version: '5.0.3', status: 'active', last_seen_at: at }] },
    '/api/admin/activation-codes': { activationCodes: [] },
    '/api/admin/audit-logs': { logs: [] },
    '/api/admin/overview': {},
    '/api/admin/history': { events: [] },
    '/api/admin/streamers/1/settings': { streamer, credentials: { configured: false } },
    '/api/admin/streamers/1/password-reset-codes': { passwordResetCodes: [] },
    '/api/admin/streamers/1/devices': { devices: [] },
    '/api/admin/streamers/1/recent-danmaku': { danmaku: [] },
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
      if (url.pathname === '/api/auth/session' && /\/(login|password-reset)/.test(request.headers.referer || '')) return send({ error: 'CONSOLE_AUTH_REQUIRED' }, 401);
      if (url.pathname === '/api/streamer/song-page/qr') return send(qr, 200, 'image/svg+xml');
      if (url.pathname.endsWith('/gift-statistics')) return send(statistics(url.searchParams.get('range') || '30d'));
      if (url.pathname.startsWith('/api/public/')) {
        const kind = url.pathname.split('/').at(-1);
        return send({ songs: { songs, pageTitle: '示例主播的歌单' },
          status: { streamer, live: { liveStatus: 0 } }, profile: { owner: null, roomId: null, pageTitle: '示例主播的歌单' },
          appearance: { appearance } }[kind] || {});
      }
      return defaults[url.pathname] ? send(defaults[url.pathname]) : send({ error: 'NOT_FOUND' }, 404);
    }
    const documents = { '/': 'song/index.html', '/login': 'admin/login.html',
      '/password-reset': 'admin/password-reset.html', '/manage': 'streamer/manage.html', '/admin': 'admin/index.html' };
    const asset = url.pathname.match(/^\/(admin|manage|site|song|shared|overlay)\/assets\/(.+)$/);
    const relative = documents[url.pathname] || (!asset && url.pathname.startsWith('/admin/') && 'admin/index.html') ||
      (asset && `${asset[1] === 'manage' ? 'streamer' : asset[1]}/${asset[2]}`);
    if (!relative) return send('Not found', 404, 'text/plain');
    const file = path.resolve(publicRoot, relative);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send('Not found', 404, 'text/plain');
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { start };
