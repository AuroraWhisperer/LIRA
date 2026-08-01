// 编写人：Aurora
// 在线音源域路由：健康、搜索、首页、歌词、播放地址和缓存。
'use strict';

const { sendJson } = require('../http-utils');
const { resolveMusicStream } = require('../../music/stream-resolver');
const { getMusicProviderHealth } = require('../../music/provider-health');
const {
  getMusicHomeContent,
  getMusicTrackLyrics,
  matchMusicTrackCandidates,
  parseLyricPayload,
  searchMusicTracks,
  writeMusicPlaylistTracks
} = require('../../music/lyrics-service');

const prefixes = ['/api/music/'];

// Provider 尚未接入时统一回 501，避免每个路由重复写 try/catch
async function sendProviderResult(res, fallbackMessage, run) {
  try {
    sendJson(res, 200, { ok: true, data: await run() });
  } catch (error) {
    sendJson(res, 501, { ok: false, error: error.message || fallbackMessage });
  }
}

const routes = {
  async 'GET /api/music/health'(context, request, res) {
    const platform = request.query.get('platform') || '';
    sendJson(res, 200, { ok: true, data: await getMusicProviderHealth(context.music.registry, platform) });
  },

  'GET /api/music/cache'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.music.getCacheStats() });
  },

  async 'POST /api/music/resolve-stream'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '在线音源 Provider 尚未接入。', () => resolveMusicStream(
      context.music.registry,
      body.track,
      { forceRefresh: body.forceRefresh === true }
    ));
  },

  async 'POST /api/music/search'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '搜索 Provider 尚未接入。', () => searchMusicTracks(context.music.registry, body));
  },

  async 'POST /api/music/home'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '音乐首页 Provider 尚未接入。', () => getMusicHomeContent(context.music.registry, body));
  },

  async 'POST /api/music/playlists/tracks/add'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '添加到音乐歌单失败。', () => writeMusicPlaylistTracks(
      context.music.registry,
      body,
      'add'
    ));
  },

  async 'POST /api/music/playlists/tracks/remove'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '从音乐歌单删除失败。', () => writeMusicPlaylistTracks(
      context.music.registry,
      body,
      'remove'
    ));
  },

  async 'POST /api/music/lyrics'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, '在线歌词 Provider 尚未接入。', () => getMusicTrackLyrics(context.music.registry, body));
  },

  async 'POST /api/music/lyrics/parse'(context, request, res) {
    sendJson(res, 200, { ok: true, data: parseLyricPayload(await request.body()) });
  },

  async 'POST /api/music/match-track'(context, request, res) {
    sendJson(res, 200, { ok: true, data: matchMusicTrackCandidates(await request.body()) });
  },

  'POST /api/music/cache/clear'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.music.clearCache() });
  }
};

module.exports = { prefixes, routes };
