// 编写人：Aurora
// HTTP API 路由分发 — 接收 context，委托给各 service 模块。
// 当前版本：仅定义路由表结构，实际逻辑仍在 server.js 中。
// 后续 Step 19 (slim server.js) 完成时，server.js 中的 handleApi 将替换为此模块。
'use strict';

const { readJsonBody, sendJson, sendCsv, sendBuffer } = require('./http-utils');
const { resolveMusicStream } = require('../music/stream-resolver');
const { getMusicProviderHealth } = require('../music/provider-health');
const { searchMusicTracks, getMusicHomeContent, getMusicTrackLyrics, parseLyricPayload, matchMusicTrackCandidates } = require('../music/lyrics-service');
const { getMusicCacheStats, clearMusicCache } = require('../music/music-cache');
const { parseSongsFromXlsx, buildSongsCsv, buildSongsWorkbook, templateSongs } = require('../shared/utils');

// 注意：这是路由表骨架。实际迁移到 context 模式时，
// 所有 handler 将通过 context.db / context.settings() / context.state 访问共享状态。

async function handleApi(context, req, res, requestUrl) {
  const method = req.method || 'GET';
  const pathName = requestUrl.pathname;

  // ── GET routes ──
  if (method === 'GET' && pathName === '/api/health') {
    sendJson(res, 200, { ok: true, data: context.getHealth() });
    return;
  }
  if (method === 'GET' && pathName === '/api/state') {
    sendJson(res, 200, { ok: true, data: context.getState() });
    return;
  }
  if (method === 'GET' && pathName === '/api/system/metrics') {
    const windowMs = Number(requestUrl.searchParams.get('windowMs') || 5000);
    sendJson(res, 200, { ok: true, data: await context.getSystemMetrics(windowMs) });
    return;
  }
  if (method === 'GET' && pathName === '/api/music/health') {
    const platform = requestUrl.searchParams.get('platform') || '';
    sendJson(res, 200, { ok: true, data: await getMusicProviderHealth(context.musicRegistry, platform) });
    return;
  }
  if (method === 'GET' && pathName === '/api/music/cache') {
    sendJson(res, 200, { ok: true, data: await context.getMusicCacheStats() });
    return;
  }
  if (method === 'GET' && pathName === '/api/categories') {
    sendJson(res, 200, { ok: true, data: context.listCategories() });
    return;
  }
  if (method === 'GET' && pathName === '/api/songs') {
    sendJson(res, 200, { ok: true, data: context.listSongs({
      query: requestUrl.searchParams.get('query') || '',
      category: requestUrl.searchParams.get('category') || '',
      language: requestUrl.searchParams.get('language') || '',
      artist: requestUrl.searchParams.get('artist') || '',
      enabledOnly: requestUrl.searchParams.get('enabledOnly') === 'true'
    })});
    return;
  }
  if (method === 'GET' && pathName === '/api/songs/template.csv') {
    const csv = buildSongsCsv(templateSongs());
    sendCsv(res, 'song-import-template.csv', `﻿${csv}\n`);
    return;
  }
  if (method === 'GET' && pathName === '/api/songs/template.xlsx') {
    sendBuffer(res, 200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'song-import-template.xlsx',
      buildSongsWorkbook(templateSongs()));
    return;
  }
  if (method === 'GET' && pathName === '/api/songs/export.csv') {
    sendCsv(res, 'songs-export.csv', `﻿${buildSongsCsv(context.listSongs({}))}\n`);
    return;
  }
  if (method === 'GET' && pathName === '/api/songs/export.xlsx') {
    sendBuffer(res, 200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'songs-export.xlsx',
      buildSongsWorkbook(context.listSongs({})));
    return;
  }
  if (pathName === '/api/gifts/blivedm/check') {
    const result = await context.runBlivedmCheck();
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  // ── POST routes ──
  const body = await readJsonBody(req);

  if (pathName === '/api/settings') {
    context.saveSettings(body);
    context.configureBilibiliListener();
    context.broadcastSnapshot('settings');
    sendJson(res, 200, { ok: true, data: context.getState() });
    return;
  }

  if (pathName === '/api/music/resolve-stream') {
    try {
      const stream = await resolveMusicStream(context.musicRegistry, body.track, {
        forceRefresh: body.forceRefresh === true
      });
      sendJson(res, 200, { ok: true, data: stream });
    } catch (error) {
      sendJson(res, 501, { ok: false, error: error.message || '在线音源 Provider 尚未接入。' });
    }
    return;
  }

  if (pathName === '/api/music/search') {
    try { sendJson(res, 200, { ok: true, data: await searchMusicTracks(context.musicRegistry, body) }); }
    catch (error) { sendJson(res, 501, { ok: false, error: error.message || '搜索 Provider 尚未接入。' }); }
    return;
  }

  if (pathName === '/api/music/home') {
    try { sendJson(res, 200, { ok: true, data: await getMusicHomeContent(context.musicRegistry, body) }); }
    catch (error) { sendJson(res, 501, { ok: false, error: error.message || '音乐首页 Provider 尚未接入。' }); }
    return;
  }

  if (pathName === '/api/music/lyrics') {
    try { sendJson(res, 200, { ok: true, data: await getMusicTrackLyrics(context.musicRegistry, body) }); }
    catch (error) { sendJson(res, 501, { ok: false, error: error.message || '在线歌词 Provider 尚未接入。' }); }
    return;
  }

  if (pathName === '/api/music/lyrics/parse') {
    sendJson(res, 200, { ok: true, data: parseLyricPayload(body) });
    return;
  }

  if (pathName === '/api/music/match-track') {
    sendJson(res, 200, { ok: true, data: context.matchMusicTrackCandidates(body) });
    return;
  }

  if (pathName === '/api/music/cache/clear') {
    sendJson(res, 200, { ok: true, data: context.clearMusicCache() });
    return;
  }

  if (pathName === '/api/queue/add') {
    const item = context.addQueueItem(body);
    context.broadcastSnapshot('queue:add');
    sendJson(res, 200, { ok: true, data: item });
    return;
  }

  if (pathName === '/api/queue/action') {
    const result = context.handleQueueAction(body.action, body.id);
    context.broadcastSnapshot(`queue:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/superchats/action') {
    const result = context.handleSuperChatAction(body.action, body.id);
    context.broadcastSnapshot(`superchat:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/gifts/sprint/reset') {
    const result = context.resetGiftSprintProgress();
    context.broadcastSnapshot('gift:sprint:reset');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/save') {
    const result = context.saveSong(body);
    context.broadcastSnapshot('songs:save');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/delete') {
    context.deleteSong(Number(body.id));
    context.broadcastSnapshot('songs:delete');
    sendJson(res, 200, { ok: true, data: { id: Number(body.id) } });
    return;
  }

  if (pathName === '/api/songs/toggle') {
    context.toggleSong(Number(body.id));
    context.broadcastSnapshot('songs:toggle');
    sendJson(res, 200, { ok: true, data: { id: Number(body.id) } });
    return;
  }

  if (pathName === '/api/songs/import') {
    const result = context.importSongs(Array.isArray(body.rows) ? body.rows : []);
    context.broadcastSnapshot('songs:import');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/import-xlsx') {
    const rows = parseSongsFromXlsx(Buffer.from(String(body.base64 || ''), 'base64'));
    const result = context.importSongs(rows);
    context.broadcastSnapshot('songs:import-xlsx');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear') {
    if (body.confirm !== true) { sendJson(res, 400, { ok: false, error: '缺少清空确认。' }); return; }
    sendJson(res, 200, { ok: true, data: context.clearSongLibrary() });
    context.broadcastSnapshot('database:clear');
    return;
  }

  if (pathName === '/api/database/clear-superchats') {
    if (body.confirm !== true) { sendJson(res, 400, { ok: false, error: '缺少清空确认。' }); return; }
    sendJson(res, 200, { ok: true, data: context.clearSuperChats() });
    context.broadcastSnapshot('database:clear-superchats');
    return;
  }

  if (pathName === '/api/database/clear-all') {
    if (body.confirm !== true) { sendJson(res, 400, { ok: false, error: '缺少清空确认。' }); return; }
    sendJson(res, 200, { ok: true, data: context.clearAllData() });
    context.broadcastSnapshot('database:clear-all');
    return;
  }

  if (pathName === '/api/bilibili/reconnect') {
    try {
      const result = await context.reconnectBilibiliListener();
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      context.handleBilibiliReconnectError(error);
      sendJson(res, 500, { ok: false, error: context.publicBilibiliErrorMessage(error, true),
        detail: error.message || String(error),
        data: { liveStatus: context.state.liveStatus }
      });
    }
    return;
  }

  if (pathName === '/api/system/shutdown') {
    if (body.confirm !== true) { sendJson(res, 400, { ok: false, error: '缺少退出确认。' }); return; }
    sendJson(res, 200, { ok: true, data: { shuttingDown: true } });
    setTimeout(() => context.shutdownApplication(), 250);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

module.exports = { handleApi };
