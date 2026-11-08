'use strict';

const API_ROOT = 'https://api.live.bilibili.com/xlive/general-interface/v1/rank/';
const RANK_BOARDS = Object.freeze([
  { id: 'hot', title: '热门 · 全站', limit: 50, unit: '热度值', subRankType: 1 },
  { id: 'hot-new', title: '热门 · 新人', limit: 50, unit: '热度值', subRankType: 2 },
  { id: 'popular', title: '人气 · 全站', limit: 100, unit: '助力值' },
  { id: 'popular-area', title: '人气 · 分区', limit: 100, unit: '助力值' },
]);

const count = value => value !== null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const text = value => typeof value === 'string' ? value.slice(0, 160) : '';
function avatar(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.hdslb.com') && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function rankEntry(source) {
  if (!source || typeof source !== 'object') return null;
  const base = source.uinfo?.base;
  return {
    roomId: String(count(source.room_id) || ''), uid: String(count(source.uinfo?.uid ?? source.uid) || ''),
    name: text(base?.name ?? source.uname), avatarUrl: avatar(base?.face ?? source.face),
    rank: count(source.rank) || null, score: count(source.score),
    supporters: count(source.user_num), areaName: text(source.area_name),
    distance: count(source.rank_distance_score),
  };
}

function createLiveRankProvider({ fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  async function request(endpoint, params, signal) {
    const url = new URL(endpoint, API_ROOT);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      headers: { Referer: 'https://live.bilibili.com/', 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Object.assign(new Error(response.status === 429 ? 'B 站请求受限，正在降频重试' : 'B 站榜单暂时不可用'), {
        retryAfterMs: Number.isFinite(retryAfter) ? Math.min(60000, Math.max(0, retryAfter * 1000)) : 0,
      });
    }
    const body = await response.json();
    if (body.code !== 0 || !body.data) throw new Error('B 站榜单暂时不可用');
    return body.data;
  }

  async function getContext(profile, signal) {
    if (!/^\d+$/.test(String(profile?.roomId)) || !/^\d+$/.test(String(profile?.uid))) throw new Error('请先配置有效的直播间');
    const data = await request('getRankTabConfigWithList', {
      ruid: profile.uid, room_id: profile.roomId, source: 1, rank_type: 1, rank_category: 1, list_size: 1,
    }, signal);
    const tab = data.popular_rank_tab_list?.find(item => item.type === 1);
    const area = tab?.sub_tab_list?.find(item => item.type === 2 || item.type === 3);
    return { room: { roomId: String(profile.roomId), uid: String(profile.uid), name: text(profile.name), avatarUrl: avatar(profile.avatarUrl) },
      area: area ? { title: text(area.title), type: area.type, rankId: count(area.rank_id) || 0,
        parentAreaId: count(area.parent_area_id) || 0, areaId: count(area.area_id) || 0 } : null };
  }

  async function getBoard(definition, context, signal) {
    const { room, area } = context;
    const title = definition.id === 'popular-area' && area ? `人气 · ${area.title}` : definition.title;
    const meta = { id: definition.id, title, unit: definition.unit, limit: definition.limit };
    if (definition.id === 'popular-area' && !area) return { ...meta, rows: [], current: null,
      status: 'unavailable', message: '该房间暂无对应分区榜', updatedAt: now(), endsAt: null };
    const startedAt = now();
    const data = definition.subRankType
      ? await request('getHotRankV3', { ruid: room.uid, room_id: room.roomId, platform: 'pc', sub_rank_type: definition.subRankType }, signal)
      : await request('getPopularAnchorRank', { uid: 0, ruid: room.uid, clientType: 'pc',
        rank_type: definition.id === 'popular-area' ? area.type : 1,
        rank_id: definition.id === 'popular-area' ? area.rankId : 0,
        parent_area_id: definition.id === 'popular-area' ? area.parentAreaId : 0,
        area_id: definition.id === 'popular-area' ? area.areaId : 0, location_code: '' }, signal);
    const list = definition.subRankType ? data.list : data.list_new ?? data.list;
    if (!Array.isArray(list)) throw new Error('B 站榜单数据格式发生变化');
    const current = rankEntry(definition.subRankType ? data.current_room : data.anchor_info ?? data.anchor);
    const updatedAt = now();
    const countdown = count(definition.subRankType ? data.countdown : data.data?.countdown);
    const eligible = definition.subRankType ? data.anchor_permission !== false : !data.anchor_info?.blocked && !data.anchor?.in_black;
    return { ...meta, rows: list.slice(0, definition.limit).map(rankEntry).filter(row => row?.roomId && row.rank),
      current: current ? { ...current, roomId: current.roomId || room.roomId, name: current.name || room.name } : null,
      eligible, status: 'ready', message: '', updatedAt, requestMs: updatedAt - startedAt,
      endsAt: countdown === null ? null : Math.round((startedAt + updatedAt) / 2) + countdown * 1000 };
  }

  return { getContext, getBoard };
}

module.exports = { RANK_BOARDS, createLiveRankProvider };
