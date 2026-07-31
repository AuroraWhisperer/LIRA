'use strict';

const { parseLyricResult } = require('../lyrics');

const QQ_SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp';
const QQ_LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';
const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_PLAYLIST_DETAIL_URL = 'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg';
const QQ_PROFILE_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg';
const QQ_CREATED_PLAYLIST_URL = 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss';
const QQ_COLLECTED_ASSET_URL = 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg';
const REQUEST_TIMEOUT_MS = 10000;
const STREAM_TTL_MS = 5 * 60 * 1000;

class QQMusicProvider {
  constructor(options = {}) {
    this.source = 'qq';
    this.name = 'QQ音乐';
    this.getAuthState = typeof options.getAuthState === 'function'
      ? options.getAuthState
      : () => null;
    this.getCookieHeader = typeof options.getCookieHeader === 'function'
      ? options.getCookieHeader
      : () => '';
  }

  async healthCheck() {
    const auth = await this.getSafeAuthState();
    try {
      await this.searchTracks('晴天', { limit: 1 });
      const loggedIn = Boolean(auth && auth.loggedIn);
      return {
        source: this.source,
        name: this.name,
        ok: true,
        status: loggedIn ? 'logged-in' : 'public-ok',
        message: loggedIn
          ? 'QQ 音乐公开接口可用，已检测到登录 Cookie。'
          : 'QQ 音乐公开搜索接口可用，播放和账号歌单需要登录后验证。',
        auth: sanitizeAuthState(auth)
      };
    } catch (error) {
      return {
        source: this.source,
        name: this.name,
        ok: false,
        status: 'api-error',
        message: `QQ 音乐接口检查失败：${error.message || String(error)}`,
        auth: sanitizeAuthState(auth)
      };
    }
  }

