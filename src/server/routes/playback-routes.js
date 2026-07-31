// 编写人：Aurora
// 播放器持久化域路由：播放历史、队列快照、收藏、自建歌单。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/playback/'];

// store 抛错统一回 400，避免每个路由重复写 try/catch
function storeRoute(run) {
  return async (context, request, res) => {
    try {
      sendJson(res, 200, { ok: true, data: await run(context, request) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || '播放器数据操作失败。' });
    }
  };
}

function clientIdOf(request, body) {
  return (body && body.clientId) || request.query.get('clientId') || 'default';
}

const routes = {
  // ── 播放历史 ──

  'GET /api/playback/history': storeRoute((context, request) => ({
    tracks: context.playback.listHistory({
      clientId: clientIdOf(request),
      limit: Number(request.query.get('limit')) || 500
    })
  })),

  'POST /api/playback/history': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.recordPlay(body.track, {
      clientId: clientIdOf(request, body),
      origin: body.origin,
      requesterName: body.requesterName,
      playedAt: body.playedAt
    });
  }),

  'POST /api/playback/history/remove': storeRoute(async (context, request) => {
    const body = await request.body();
    return {
      removed: context.playback.removeHistoryTrack(body.trackKey, {
        clientId: clientIdOf(request, body)
      })
    };
  }),

  'POST /api/playback/history/clear': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.clearHistory({ clientId: clientIdOf(request, body) });
  }),

  // ── 队列快照 ──

  'GET /api/playback/queue-state': storeRoute((context, request) => (
    context.playback.getQueueState({ clientId: clientIdOf(request) }) || { payload: null, updatedAt: '' }
  )),

  'POST /api/playback/queue-state': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.saveQueueState(body.payload, { clientId: clientIdOf(request, body) });
  }),

  'POST /api/playback/queue-state/clear': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.clearQueueState({ clientId: clientIdOf(request, body) });
  }),

  // ── 收藏 ──

  'GET /api/playback/favorites': storeRoute((context) => ({
    tracks: context.playback.listFavorites()
  })),

  'POST /api/playback/favorites': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.addFavorite(body.track);
  }),

  'POST /api/playback/favorites/remove': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.removeFavorite(body.trackKey);
  }),

  // ── 自建歌单 ──

  'GET /api/playback/playlists': storeRoute((context, request) => {
    const id = request.query.get('id');
    if (id) {
      return { id: Number(id), tracks: context.playback.listPlaylistTracks(id) };
    }
    return { playlists: context.playback.listPlaylists() };
  }),

  'POST /api/playback/playlists': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.createPlaylist(body);
  }),

  'POST /api/playback/playlists/delete': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.deletePlaylist(body.id);
  }),

  'POST /api/playback/playlists/tracks': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.addPlaylistTracks(body.id, body.tracks || body.track);
  }),

  'POST /api/playback/playlists/tracks/remove': storeRoute(async (context, request) => {
    const body = await request.body();
    return context.playback.removePlaylistTrack(body.id, body.trackKey);
  })
};

module.exports = { prefixes, routes };
