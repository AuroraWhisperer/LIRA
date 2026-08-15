'use strict';

const { decryptQrc } = require('qrc-decoder');

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
  const numericSongId = Number(song.id || song.songid || song.songId || song.song_id || song.SongId || song.SongID || 0);
  return {
    id: `qq:${sourceTrackId}`,
    source: 'qq',
    sourceTrackId,
    sourceSongId: Number.isSafeInteger(numericSongId) && numericSongId > 0 ? numericSongId : 0,
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
  const title = playlist.title || playlist.dissname || playlist.diss_name || playlist.name || playlist.dirName;
  if (!id || !title) return null;
  return {
    id: String(id),
    source: 'qq',
    title: String(title || '').trim(),
    description: String(playlist.desc || playlist.subtitle || playlist.rcmdcontent || '').trim(),
    coverUrl: String(playlist.cover || playlist.picurl || playlist.imgurl || playlist.logo || playlist.diss_cover || playlist.picUrl || playlist.bigpicUrl || ''),
    trackCount: Math.max(0, Number(playlist.song_cnt || playlist.songnum || playlist.songNum || playlist.total_song_num || playlist.count || 0)),
    playCount: Math.max(0, Number(playlist.listen_num || playlist.listennum || playlist.playcnt || playlist.play_cnt || playlist.access_num || 0)),
    creatorUserId: playlist.uin || playlist.hostuin ? String(playlist.uin || playlist.hostuin) : '',
    dirId: playlist.dirid != null ? String(playlist.dirid) : (playlist.dirId != null ? String(playlist.dirId) : ''),
    tid: String(playlist.tid || playlist.content_id || playlist.dissid || playlist.id || '')
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

function extractSourceSongId(track) {
  const sourceSongId = Number(track && (track.sourceSongId || track.songId));
  return Number.isSafeInteger(sourceSongId) && sourceSongId > 0 ? sourceSongId : 0;
}

/**
 * Decode the hexadecimal payload returned by QQ Music's playable lyric API.
 * The legacy endpoint is handled separately because it returns plain Base64 text.
 */
function decodeQQPlayableLyric(value, encrypted) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!encrypted) return decodeQQBase64(text);
  if (text.length > 2 * 1024 * 1024 || text.length % 16 !== 0 || !/^[0-9a-f]+$/i.test(text)) {
    throw new Error('QQ 音乐返回了无效的加密歌词。');
  }
  try {
    return extractQrcLyricContent(decryptQrc(text));
  } catch (error) {
    throw new Error(`QQ 音乐歌词解密失败：${error && error.message ? error.message : String(error)}`);
  }
}

/** Extract the timed lyric text from QQ's optional QRC XML envelope. */
function extractQrcLyricContent(value) {
  const text = String(value || '');
  const match = text.match(/<Lyric_1\b[^>]*\bLyricContent="([\s\S]*?)"\s*\/>/i);
  return decodeXmlEntities(match ? match[1] : text);
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
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

function normalizeQQPlaylistWriteTarget(playlist) {
  if (!playlist || typeof playlist !== 'object') throw new Error('缺少 QQ 音乐歌单信息。');
  const dirId = Number(playlist.dirId);
  const tid = Number(playlist.tid || playlist.id);
  const dirName = String(playlist.title || playlist.dirName || '').trim();
  if (!Number.isSafeInteger(dirId) || dirId <= 0) throw new Error('QQ 音乐歌单 dirId 无效。');
  if (!Number.isSafeInteger(tid) || tid <= 0) throw new Error('QQ 音乐歌单 tid 无效。');
  if (!dirName) throw new Error('QQ 音乐歌单名称不能为空。');
  return { dirId, tid, dirName };
}

function normalizeQQPlaylistSongInfo(tracks) {
  const input = Array.isArray(tracks) ? tracks : [];
  const seen = new Set();
  const songs = [];
  for (const track of input.slice(0, 100)) {
    const songId = Number(track && (track.sourceSongId || track.songId));
    if (!Number.isSafeInteger(songId) || songId <= 0 || seen.has(songId)) continue;
    seen.add(songId);
    songs.push({ songId, songType: 0 });
  }
  if (songs.length === 0) throw new Error('缺少 QQ 音乐数值 songId，无法修改歌单。');
  return songs;
}

function extractCookieValue(cookieHeader, name) {
  const text = String(cookieHeader || '');
  const match = text.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : '';
}

function extractQQGtkSource(cookieHeader) {
  for (const name of ['qqmusic_key', 'qm_keyst', 'p_skey', 'skey']) {
    const value = extractCookieValue(cookieHeader, name);
    if (value) return value;
  }
  return '';
}

function readQQModuleData(data, callKey, action) {
  const inner = data && data[callKey];
  if (Number(data && data.code) !== 0 || Number(inner && inner.code) !== 0) {
    const code = inner && inner.code != null ? inner.code : (data && data.code);
    throw new Error(`QQ 音乐${action}失败（code=${code == null ? 'unknown' : code}）。`);
  }
  return inner && inner.data && typeof inner.data === 'object' ? inner.data : {};
}

function hasQQMusicAuthCookie(cookieHeader) {
  return ['qqmusic_key', 'qm_keyst', 'p_skey', 'skey'].some((name) => Boolean(extractCookieValue(cookieHeader, name)));
}

function calcQQGtk(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let i = 0; i < text.length; i++) hash += (hash << 5) + text.charCodeAt(i);
  return hash & 0x7fffffff;
}

function extractUin(cookieHeader) {
  const text = String(cookieHeader || '');
  // QQ 音乐/QQ 登录历史上用过的 Cookie 名五花八门：
  //   uin, qqmusic_uin, o_cookie, wxuin, qm_hideuin, p_uin, pt2gguin, superuin ...
  // 优先匹配 QQ 号专用的 Cookie 名，避免泛化模式错误匹配 p_uin/pt2gguin。
  // 值格式：o<QQ号> 或直接 <QQ号>

  // 第一优先级：精确匹配 qqmusic_uin、uin、o_cookie（最可靠的 QQ 号来源）
  // 使用单个正则按 cookie 字符串出现顺序匹配，避免 p_uin 等干扰项
  const primaryMatch = text.match(/(?:^|;\s*)(qqmusic_uin|uin|o_cookie)=o?(\d{5,15})/i);
  if (primaryMatch) return primaryMatch[2];

  // 第二优先级：WeChat uin（如果通过微信登录）
  const wxMatch = text.match(/(?:^|;\s*)wxuin=o?(\d{5,15})/i);
  if (wxMatch) return wxMatch[1];

  // 泛化回退：所有以 _uin 或 uin 结尾的 Cookie 名（qm_hideuin、p_uin 等）
  const match = text.match(/(?:^|;\s*)([\w-]*uin)=o?(\d{5,15})/i);
  if (match) return match[2];

  // 最后兜底：ptnick_<QQ号> 格式
  const nickMatch = text.match(/(?:^|;\s*)ptnick_(\d{5,15})=/);
  return nickMatch ? nickMatch[1] : '';
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
  buildGuid,
  calcQQGtk,
  clampInteger,
  decodeQQBase64,
  decodeQQPlayableLyric,
  extractCookieValue,
  extractQQGtkSource,
  extractRadioSongs,
  extractSourceSongId,
  extractSourceTrackId,
  extractUin,
  hasQQMusicAuthCookie,
  mapQQPlaylist,
  mapQQSong,
  mapRecommendCard,
  normalizeQQPlaylistSongInfo,
  normalizeQQPlaylistWriteTarget,
  readQQModuleData,
  sanitizeAuthState,
  stripJsonp
};