  async searchTracks(keyword, options = {}) {
    const query = String(keyword || '').trim();
    if (!query) throw new Error('缺少搜索关键词。');
    const limit = clampInteger(options.limit, 1, 30, 20);
    const data = await this.requestJson(QQ_SEARCH_URL, {
      new_json: '1',
      t: '0',
      aggr: '1',
      cr: '1',
      catZhida: '1',
      lossless: '0',
      p: String(clampInteger(options.page, 1, 50, 1)),
      n: String(limit),
      w: query,
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    const songs = data && data.data && data.data.song && Array.isArray(data.data.song.list)
      ? data.data.song.list
      : [];
    return songs.map(mapQQSong).filter(Boolean);
  }

  async getLyrics(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const data = await this.requestJson(QQ_LYRIC_URL, {
      songmid: sourceTrackId,
      pcachetime: String(Date.now()),
      g_tk: '5381',
      loginUin: extractUin(await this.getSafeCookieHeader()) || '0',
      hostUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    return {
      source: this.source,
      sourceTrackId,
      lines: parseLyricResult(
        decodeQQBase64(data && data.lyric),
        decodeQQBase64(data && data.trans),
        '',
        decodeQQBase64(data && data.romalrc)
      )
    };
  }

  async resolvePlayableUrl(track) {
    const sourceTrackId = extractSourceTrackId(track);
    const guid = buildGuid();
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    const data = await this.requestJson(QQ_MUSICU_URL, {
      data: JSON.stringify({
        req: {
          module: 'CDN.SrfCdnDispatchServer',
          method: 'GetCdnDispatch',
          param: { guid, calltype: 0, userip: '' }
        },
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            guid,
            songmid: [sourceTrackId],
            songtype: [0],
            uin,
            loginflag: cookieHeader ? 1 : 0,
            platform: '20'
          }
        },
        comm: {
          uin,
          format: 'json',
          ct: 24,
          cv: 0
        }
      })
    });
    const midUrlInfo = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.midurlinfo)
      ? data.req_0.data.midurlinfo[0]
      : null;
    const purl = midUrlInfo && midUrlInfo.purl ? String(midUrlInfo.purl) : '';
    if (!purl) throw new Error('当前 QQ 音乐账号无法播放该歌曲。');
    const sip = data && data.req_0 && data.req_0.data && Array.isArray(data.req_0.data.sip)
      ? data.req_0.data.sip
      : [];
    const baseUrl = sip.find(Boolean) || 'https://isure.stream.qqmusic.qq.com/';
    const expiresAt = Date.now() + STREAM_TTL_MS;
    return {
      source: this.source,
      sourceTrackId,
      url: `${baseUrl}${purl}`,
      expireAt: expiresAt,
      playUrlExpireAt: expiresAt
    };
  }

  async getPersonalizedPlaylists(options = {}) {
    const limit = clampInteger(options.limit, 1, 30, 12);
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
            s_num: 4
          }
        }
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
        needNewCode: 1
      }
    );

    const shelves = data && data.req_1 && data.req_1.data && Array.isArray(data.req_1.data.v_shelf)
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
            param: { direction: 1, page: p, v_cache: [], v_uniq: [], s_num: 4 }
          }
        },
        {
          format: 'json', ct: 20, cv: 2241, platform: 'wk_v17',
          guid, uin, inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
        }
      ).catch(() => null);

      const shelves = data && data.req_1 && data.req_1.data
        && Array.isArray(data.req_1.data.v_shelf) ? data.req_1.data.v_shelf : [];

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
            source: 'AiNoFree'
          }
        }
      },
      {
        format: 'json', ct: 20, cv: 2241, platform: 'wk_v17',
        guid: guid || buildGuid(),
        uin: uin || '0',
        inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
      }
    ).catch(() => null);
    return data && data.req_1 && data.req_1.data
      && Array.isArray(data.req_1.data.tracks) ? data.req_1.data.tracks : [];
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
            num: Math.max(15, limit)
          }
        }
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
    const playlists = await this.getCreatedPlaylists({ limit: 50, includeLiked: true });
    const liked = playlists.find((playlist) => playlist.dirId === '201' || /我喜欢|喜欢/.test(playlist.title))
      || playlists[0];
    if (!liked) return [];
    return this.getPlaylistTracks(liked.id, { limit, offset });
  }

  async getCreatedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐“我的歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    const data = await this.requestJson(QQ_CREATED_PLAYLIST_URL, {
      hostUin: '0',
      hostuin: uin,
      sin: '0',
      size: String(Math.max(limit, 50)),
      g_tk: '5381',
      loginUin: '0',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq.json',
      needNewCode: '0'
    });
    if (Number(data && data.code) === 4000) return [];
    const playlists = data && data.data && Array.isArray(data.data.disslist)
      ? data.data.disslist
      : [];
    const mapped = playlists.map(mapQQPlaylist).filter(Boolean);
    if (options.includeLiked === false) {
      return mapped.filter((playlist) => playlist.dirId !== '201').slice(0, limit);
    }

    if (!mapped.some((playlist) => playlist.dirId === '201')) {
      const liked = await this.getLikedPlaylistFromProfile(uin);
      if (liked) mapped.unshift(liked);
    }
    return mapped.slice(0, limit);
  }

  async getCollectedPlaylists(options = {}) {
    await this.requireLogin('QQ 音乐”收藏歌单”需要先登录。');
    const limit = clampInteger(options.limit, 1, 500, 200);
    const uin = await this.requireUin();
    const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '3',
      sin: '0',
      ein: String(limit)
    });
    const playlists = data && data.data && Array.isArray(data.data.cdlist)
      ? data.data.cdlist
      : [];
    return playlists.map(mapQQPlaylist).filter(Boolean).slice(0, limit);
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
          param: { uin, start: 0, num: limit }
        }
      });
      muDebug = muData && muData.req_0;
      const list = muData && muData.req_0 && muData.req_0.data
        && Array.isArray(muData.req_0.data.result_song_list)
        ? muData.req_0.data.result_song_list
        : null;
      if (list && list.length > 0) {
        const songs = list
          .map((item) => mapQQSong(item && (item.songInfo || item)))
          .filter(Boolean)
          .slice(0, limit);
        if (songs.length > 0) return songs;
      }
    } catch (e) { muDebug = { error: e && e.message }; }

    // Legacy API fallback
    const data = await this.requestJson(QQ_COLLECTED_ASSET_URL, {
      ct: '20',
      cid: '205360956',
      userid: uin,
      reqtype: '4',
      sin: '0',
      ein: String(limit)
    });
    const rawData = data && data.data;
    const songlist = rawData && (
      Array.isArray(rawData.songlist) ? rawData.songlist :
      Array.isArray(rawData.song_list) ? rawData.song_list :
      []
    );
    const songs = songlist.map(mapQQSong).filter(Boolean).slice(0, limit);
    if (songs.length > 0) return songs;
    const legacyKeys = rawData ? Object.keys(rawData) : 'null';
    throw new Error(
      `QQ 音乐没有返回最近播放歌曲。` +
      `[musicu:${JSON.stringify(muDebug && { code: muDebug.code, dataKeys: muDebug.data ? Object.keys(muDebug.data) : null })}]` +
      `[legacy keys:${JSON.stringify(legacyKeys)}]`
    );
  }

  async getPlaylistTracks(playlistId, options = {}) {
    const id = String(playlistId || '').trim();
    if (!id) throw new Error('缺少 QQ 音乐歌单 ID。');
    const limit = clampInteger(options.limit, 1, 5000, 1000);
    const offset = clampInteger(options.offset, 0, 200000, 0);
    const data = await this.requestJson(QQ_PLAYLIST_DETAIL_URL, {
      type: '1',
      json: '1',
      utf8: '1',
      onlysong: '0',
      disstid: id,
      format: 'json',
      g_tk: '5381',
      loginUin: extractUin(await this.getSafeCookieHeader()) || '0',
      hostUin: '0',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      notice: '0',
      platform: 'yqq',
      needNewCode: '0'
    });
    const cdlist = data && Array.isArray(data.cdlist) ? data.cdlist : [];
    const songlist = cdlist[0] && Array.isArray(cdlist[0].songlist) ? cdlist[0].songlist : [];
    return songlist.slice(offset, offset + limit).map(mapQQSong).filter(Boolean);
  }

  async requestMusicu(modules = {}) {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader) || '0';
    return this.requestJson(QQ_MUSICU_URL, {
      data: JSON.stringify({
        ...modules,
        comm: {
          uin,
          format: 'json',
          ct: 24,
          cv: 0
        }
      })
    });
  }

  async requestMusicuPost(modules = {}, comm = {}) {
    const url = new URL(QQ_MUSICU_URL);
    const headers = await this.buildHeaders();
    headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...modules, comm }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async requestText(rawUrl, params = {}) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: await this.buildHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return text;
  }

  async requestJson(rawUrl, params = {}) {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: await this.buildHeaders(),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try {
      return JSON.parse(stripJsonp(text));
    } catch (error) {
      throw new Error(`QQ 音乐返回了非 JSON 响应：${error.message}`);
    }
  }

  async buildHeaders() {
    const headers = {
      Accept: 'application/json,text/plain,*/*',
      Origin: 'https://y.qq.com',
      Referer: 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
    };
    const cookieHeader = await this.getSafeCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
    return headers;
  }

  async getSafeAuthState() {
    try {
      return await this.getAuthState(this.source);
    } catch (_) {
      return null;
    }
  }

  async getSafeCookieHeader() {
    try {
      return String(await this.getCookieHeader(this.source) || '');
    } catch (_) {
      return '';
    }
  }

  async requireLogin(message) {
    const auth = await this.getSafeAuthState();
    const cookieHeader = await this.getSafeCookieHeader();
    if ((!auth || !auth.loggedIn) && !cookieHeader) {
      throw new Error(message || '需要先登录 QQ 音乐。');
    }
    return auth;
  }

  async requireUin() {
    const cookieHeader = await this.getSafeCookieHeader();
    const uin = extractUin(cookieHeader);
    if (!uin) throw new Error('没有从 QQ 音乐 Cookie 中读取到 QQ 号，请重新登录。');
    return uin;
  }

  async getLikedPlaylistFromProfile(uin) {
    const data = await this.requestJson(QQ_PROFILE_URL, {
      cid: '205360838',
      userid: uin,
      reqfrom: '1',
      g_tk: '5381',
      format: 'json',
      inCharset: 'utf8',
      outCharset: 'utf-8',
      platform: 'yqq.json'
    });
    const mymusic = data && data.data && Array.isArray(data.data.mymusic)
      ? data.data.mymusic
      : [];
    const fav = mymusic[0];
    if (!fav || !fav.id) return null;
    return {
      id: String(fav.id),
      source: this.source,
      title: '我喜欢',
      description: '',
      coverUrl: 'https://y.gtimg.cn/mediastyle/global/img/cover_like.png',
      trackCount: Math.max(0, Number(fav.num0 || fav.song_cnt || fav.songnum || 0)),
      playCount: 0,
      creatorUserId: uin,
      dirId: '201'
    };
  }
}

