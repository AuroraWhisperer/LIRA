// HTTP API route dispatch. Business state stays in server.js and is provided
// through the context object so this module stays stateless.
'use strict';

const { readJsonBody, sendJson, sendCsv, sendBuffer } = require('./http-utils');
const {
  buildSongsCsv,
  buildSongsWorkbook,
  parseSongsFromXlsx,
  templateSongs
} = require('../shared/utils');
const { resolveMusicStream } = require('../music/stream-resolver');
const { getMusicProviderHealth } = require('../music/provider-health');
const {
  getMusicHomeContent,
  getMusicTrackLyrics,
  matchMusicTrackCandidates,
  parseLyricPayload,
  searchMusicTracks
} = require('../music/lyrics-service');

async function handleApi(context, req, res, requestUrl) {
  const method = req.method || 'GET';
  const pathName = requestUrl.pathname;

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
    sendJson(res, 200, { ok: true, data: context.getMusicCacheStats() });
    return;
  }

  if (pathName === '/api/gifts/blivedm/check') {
    const result = await context.runManualBlivedmCompatibilityCheck();
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (method === 'GET' && pathName === '/api/categories') {
    sendJson(res, 200, { ok: true, data: context.listCategories() });
    return;
  }

  if (method === 'GET' && pathName === '/api/songs') {
    sendJson(res, 200, {
      ok: true,
      data: context.listSongs({
        query: requestUrl.searchParams.get('query') || '',
        category: requestUrl.searchParams.get('category') || '',
        language: requestUrl.searchParams.get('language') || '',
        artist: requestUrl.searchParams.get('artist') || '',
        enabledOnly: requestUrl.searchParams.get('enabledOnly') === 'true'
      })
    });
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/template.csv') {
    const csv = buildSongsCsv(templateSongs());
    sendCsv(res, 'song-import-template.csv', `\uFEFF${csv}\n`);
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/template.xlsx') {
    sendBuffer(
      res,
      200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'song-import-template.xlsx',
      buildSongsWorkbook(templateSongs())
    );
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/export.csv') {
    sendCsv(res, 'songs-export.csv', `\uFEFF${buildSongsCsv(context.listSongs({}))}\n`);
    return;
  }

  if (method === 'GET' && pathName === '/api/songs/export.xlsx') {
    sendBuffer(
      res,
      200,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'songs-export.xlsx',
      buildSongsWorkbook(context.listSongs({}))
    );
    return;
  }

  if (method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  const body = await readJsonBody(req, context.maxBodyBytes);

  if (pathName === '/api/settings') {
    const allowedKeys = new Set(Object.keys(context.defaultSettings));
    for (const [key, rawValue] of Object.entries(body || {})) {
      if (allowedKeys.has(key)) {
        const value = key === 'roomId' ? context.normalizeRoomInput(rawValue) : String(rawValue);
        context.setSetting(key, value);
      }
    }
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
    try {
      sendJson(res, 200, { ok: true, data: await searchMusicTracks(context.musicRegistry, body) });
    } catch (error) {
      sendJson(res, 501, { ok: false, error: error.message || '搜索 Provider 尚未接入。' });
    }
    return;
  }

  if (pathName === '/api/music/home') {
    try {
      sendJson(res, 200, { ok: true, data: await getMusicHomeContent(context.musicRegistry, body) });
    } catch (error) {
      sendJson(res, 501, { ok: false, error: error.message || '音乐首页 Provider 尚未接入。' });
    }
    return;
  }

  if (pathName === '/api/music/lyrics') {
    try {
      sendJson(res, 200, { ok: true, data: await getMusicTrackLyrics(context.musicRegistry, body) });
    } catch (error) {
      sendJson(res, 501, { ok: false, error: error.message || '在线歌词 Provider 尚未接入。' });
    }
    return;
  }

  if (pathName === '/api/music/lyrics/parse') {
    sendJson(res, 200, { ok: true, data: parseLyricPayload(body) });
    return;
  }

  if (pathName === '/api/music/match-track') {
    sendJson(res, 200, { ok: true, data: matchMusicTrackCandidates(body) });
    return;
  }

  if (pathName === '/api/music/cache/clear') {
    sendJson(res, 200, { ok: true, data: context.clearMusicCache() });
    return;
  }

  if (pathName === '/api/queue/add') {
    const item = context.addQueueItem({
      songName: body.songName,
      artist: body.artist,
      categoryName: body.categoryName,
      requesterName: body.requesterName || '主播',
      requesterUid: body.requesterUid || 'admin',
      requesterGuardLevel: body.requesterGuardLevel,
      requesterMedalName: body.requesterMedalName,
      requesterMedalLevel: body.requesterMedalLevel,
      source: body.source || 'admin',
      message: body.message || ''
    });
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
    const id = Number(body.id);
    context.deleteSong(id);
    context.broadcastSnapshot('songs:delete');
    sendJson(res, 200, { ok: true, data: { id } });
    return;
  }

  if (pathName === '/api/songs/toggle') {
    const id = Number(body.id);
    const result = context.toggleSong(id);
    if (!result.ok) {
      sendJson(res, 404, { ok: false, error: 'Song not found.' });
      return;
    }
    context.broadcastSnapshot('songs:toggle');
    sendJson(res, 200, { ok: true, data: { id } });
    return;
  }

  if (pathName === '/api/songs/import') {
    const result = context.importSongs(Array.isArray(body.rows) ? body.rows : []);
    context.broadcastSnapshot('songs:import');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/songs/import-xlsx') {
    const buffer = Buffer.from(String(body.base64 || ''), 'base64');
    const result = context.importSongs(parseSongsFromXlsx(buffer));
    context.broadcastSnapshot('songs:import-xlsx');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = context.clearSongLibraryData();
    context.broadcastSnapshot('database:clear');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear-superchats') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = context.clearSuperChatData();
    context.broadcastSnapshot('database:clear-superchats');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/database/clear-all') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少清空确认。' });
      return;
    }
    const result = context.clearAllData();
    context.broadcastSnapshot('database:clear-all');
    sendJson(res, 200, { ok: true, data: result });
    return;
  }

  if (pathName === '/api/bilibili/reconnect') {
    try {
      const result = await context.reconnectBilibiliListener();
      sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      console.warn(`[Bilibili] manual reconnect failed: ${error.message}`);
      const message = context.publicBilibiliErrorMessage(error, true);
      context.updateLiveStatus({
        connected: false,
        enabled: true,
        roomId: context.normalizeRoomInput(context.getSettings().roomId),
        mode: 'bilibili',
        message
      });
      sendJson(res, 500, {
        ok: false,
        error: message,
        detail: error.message || String(error),
        data: { liveStatus: context.liveStatus }
      });
    }
    return;
  }

  if (pathName === '/api/system/shutdown') {
    if (body.confirm !== true) {
      sendJson(res, 400, { ok: false, error: '缺少退出确认。' });
      return;
    }
    sendJson(res, 200, { ok: true, data: { shuttingDown: true } });
    setTimeout(() => context.shutdownApplication(), 250);
    return;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found.' });
}

module.exports = { handleApi };
