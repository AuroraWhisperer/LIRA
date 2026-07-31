// 编写人：Aurora
// 播放助手工具函数模块
'use strict';

/**
 * 标准化在线音乐轨道数据
 * @param {Object} track - 原始轨道数据
 * @returns {Object} 标准化后的轨道对象
 */
export function normalizeOnlineTrack(track) {
  const source = track.source === 'netease' ? 'netease' : 'qq';
  const sourceTrackId = String(track.sourceTrackId || track.id || '').replace(`${source}:`, '');
  return {
    id: track.id || `${source}:${sourceTrackId}`,
    source,
    title: track.title || track.name || '未知歌曲',
    artists: Array.isArray(track.artists) ? track.artists : [],
    album: track.album || '',
    durationMs: Math.max(0, Number(track.durationMs) || 0),
    coverUrl: track.coverUrl || '',
    sourceTrackId,
    sourceAlbumId: track.sourceAlbumId || '',
    playable: track.playable !== false,
    vip: track.vip === true
  };
}

/**
 * 序列化轨道数据用于发送给音乐 Provider
 * @param {Object} track - 轨道对象
 * @returns {Object} 序列化后的轨道数据
 */
export function serializeTrackForProvider(track) {
  return {
    id: track.id,
    source: track.source,
    title: track.title,
    artists: Array.isArray(track.artists) ? track.artists : [],
    album: track.album || '',
    durationMs: track.durationMs || 0,
    coverUrl: track.coverUrl || '',
    sourceTrackId: track.sourceTrackId || track.id,
    sourceAlbumId: track.sourceAlbumId || '',
    playable: track.playable !== false,
    vip: track.vip === true
  };
}

/**
 * 随机打乱轨道数组（Fisher-Yates 算法）
 * @param {Array} tracks - 轨道数组
 * @returns {Array} 打乱后的新数组
 */
export function shuffleTracks(tracks) {
  const items = tracks.slice();
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * 判断是否为本地轨道
 * @param {Object} track - 轨道对象
 * @returns {boolean}
 */
export function isLocalTrack(track) {
  return !track || track.source === 'local';
}

/**
 * 检查轨道的播放 URL 是否仍然可用
 * @param {Object} track - 轨道对象
 * @param {number} refreshMarginMs - 刷新边界时间（毫秒）
 * @returns {boolean}
 */
export function hasUsableUrl(track, refreshMarginMs = 30000) {
  if (!track || !track.playUrl) return false;
  const expireAt = Number(track.playUrlExpireAt || 0);
  return !expireAt || expireAt - Date.now() > refreshMarginMs;
}

/**
 * 获取优先搜索的音乐平台列表
 * @param {string} currentSource - 当前播放歌曲的音乐源
 * @param {string} selectedSource - 用户选择的音乐源
 * @returns {Array<string>} 平台列表，优先级从高到低
 */
export function preferredPlatforms(currentSource, selectedSource) {
  const preferred = currentSource === 'qq' || currentSource === 'netease'
    ? currentSource
    : selectedSource;
  return preferred === 'qq' ? ['qq', 'netease'] : ['netease', 'qq'];
}

/**
 * 格式化时间（秒 -> MM:SS）
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * 格式化轨道元信息（歌手、专辑、时长、VIP 等）
 * @param {Object} track - 轨道对象
 * @returns {string} 格式化后的元信息字符串
 */
export function formatTrackMeta(track) {
  const artists = Array.isArray(track.artists) && track.artists.length
    ? track.artists.join(' / ')
    : '未知歌手';
  const parts = [
    artists,
    track.album || '',
    formatTime((track.durationMs || 0) / 1000)
  ].filter(Boolean);
  if (track.vip) parts.push('VIP');
  if (track.playable === false) parts.push('可能不可播');
  return parts.join(' · ');
}

/**
 * 格式化歌单元信息（歌曲数、播放量、描述）
 * @param {Object} playlist - 歌单对象
 * @returns {string} 格式化后的元信息字符串
 */
export function formatPlaylistMeta(playlist) {
  const parts = [];
  if (playlist.trackCount) parts.push(`${playlist.trackCount} 首`);
  if (playlist.playCount) {
    const formatCompactNumber = window.AdminApp?.utils?.formatCompactNumber || ((n) => n);
    parts.push(`${formatCompactNumber(playlist.playCount)} 次播放`);
  }
  if (playlist.description) parts.push(playlist.description);
  return parts.join(' · ') || '歌单';
}

/**
 * 渲染专辑封面/歌单封面 HTML
 * @param {Object} item - 轨道或歌单对象
 * @param {Object} options - 选项
 * @param {string} options.fallback - 无封面时显示的文字，默认 '音'
 * @returns {string} 封面 HTML 字符串
 */
export function renderArtwork(item, options = {}) {
  const escapeAttr = window.AdminApp?.utils?.escapeAttr || ((s) => String(s || ''));
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));
  const coverUrl = String(item && item.coverUrl || '').trim();
  const fallback = options.fallback || '音';
  return `
    <div class="playback-artwork${coverUrl ? ' has-image' : ''}" aria-hidden="true">
      ${coverUrl ? `<img src="${escapeAttr(coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">` : ''}
      <span>${escapeHtml(fallback)}</span>
    </div>
  `;
}