function mapQQSong(song) {
  if (!song) return null;
  const sourceTrackId = String(song.mid || song.songmid || song.song_mid || song.SongMid || song.songMid || '').trim();
  const title = String(song.title || song.name || song.songname || song.SongName || song.SongTitle || '').trim();
  if (!sourceTrackId || !title) return null;
  const album = song.album || {};
  const singers = Array.isArray(song.singer)
    ? song.singer
    : (Array.isArray(song.singers) ? song.singers : []);
  const singerName = String(song.SingerName || song.SingerTitle || '').trim();
  const albumMid = album && (album.mid || album.pmid)
    ? String(album.mid || album.pmid)
    : String(song.albummid || song.AlbumMid || '');
  return {
    id: `qq:${sourceTrackId}`,
    source: 'qq',
    sourceTrackId,
    sourceAlbumId: album && (album.mid || album.id) ? String(album.mid || album.id) : albumMid,
    title,
    artists: singers.map((artist) => String(artist && artist.name || '').trim()).filter(Boolean)
      .concat(singerName ? [singerName] : []),
    album: String(album && (album.title || album.name) || song.albumname || song.albumdesc || song.AlbumName || song.AlbumTitle || '').trim(),
    durationMs: Math.max(0, Number(song.interval || song.SongPlayTime || 0) * 1000),
    coverUrl: extractQQCoverUrl(song, albumMid),
    playable: true,
    vip: Number(song.pay && song.pay.pay_play || song.Vip || 0) > 0
  };
}

