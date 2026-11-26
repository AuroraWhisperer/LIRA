'use strict';

const { createPublicError } = require('../../shared/public-error');

const { QQMusicStreamProvider } = require('./qq-provider-streams');
const { getLikedTracksSession } = require('./liked-tracks-session');
const {
  buildGuid,
  calcQQGtk,
  clampInteger,
  extractQQGtkSource,
  extractRadioSongs,
  extractUin,
  extractCookieValue,
  mapQQPlaylist,
  mapQQSong,
  qqSongId,
  qqSongMid,
  mapRecommendCard,
  normalizeQQPlaylistSongInfo,
  normalizeQQPlaylistWriteTarget,
  readQQModuleData,
} = require('./qq-provider-utils');

const QQ_PLAYLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const QQ_CREATED_PLAYLIST_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const QQ_COLLECTED_ASSET_URL = 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';
const MAX_DAILY_FEED_PAGE = 50;

function publicLikedTrackPage(songs, session, offset, limit, directoryCount) {
  // A row without a title can still identify one of the account's favorites.
  const songOffsets = session.publicSongOffsets ||= new Map();
  const previousCount = songOffsets.size;
  const tracks = new Map();
  const ids = songs.map((song) => {
    const id = qqSongId(song || {});
    const mid = qqSongMid(song || {});
    const key = Number.isSafeInteger(id) && id > 0 ? `id:${id}` : mid && `mid:${mid}`;
    if (!key) return '';
    if (!songOffsets.has(key)) songOffsets.set(key, null);
    const track = mapQQSong(song);
    if (track && (songOffsets.get(key) === null || songOffsets.get(key) === offset)) {
      songOffsets.set(key, offset);
      tracks.set(key, track);
    }
    return key;
  });
  // The directory is a separate snapshot. It can prompt another read after a short page.
  const needsMore = session.publicSongCount != null
    ? songOffsets.size < session.publicSongCount
    : songs.length === limit || (songs.length > 0 && songOffsets.size < directoryCount);
  let nextOffset = null;
  if (needsMore) {
    const signature = JSON.stringify(ids);
    const seenPages = session.publicPages ||= new Map();
    const allRepeated = ids.length > 0 && ids.every(Boolean) && songOffsets.size === previousCount;
    if ((seenPages.has(signature) || allRepeated) && seenPages.get(signature) !== offset) {
      throw createPublicError('QQ 音乐重复返回同一页收藏，请重试。', 501);
    }
    seenPages.set(signature, offset);
    if (!songs.length || offset + songs.length > 200000) {
      throw createPublicError('QQ 音乐未返回完整收藏，请重试。', 501);
    }
    nextOffset = offset + songs.length;
  }
  return { tracks: [...tracks.values()], nextOffset };
}

function dailyPageItems(response, field) {
  const result = response?.req_1;
  const items = result?.data?.[field];
  if (Number(response?.code ?? 0) !== 0 || Number(result?.code ?? 0) !== 0) return null;
  return Array.isArray(items) ? items : null;
}