/**
 * 标准化保存的待确认点歌请求
 * @param {Object} item - 待确认点歌项
 * @returns {Object|null} 标准化后的对象，无效则返回 null
 */
export function normalizeSavedPendingRequest(item) {
  if (!item || !item.track) return null;
  return {
    id: item.id || `pending:${Date.now()}:${Math.random()}`,
    songName: item.songName || '',
    artist: item.artist || '',
    requesterName: item.requesterName || '观众',
    score: Math.max(0, Number(item.score) || 0),
    reasons: Array.isArray(item.reasons) ? item.reasons : [],
    track: {
      ...item.track,
      objectUrl: ''
    }
  };
}

/**
 * 标准化保存的轨道数据（移除 objectUrl）
 * @param {Object} track - 轨道对象
 * @returns {Object} 标准化后的轨道对象
 */
export function normalizeSavedTrack(track) {
  return {
    ...track,
    objectUrl: ''
  };
}

/**
 * 根据轨道信息选择全屏播放器背景主题（1-30）
 * @param {Object} track - 轨道对象
 * @param {number} themeCount - 主题总数，默认 30
 * @returns {number} 主题编号 (1-themeCount)
 */
export function pickBackgroundTheme(track, themeCount = 30) {
  const seed = track
    ? String(track.id || `${track.title || ''}|${(track.artists || []).join(',')}`)
    : '';
  if (!seed) return 1;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return (hash % themeCount) + 1;
}

/**
 * 获取 Home Action 的显示标题
 * @param {string} action - Home action 类型
 * @returns {string} 显示标题
 */
export function getHomeActionTitle(action) {
  return {
    personalized: '为你推荐',
    daily: '每日推荐',
    radio: '心动 / 电台',
    liked: '我喜欢',
    'created-playlists': '我的歌单',
    'collected-playlists': '收藏歌单',
    recent: '最近播放',
    'playlist-tracks': '歌单详情'
  }[action] || '音乐内容';
}

/**
 * 获取播放模式的显示标签
 * @param {string} mode - 播放模式 (sequence/shuffle/repeat-one)
 * @returns {string} 显示标签
 */
export function getModeLabel(mode) {
  return {
    'sequence': '顺序',
    'shuffle': '随机',
    'repeat-one': '单曲'
  }[mode] || '顺序';
}

/**
 * 获取播放模式的提示文本
 * @param {string} mode - 播放模式
 * @returns {string} 提示文本
 */
export function getModeHint(mode) {
  return {
    'sequence': '顺序播放（点击切换到随机）',
    'shuffle': '随机播放（点击切换到单曲循环）',
    'repeat-one': '单曲循环（点击切换到顺序）'
  }[mode] || '播放模式';
}

/**
 * 获取下一个播放模式
 * @param {string} currentMode - 当前播放模式
 * @returns {string} 下一个播放模式
 */
export function getNextMode(currentMode) {
  const modes = ['sequence', 'shuffle', 'repeat-one'];
  const idx = modes.indexOf(currentMode);
  return modes[(idx + 1) % modes.length];
}

/**
 * 获取音乐源的显示名称
 * @param {string} source - 音乐源 (qq/netease)
 * @returns {string} 显示名称
 */
export function getSourceName(source) {
  return source === 'netease' ? '网易云音乐' : 'QQ音乐';
}