function mapQQPlaylist(playlist) {
  if (!playlist) return null;
  const id = playlist.content_id || playlist.dissid || playlist.tid || playlist.id;
  const title = playlist.title || playlist.dissname || playlist.diss_name || playlist.name;
  if (!id || !title) return null;
  return {
    id: String(id),
    source: 'qq',
    title: String(title || '').trim(),
    description: String(playlist.desc || playlist.subtitle || playlist.rcmdcontent || '').trim(),
    coverUrl: String(playlist.cover || playlist.picurl || playlist.imgurl || playlist.logo || playlist.diss_cover || ''),
    trackCount: Math.max(0, Number(playlist.song_cnt || playlist.songnum || playlist.total_song_num || playlist.count || 0)),
    playCount: Math.max(0, Number(playlist.listen_num || playlist.listennum || playlist.playcnt || playlist.access_num || 0)),
    creatorUserId: playlist.uin || playlist.hostuin ? String(playlist.uin || playlist.hostuin) : '',
    dirId: playlist.dirid ? String(playlist.dirid) : ''
  };
}

function mapRecommendCard(card) {
  if (!card || !card.id || !card.title) return null;
  return {
    id: String(card.id),
    source: 'qq',
    title: String(card.title || '').trim(),
    description: String(card.subtitle || '').trim(),
    coverUrl: String(card.cover || ''),
    trackCount: 0,
    playCount: Math.max(0, Number(card.cnt || 0)),
    creatorUserId: '',
    dirId: ''
  };
}

function extractSourceTrackId(track) {
  const sourceTrackId = String(track && (track.sourceTrackId || track.id) || '')
    .replace(/^qq:/, '')
    .trim();
  if (!sourceTrackId) throw new Error('缺少 QQ 音乐歌曲 ID。');
  return sourceTrackId;
}