class QQMusicProvider extends QQMusicStreamProvider {
  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 9);
    const page = clampInteger(options.page, 1, 50, 1);
    const vUniq = Array.isArray(options.vUniq) ? options.vUniq.slice(0, 200) : [];
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();

    const data = await this.requestMusicuPost(
      {
        req_1: {
          module: 'music.recommend.RecommendFeed',
          method: 'get_recommend_feed',
          param: {
            direction: 1,
            page,
            v_cache: [],
            v_uniq: vUniq,
            s_num: 4,
          },
        },
      },
      {
        format: 'json',
        ct: 20,
        cv: 2241,
        platform: 'wk_v17',
        guid,
        uin,
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        needNewCode: 1,
      },
      cookieHeader,
    );

    const shelves =
      data && data.req_1 && data.req_1.data && Array.isArray(data.req_1.data.v_shelf) ? data.req_1.data.v_shelf : [];
    const playlists = [];
    shelves.forEach((shelf) => {
      const niches = Array.isArray(shelf.v_niche) ? shelf.v_niche : [];
      niches.forEach((niche) => {
        const cards = Array.isArray(niche.v_card) ? niche.v_card : [];
        cards.forEach((card) => {
          if (card.type === 500) {
            const mapped = mapRecommendCard(card);
            if (mapped) playlists.push(mapped);
          }
        });
      });
    });
    return playlists.slice(0, limit);
  }

  async getDailyTracks(options = {}) {
    return (await this.getDailyTrackPage(options)).tracks;
  }

  async getDailyTrackPage(options = {}) {
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = clampInteger(options.page, 1, MAX_DAILY_FEED_PAGE, 1);
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const guid = buildGuid();

    // 「每日推荐」= 推荐 Feed 里的 type 200（单曲卡片），和「为你推荐」同一个接口。
    // 客户端的真实流程（已从 HAR 抓包确认）：
    //   1. get_recommend_feed → 取 type 200 卡片（shelf 207）
    //   2. CgiGetTrackInfo(ids, types:[200...], source:"AiNoFree") → 拿完整歌曲信息
    const tracks = [];
    const seen = new Set();
    const maxPages = Math.min(5, Math.max(1, Math.ceil(limit / 9)));
    const lastPage = Math.min(page + maxPages - 1, MAX_DAILY_FEED_PAGE);
    let nextPage = page;
    while (nextPage <= lastPage && tracks.length < limit) {
      const pageCookie = nextPage === page ? cookieHeader : await this.getCookieForUin(uin);
      const data = await this.requestMusicuPost(
        {
          req_1: {
            module: 'music.recommend.RecommendFeed',
            method: 'get_recommend_feed',
            param: { direction: 1, page: nextPage, v_cache: [], v_uniq: [], s_num: 4 },
          },
        },
        {
          format: 'json',
          ct: 20,
          cv: 2241,
          platform: 'wk_v17',
          guid,
          uin,
          inCharset: 'utf-8',
          outCharset: 'utf-8',
          notice: 0,
          needNewCode: 1,
        },
        pageCookie,
      ).catch(() => null);

      const shelves = dailyPageItems(data, 'v_shelf');
      if (!shelves) break;

      // 从所有 shelf 收集 type 200 的歌曲 id
      const songIds = [];
      shelves.forEach((shelf) => {
        (shelf.v_niche || []).forEach((niche) => {
          (niche.v_card || []).forEach((card) => {
            if (card.type === 200 && card.id && !seen.has(String(card.id))) {
              songIds.push(card.id);
            }
          });
        });
      });
      if (songIds.length === 0) {
        nextPage++;
        break;
      }

      // 第二步：批量拉完整歌曲信息（含 mid / singer / album / interval）
      const detailCookie = await this.getCookieForUin(uin);
      const resolved = await this.resolveTrackInfoByIds(songIds, uin, guid, detailCookie).catch(() => null);
      if (!resolved) break;
      nextPage++;
      for (const song of resolved) {
        const mapped = mapQQSong(song);
        if (!mapped || seen.has(mapped.sourceTrackId)) continue;
        seen.add(mapped.sourceTrackId);
        tracks.push(mapped);
        if (tracks.length >= limit) break;
      }
      // 对已见 id 做保护，避免下一页重复
      songIds.forEach((id) => seen.add(String(id)));
    }

    return {
      tracks: tracks.length ? tracks : await this.getRadioTracks({ limit, page }),
      nextPage: nextPage <= MAX_DAILY_FEED_PAGE ? nextPage : null,
    };
  }

  // 把 type 200 的 songId 列表批量转成完整歌曲对象（含 mid）
  async resolveTrackInfoByIds(ids, uin, guid, cookieHeader) {
    if (!ids || ids.length === 0) return [];
    const data = await this.requestMusicuPost(
      {
        req_1: {
          module: 'music.trackInfo.UniformRuleCtrl',
          method: 'CgiGetTrackInfo',
          param: {
            ids: ids.map(Number),
            types: ids.map(() => 200),
            source: 'AiNoFree',
          },
        },
      },
      {
        format: 'json',
        ct: 20,
        cv: 2241,
        platform: 'wk_v17',
        guid: guid || buildGuid(),
        uin: uin || '0',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        needNewCode: 1,
      },
      cookieHeader,
    );
    return dailyPageItems(data, 'tracks');
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const page = clampInteger(options.page, 1, 50, 1);
    const radioId = clampInteger(options.radioId, 1, 9999, 101);
    // 电台一次只回 5 首左右，所以要连抓几轮凑够 limit。
    // firstplay=1 表示「开始新一轮」，之后用 0 才会继续往下发新歌；
    const tracks = [];
    const seen = new Set();
    const maxRounds = Math.min(12, Math.max(3, Math.ceil(limit / 4)));
    for (let round = 0; round < maxRounds && tracks.length < limit; round++) {
      const data = await this.requestMusicu({
        songlist: {
          module: 'mb_track_radio_svr',
          method: 'get_radio_track',
          param: {
            id: radioId,
            firstplay: round === 0 && page === 1 ? 1 : 0,
            num: Math.max(15, limit),
          },
        },
      }).catch(() => null);
      const batch = extractRadioSongs(data);
      if (batch.length === 0) break;
      let addedTrackCount = 0;
      for (const song of batch) {
        const mapped = mapQQSong(song);
        if (!mapped || seen.has(mapped.sourceTrackId)) continue;
        seen.add(mapped.sourceTrackId);
        tracks.push(mapped);
        addedTrackCount++;
        if (tracks.length >= limit) break;
      }
      // 服务端开始重复发同一批就停，避免空转。
      if (addedTrackCount === 0) break;
    }
    return tracks.slice(0, limit);
  }

  async getLikedTracks(options = {}) {
    return (await this.getLikedTrackPage(options)).tracks;
  }

  async getLikedTrackPage(options = {}) {
    const cookie = await this.getLoginCookieHeader('QQ 音乐”我喜欢”需要先登录。');
    const limit = clampInteger(options.limit, 1, 5000, 200);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const session = getLikedTracksSession(this, options.loadingSession, cookie);
    const liked = session ? await (session.playlist ||= this.getLikedPlaylist(cookie)) : await this.getLikedPlaylist(cookie);
    const songs = await this.#readPlaylistSongs(liked.id, { limit, offset, likedSession: session }, extractUin(cookie) || '0');
    if (session && !session.songs && (offset === 0 || session.publicSongOffsets)) {
      return publicLikedTrackPage(songs, session, offset, limit, liked.trackCount);
    }
    const nextOffset = offset + songs.length;
    return {
      tracks: songs.map(mapQQSong).filter(Boolean),
      nextOffset: songs.length === limit && nextOffset <= 200000 ? nextOffset : null,
    };
  }

  async getLikedPlaylist(cookieHeader) {
    const playlists = await this.getCreatedPlaylists({
      limit: 500,
      includeLiked: true,
    }, cookieHeader);
    const liked = playlists.find((playlist) => playlist.dirId === '201');
    if (!liked) {
      throw createPublicError('没有从 QQ 音乐读取到“我喜欢”，当前登录凭证不完整或已失效，请重新登录 QQ 音乐。', 501);
    }
    return liked;
  }

  async getCreatedPlaylists(options = {}, cookieHeader) {
    cookieHeader ??= await this.getLoginCookieHeader('QQ 音乐”我的歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin(cookieHeader);
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistBaseRead',
          method: 'GetPlaylistByUin',
          param: { uin },
        },
      }, cookieHeader);
      const moduleData = readQQModuleData(data, callKey, '读取我的歌单');
      if (!Array.isArray(moduleData.v_playlist)) throw createPublicError('QQ 音乐未返回歌单目录，请重试。', 501);
      playlists = moduleData.v_playlist;
    } catch (error) {
      if (error?.code !== 'QQ_CLIENT_AUTH_MISSING') cookieHeader = await this.getCookieForUin(uin);
      const gtkSource = extractQQGtkSource(cookieHeader);
      const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
      const data = await this.requestJson(QQ_CREATED_PLAYLIST_URL, {
        hostUin: '0',
        hostuin: uin,
        sin: '0',
        size: String(Math.max(limit, 50)),
        g_tk: String(gtk),
        loginUin: uin,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, cookieHeader);
      if (Number(data?.code ?? 0) !== 0 || !Array.isArray(data?.data?.disslist)) {
        throw createPublicError('QQ 音乐未返回歌单目录，请重试。', 501);
      }
      playlists = data.data.disslist;
    }
    const mapped = playlists.map(mapQQPlaylist).filter(Boolean);
    if (options.includeLiked === false) {
      return mapped.filter((playlist) => playlist.dirId !== '201').slice(0, limit);
    }
    return mapped.slice(0, limit);
  }

  async getCollectedPlaylists(options = {}) {
    let cookieHeader = await this.getLoginCookieHeader('QQ 音乐”收藏歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin(cookieHeader);
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistFavRead';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistFavRead',
          method: 'GetPlaylistFavInfo',
          param: { uin },
        },
      }, cookieHeader);
      const moduleData = readQQModuleData(data, callKey, '读取收藏歌单');
      if (!Array.isArray(moduleData.v_list)) throw createPublicError('QQ 音乐未返回收藏歌单目录，请重试。', 501);
      playlists = moduleData.v_list;
    } catch (error) {
      if (error?.code !== 'QQ_CLIENT_AUTH_MISSING') cookieHeader = await this.getCookieForUin(uin);
      const gtkSource = extractQQGtkSource(cookieHeader);
      const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
      const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
        ct: '20',
        cid: '205360956',
        userid: uin,
        reqtype: '3',
        sin: '0',
        ein: String(limit),
        g_tk: String(gtk),
        loginUin: uin,
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        platform: 'yqq.json',
        needNewCode: '0',
      }, cookieHeader);
      if (Number(data?.code ?? 0) !== 0 || !Array.isArray(data?.data?.cdlist)) {
        throw createPublicError('QQ 音乐未返回收藏歌单目录，请重试。', 501);
      }
      playlists = data.data.cdlist;
    }
    return playlists.map(mapQQPlaylist).filter(Boolean).slice(0, limit);
  }

  async addTracksToPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('AddSonglist', playlist, tracks);
  }

  async removeTracksFromPlaylist(playlist, tracks) {
    return this.writePlaylistTracks('DelSonglist', playlist, tracks);
  }

  async writePlaylistTracks(method, playlist, tracks) {
    const cookie = await this.getLoginCookieHeader('修改 QQ 音乐歌单需要先登录。');
    const songInfo = normalizeQQPlaylistSongInfo(tracks);
    if (playlist?.id !== 'liked') return this.requestPlaylistWrite(method, normalizeQQPlaylistWriteTarget(playlist), songInfo, cookie);
    const target = normalizeQQPlaylistWriteTarget(await this.getLikedPlaylist(cookie));
    return this.requestPlaylistWrite(method, target, songInfo, await this.getCookieForUin(extractUin(cookie) || '0'));
  }

  async getRecentTracks(options = {}) {
    let cookieHeader = await this.getLoginCookieHeader('QQ 音乐”最近播放”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin(cookieHeader);

    // Try newer musicu API first
    let musicuDiagnostic = null;
    try {
      const musicuResponse = await this.requestMusicu({
        req_0: {
          module: 'music.globalchannel.GlobalChannelSvr',
          method: 'GetPlayHistory',
          param: { uin, start: 0, num: limit },
        },
      }, cookieHeader);
      musicuDiagnostic = musicuResponse && musicuResponse.req_0;
      const list =
        musicuResponse &&
        musicuResponse.req_0 &&
        musicuResponse.req_0.data &&
        Array.isArray(musicuResponse.req_0.data.result_song_list)
          ? musicuResponse.req_0.data.result_song_list
          : null;
      if (list && list.length > 0) {
        const songs = list
          .map((item) => mapQQSong(item && (item.songInfo || item)))
          .filter(Boolean)
          .slice(0, limit);
        if (songs.length > 0) return songs;
      }
    } catch (error) {
      musicuDiagnostic = { error: error && error.message };
    }

    // Legacy API fallback
    cookieHeader = await this.getCookieForUin(uin);
    const gtkSource = extractQQGtkSource(cookieHeader);
    const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
    const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '4',
      sin: '0',
      ein: String(limit),
      g_tk: String(gtk),
      loginUin: uin,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: '0',
    }, cookieHeader);
    const rawData = data && data.data;
    const songlist = Array.isArray(rawData?.songlist) ? rawData.songlist
      : Array.isArray(rawData?.song_list) ? rawData.song_list : [];
    const songs = songlist.map(mapQQSong).filter(Boolean).slice(0, limit);
    if (songs.length > 0) return songs;
    const legacyKeys = rawData ? Object.keys(rawData) : 'null';
    throw Object.assign(new Error(
      `QQ 音乐没有返回最近播放歌曲。` +
        `[musicu:${JSON.stringify(
          musicuDiagnostic && {
            code: musicuDiagnostic.code,
            dataKeys: musicuDiagnostic.data ? Object.keys(musicuDiagnostic.data) : null,
          },
        )}]` +
        `[legacy keys:${JSON.stringify(legacyKeys)}]`,
    ), { statusCode: 501, publicMessage: 'QQ 音乐没有返回最近播放歌曲，请稍后重试。' });
  }

  async getPlaylistTracks(playlistId, options = {}, expectedUin) {
    return (await this.#readPlaylistSongs(playlistId, options, expectedUin)).map(mapQQSong).filter(Boolean);
  }

  async playlistContainsTrack(playlistId, track) {
    const id = Number(track?.sourceSongId);
    const mid = String(track?.sourceTrackId || track?.id || '').replace(/^qq:/, '').trim();
    const songs = await this.#readPlaylistSongs(playlistId, { limit: 5000 });
    return Number.isSafeInteger(id) && id > 0 ? songs.some((song) => song && qqSongId(song) === id)
      : Boolean(mid) && songs.some((song) => song && qqSongMid(song) === mid);
  }

  async #readPlaylistSongs(playlistId, options, expectedUin) {
    const id = String(playlistId || '').trim();
    if (!id) throw createPublicError('缺少 QQ 音乐歌单 ID。', 501);
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    let cookieHeader = expectedUin === undefined ? await this.getSafeCookieHeader() : await this.getCookieForUin(expectedUin);
    const uin = extractUin(cookieHeader) || '0';
    if (uin !== '0' && (extractCookieValue(cookieHeader, 'qm_keyst') || extractCookieValue(cookieHeader, 'qqmusic_key'))) {
      try {
        if (options.likedSession?.songs) {
          return options.likedSession.songs.slice(offset, offset + limit);
        }
        const callKey = 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo';
        const data = await this.requestMusicsClient({
          [callKey]: {
            module: 'music.srfDissInfo.DissInfoForPc',
            method: 'uniform_get_Dissinfo',
            param: {
              disstid: Number(id),
              host_uin: Number(uin),
              login_uin: Number(uin),
            },
          },
        }, cookieHeader);
        const moduleData = readQQModuleData(data, callKey, '读取歌单详情');
        const songlist = moduleData.songlist;
        if (!Array.isArray(songlist)) throw createPublicError('QQ 音乐未返回歌单曲目，请重试。', 501);
        if (options.likedSession) options.likedSession.songs = songlist;
        return songlist.slice(offset, offset + limit);
      } catch (_) {
        // 网页登录态不一定具备桌面客户端权限，继续使用公开歌单详情接口。
        cookieHeader = await this.getCookieForUin(uin);
      }
    }

    const gtkSource = extractQQGtkSource(cookieHeader);
    const gtk = gtkSource ? calcQQGtk(gtkSource) : 5381;
    const params = {
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: id,
      format: 'json',
      g_tk: String(gtk),
      loginUin: uin,
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0',
    };
    if (limit <= 100 || offset > 0) {
      params.song_begin = String(offset);
      params.song_num = String(limit);
    }
    const data = await this.requestJson(QQ_PLAYLIST_DETAIL_URL, params, cookieHeader);
    const cdlist = data && Array.isArray(data.cdlist) ? data.cdlist : [];
    const songlist = cdlist[0]?.songlist;
    if (Number(data?.code ?? 0) !== 0 || !Array.isArray(songlist)) {
      throw createPublicError('QQ 音乐未返回歌单曲目，请重试。', 501);
    }
    if (options.likedSession) {
      const count = cdlist[0]?.total_song_num ?? cdlist[0]?.songnum;
      if (count != null && count !== '' && Number.isSafeInteger(Number(count)) && Number(count) >= 0) {
        options.likedSession.publicSongCount = Number(count);
      }
    }
    return songlist.slice(0, limit);
  }
}

module.exports = {
  QQMusicProvider,
};
