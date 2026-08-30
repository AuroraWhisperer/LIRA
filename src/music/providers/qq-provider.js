'use strict';

const { QQMusicStreamProvider } = require('./qq-provider-streams');
const {
  buildGuid,
  calcQQGtk,
  clampInteger,
  extractQQGtkSource,
  extractRadioSongs,
  extractUin,
  hasQQMusicAuthCookie,
  mapQQPlaylist,
  mapQQSong,
  mapRecommendCard,
  normalizeQQPlaylistSongInfo,
  normalizeQQPlaylistWriteTarget,
  readQQModuleData,
} = require('./qq-provider-utils');

const QQ_PLAYLIST_DETAIL_URL =
  'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const QQ_CREATED_PLAYLIST_URL =
  'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const QQ_COLLECTED_ASSET_URL =
  'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';

class QQMusicProvider extends QQMusicStreamProvider {
  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 9);
    const page = clampInteger(options.page, 1, 50, 1);
    const vUniq = Array.isArray(options.vUniq)
      ? options.vUniq.slice(0, 200)
      : [];
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
    );

    const shelves =
      data &&
      data.req_1 &&
      data.req_1.data &&
      Array.isArray(data.req_1.data.v_shelf)
        ? data.req_1.data.v_shelf
        : [];
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
    const limit = clampInteger(options.limit, 1, 100, 30);
    const page = clampInteger(options.page, 1, 50, 1);
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
    for (let p = page; p < page + maxPages && tracks.length < limit; p++) {
      const data = await this.requestMusicuPost(
        {
          req_1: {
            module: 'music.recommend.RecommendFeed',
            method: 'get_recommend_feed',
            param: { direction: 1, page: p, v_cache: [], v_uniq: [], s_num: 4 },
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
      ).catch(() => null);

      const shelves =
        data &&
        data.req_1 &&
        data.req_1.data &&
        Array.isArray(data.req_1.data.v_shelf)
          ? data.req_1.data.v_shelf
          : [];

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
      if (songIds.length === 0) break;

      // 第二步：批量拉完整歌曲信息（含 mid / singer / album / interval）
      const resolved = await this.resolveTrackInfoByIds(songIds, uin, guid);
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

    if (tracks.length > 0) return tracks;
    // Feed 没有单曲卡片（极少情况）时退回电台
    return this.getRadioTracks({ limit, page });
  }

  // 把 type 200 的 songId 列表批量转成完整歌曲对象（含 mid）
  async resolveTrackInfoByIds(ids, uin, guid) {
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
    ).catch(() => null);
    return data &&
      data.req_1 &&
      data.req_1.data &&
      Array.isArray(data.req_1.data.tracks)
      ? data.req_1.data.tracks
      : [];
  }

  async getRadioTracks(options = {}) {
    const limit = clampInteger(options.limit, 1, 50, 20);
    const page = clampInteger(options.page, 1, 50, 1);
    const radioId = clampInteger(options.radioId, 1, 9999, 101);
    // 电台一次只回 5 首左右，所以要连抓几轮凑够 limit。
    // firstplay=1 表示「开始新一轮」，之后用 0 才会继续往下发新歌；
    // 每次调用换新 guid 也能让服务端换一批，两个手段一起用。
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
      let fresh = 0;
      for (const song of batch) {
        const mapped = mapQQSong(song);
        if (!mapped || seen.has(mapped.sourceTrackId)) continue;
        seen.add(mapped.sourceTrackId);
        tracks.push(mapped);
        fresh++;
        if (tracks.length >= limit) break;
      }
      // 服务端开始重复发同一批就停，避免空转。
      if (fresh === 0) break;
    }
    return tracks.slice(0, limit);
  }

  async getLikedTracks(options = {}) {
    await this.requireLogin('QQ 音乐”我喜欢”需要先登录。');
    const limit = clampInteger(options.limit, 1, 5000, 200);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const playlists = await this.getCreatedPlaylists({
      limit: 50,
      includeLiked: true,
    });
    const liked = playlists.find(
      (playlist) =>
        playlist.dirId === '201' || /我喜欢|喜欢/.test(playlist.title),
    );
    if (!liked) {
      throw new Error(
        '没有从 QQ 音乐读取到“我喜欢”，当前登录凭证不完整或已失效，请重新登录 QQ 音乐。',
      );
    }
    return this.getPlaylistTracks(liked.id, { limit, offset });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐”我的歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistBaseRead',
          method: 'GetPlaylistByUin',
          param: { uin },
        },
      });
      const moduleData = readQQModuleData(data, callKey, '读取我的歌单');
      playlists = Array.isArray(moduleData.v_playlist)
        ? moduleData.v_playlist
        : [];
    } catch (_) {
      const cookieHeader = await this.getSafeCookieHeader();
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
      });
      playlists =
        data && data.data && Array.isArray(data.data.disslist)
          ? data.data.disslist
          : [];
    }
    const mapped = playlists.map(mapQQPlaylist).filter(Boolean);
    if (options.includeLiked === false) {
      return mapped
        .filter((playlist) => playlist.dirId !== '201')
        .slice(0, limit);
    }
    return mapped.slice(0, limit);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐”收藏歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    let playlists;
    try {
      const callKey = 'music.musicasset.PlaylistFavRead';
      const data = await this.requestMusicsClient({
        [callKey]: {
          module: 'music.musicasset.PlaylistFavRead',
          method: 'GetPlaylistFavInfo',
          param: { uin },
        },
      });
      const moduleData = readQQModuleData(data, callKey, '读取收藏歌单');
      playlists = Array.isArray(moduleData.v_list) ? moduleData.v_list : [];
    } catch (_) {
      const cookieHeader = await this.getSafeCookieHeader();
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
      });
      playlists =
        data && data.data && Array.isArray(data.data.cdlist)
          ? data.data.cdlist
          : [];
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
    await this.requireLogin('修改 QQ 音乐歌单需要先登录。');
    const target = normalizeQQPlaylistWriteTarget(playlist);
    const songInfo = normalizeQQPlaylistSongInfo(tracks);
    return this.requestPlaylistWrite(method, target, songInfo);
  }

  async getRecentTracks(options = {}) {
    await this.requireLogin('QQ 音乐”最近播放”需要先登录。');
    const limit = clampInteger(options.limit, 1, 100, 50);
    const uin = await this.requireUin();

    // Try newer musicu API first
    let muDebug = null;
    try {
      const muData = await this.requestMusicu({
        req_0: {
          module: 'music.globalchannel.GlobalChannelSvr',
          method: 'GetPlayHistory',
          param: { uin, start: 0, num: limit },
        },
      });
      muDebug = muData && muData.req_0;
      const list =
        muData &&
        muData.req_0 &&
        muData.req_0.data &&
        Array.isArray(muData.req_0.data.result_song_list)
          ? muData.req_0.data.result_song_list
          : null;
      if (list && list.length > 0) {
        const songs = list
          .map((item) => mapQQSong(item && (item.songInfo || item)))
          .filter(Boolean)
          .slice(0, limit);
        if (songs.length > 0) return songs;
      }
    } catch (e) {
      muDebug = { error: e && e.message };
    }

    // Legacy API fallback
    const cookieHeader = await this.getSafeCookieHeader();
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
    });
    const rawData = data && data.data;
    const songlist =
      rawData &&
      (Array.isArray(rawData.songlist)
        ? rawData.songlist
        : Array.isArray(rawData.song_list)
          ? rawData.song_list
          : []);
    const songs = songlist.map(mapQQSong).filter(Boolean).slice(0, limit);
    if (songs.length > 0) return songs;
    const legacyKeys = rawData ? Object.keys(rawData) : 'null';
    throw new Error(
      `QQ 音乐没有返回最近播放歌曲。` +
        `[musicu:${JSON.stringify(muDebug && { code: muDebug.code, dataKeys: muDebug.data ? Object.keys(muDebug.data) : null })}]` +
        `[legacy keys:${JSON.stringify(legacyKeys)}]`,
    );
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少 QQ 音乐歌单 ID。');
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    if (hasQQMusicAuthCookie(cookieHeader)) {
      try {
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
        });
        const moduleData = readQQModuleData(data, callKey, '读取歌单详情');
        const songlist = Array.isArray(moduleData.songlist)
          ? moduleData.songlist
          : [];
        return songlist
          .slice(offset, offset + limit)
          .map(mapQQSong)
          .filter(Boolean);
      } catch (_) {
        // 网页登录态不一定具备桌面客户端权限，继续使用公开歌单详情接口。
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
    const data = await this.requestJson(QQ_PLAYLIST_DETAIL_URL, params);
    const cdlist = data && Array.isArray(data.cdlist) ? data.cdlist : [];
    const songlist =
      cdlist[0] && Array.isArray(cdlist[0].songlist) ? cdlist[0].songlist : [];
    return songlist.slice(0, limit).map(mapQQSong).filter(Boolean);
  }
}

module.exports = {
  QQMusicProvider,
};