function decodeQQBase64(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return Buffer.from(text, 'base64').toString('utf8');
  } catch (_) {
    return '';
  }
}

function stripJsonp(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
  return match ? match[1] : raw;
}

function extractRadioSongs(data) {
  const radioData = data && data.songlist && data.songlist.data ? data.songlist.data : {};
  if (Array.isArray(radioData.tracks)) return radioData.tracks;
  if (Array.isArray(radioData.track_list)) return radioData.track_list;
  if (Array.isArray(radioData.songlist)) return radioData.songlist;
  return [];
}

function buildQQCoverUrl(albumMid) {
  const mid = String(albumMid || '').trim();
  return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : '';
}

function extractQQCoverUrl(song, albumMid) {
  const album = song && song.album ? song.album : {};
  const directUrl = song && (
    song.coverUrl
    || song.cover
    || song.picurl
    || song.imgurl
    || song.albumcover
    || song.strMediaMid
    || song.AlbumPic
    || song.AlbumPic150X150
    || song.AlbumPic300X300
    || song.AlbumPic500X500
    || song.SingerPic
    || song.SingerPic300X300
    || album.picUrl
    || album.picurl
    || album.imgurl
  );
  const text = String(directUrl || '').trim();
  if (/^https?:\/\//i.test(text)) return text;
  return buildQQCoverUrl(albumMid);
}

function extractQQRecentSongs(data, limit) {
  const candidates = [];
  collectQQRecentSongContainers(data, candidates, false);
  for (const candidate of candidates) {
    const songs = collectQQSongsFromObject(candidate).slice(0, limit);
    if (songs.length > 0) return songs;
  }
  return [];
}

function collectQQRecentSongContainers(value, output = [], inRecentContainer = false) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const item of value) collectQQRecentSongContainers(item, output, inRecentContainer);
    return output;
  }

  const type = Number(value.Type || value.type || value.ResourceType || value.resourceType || 0);
  if (type === 2 && value.Detail) output.push(value.Detail);

  for (const [key, child] of Object.entries(value)) {
    const isRecentKey = /recent|playhistory|history/i.test(key);
    if ((inRecentContainer || isRecentKey) && /songlist|song_list|list|items|detail/i.test(key)) {
      output.push(child);
    }
    collectQQRecentSongContainers(child, output, inRecentContainer || isRecentKey);
  }
  return output;
}

function collectQQSongsFromObject(value, output = [], seen = new Set()) {
  if (!value || output.length >= 100) return output;
  if (Array.isArray(value)) {
    const mapped = value.map(mapQQSong).filter(Boolean);
    if (mapped.length >= Math.min(value.length, 2)) {
      for (const song of mapped) {
        if (!seen.has(song.id)) {
          seen.add(song.id);
          output.push(song);
        }
      }
      return output;
    }
    for (const item of value) collectQQSongsFromObject(item, output, seen);
    return output;
  }
  if (typeof value !== 'object') return output;
  const song = mapQQSong(value);
  if (song && !seen.has(song.id)) {
    seen.add(song.id);
    output.push(song);
  }
  for (const child of Object.values(value)) collectQQSongsFromObject(child, output, seen);
  return output;
}

function extractUin(cookieHeader) {
  const text = String(cookieHeader || '');
  const match = text.match(/(?:^|;\s*)(?:uin|o_cookie)=o?(\d+)/);
  return match ? match[1] : '';
}

function buildGuid() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function sanitizeAuthState(auth) {
  return {
    loggedIn: Boolean(auth && auth.loggedIn),
    cookieCount: Number(auth && auth.cookieCount) || 0,
    keyCookieNames: Array.isArray(auth && auth.keyCookieNames) ? auth.keyCookieNames : [],
    encryptedSnapshotExists: Boolean(auth && auth.encryptedSnapshotExists),
    lastSavedAt: auth && auth.lastSavedAt ? auth.lastSavedAt : ''
  };
}

module.exports = {
  QQMusicProvider
};
