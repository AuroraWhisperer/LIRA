// 编写人：Aurora
// 在线音源域路由：健康、搜索、首页、歌词、播放地址和缓存。
'use strict';

const { sendJson, sendStableError } = require('../http-utils');
const { resolveMusicStream } = require('../../music/stream-resolver');
const { matchMusicTrackCandidates } = require('../../music/song-matcher');

const prefixes = ['/api/music/'];

async function sendProviderResult(res, run) {
  try {
    sendJson(res, 200, { ok: true, data: await run() });
  } catch (error) {
    if (!error?.publicMessage && error?.statusCode !== 400) throw error;
    sendStableError(res, error);
  }
}

const routes = {
  async 'GET /api/music/health'(context, request, res) {
    const platform = request.query.get('platform') || '';
    sendJson(res, 200, {
      ok: true,
      data: await context.music.registry.healthCheck(platform),
    });
  },

  'GET /api/music/cache'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.music.getCacheStats() });
  },

  async 'POST /api/music/resolve-stream'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, async () => {
      const stream = await resolveMusicStream(context.music.registry, body.track, {
        forceRefresh: body.forceRefresh === true,
        quality: String(body.quality || ''),
      });
      if (stream && stream.encrypted && stream.url && context.sessionToken) {
        const url = new URL(stream.url, 'http://lira.local');
        url.searchParams.set('token', context.sessionToken);
        stream.url = `${url.pathname}${url.search}`;
      }
      return stream;
    });
  },

  async 'GET /api/music/qq-encrypted-stream'(context, request, res) {
    const provider = context.music.registry.get('qq');
    await provider.serveEncryptedStream(request.query.get('id'), request.req, res);
  },

  async 'POST /api/music/search'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, () =>
      context.music.catalog.searchMusicTracks(context.music.registry, body),
    );
  },

  async 'POST /api/music/home'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, () =>
      context.music.catalog.getMusicHomeContent(context.music.registry, body),
    );
  },

  async 'POST /api/music/playlists/tracks/add'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, () =>
      context.music.catalog.writeMusicPlaylistTracks(context.music.registry, body, 'add'),
    );
  },

  async 'POST /api/music/playlists/tracks/remove'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, () =>
      context.music.catalog.writeMusicPlaylistTracks(context.music.registry, body, 'remove'),
    );
  },

  async 'POST /api/music/lyrics'(context, request, res) {
    const body = await request.body();
    await sendProviderResult(res, () =>
      context.music.lyrics.getMusicTrackLyrics(context.music.registry, body),
    );
  },

  async 'POST /api/music/lyrics/parse'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: context.music.lyrics.parseLyricPayload(await request.body()),
    });
  },

  async 'POST /api/music/match-track'(context, request, res) {
    sendJson(res, 200, {
      ok: true,
      data: matchMusicTrackCandidates(await request.body()),
    });
  },

  'POST /api/music/cache/clear'(context, request, res) {
    sendJson(res, 200, { ok: true, data: context.music.clearCache() });
  },
};

module.exports = { prefixes, routes };
