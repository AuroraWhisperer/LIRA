const check = label => ({ label, type: 'checkbox', default: true });
const number = (label, value, min, max) => ({ label, type: 'number', default: value, min, max, step: 1 });
const select = (label, value, options) => ({ label, type: 'select', default: value, options });

export const LIVE_RANKING_COMPONENT = Object.freeze({
  title: '实时榜单', size: [1080, 940], path: '/live-rankings',
  variants: [{ value: 'default', label: '实时四榜', sample: '热门 · 新人 · 人气 · 分区' }],
  fields: {
    showHot: check('热门全站'), showNew: check('热门新人'), showPopular: check('人气全站'), showArea: check('人气分区'),
    range: select('展示范围', 'nearby', { nearby: '本房间及附近名次', all: '完整榜单（自动翻页）' }),
    nearby: number('上下各几名', 2, 0, 10), pageSize: number('完整榜每页行数', 5, 3, 20),
    pageSeconds: number('翻页间隔（秒）', 8, 3, 30),
    columns: select('每行榜单数', '2', { 1: '一栏', 2: '两栏', 4: '四栏' }),
    theme: select('榜单配色', 'light', { light: '浅色', dark: '深色', transparent: '透明底' }),
    fontSize: number('正文字号', 18, 12, 32), showAvatar: check('显示头像'),
    accent: { label: '本房间强调色', type: 'color', default: '#f25483' },
  },
});

export const RANKING_FLAGS = Object.freeze({ hot: 'showHot', 'hot-new': 'showNew', popular: 'showPopular', 'popular-area': 'showArea' });
export const rankingDefaults = () => Object.fromEntries(Object.entries(LIVE_RANKING_COMPONENT.fields).map(([key, field]) => [key, field.default]));

export function selectRankingRows(board, { range = 'all', nearby = 2, pageSize = 5 } = {}, page = 0) {
  const rows = board.rows || [];
  if (range === 'nearby') {
    const rank = board.current?.rank;
    if (!rank || board.eligible === false) return [];
    return rows.filter(row => Math.abs(row.rank - rank) <= nearby);
  }
  if (page === null) return rows;
  const offset = (page % Math.max(1, Math.ceil(rows.length / pageSize))) * pageSize;
  return rows.slice(offset, offset + pageSize);
}

export function rankingCountdown(board, now) {
  if (!Number.isFinite(board.endsAt)) return '等待结榜时间';
  const seconds = Math.ceil(Math.max(0, board.endsAt - now) / 1000);
  if (!seconds) return '等待新一轮榜单';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function rankingCurrentNote(board) {
  if (board.eligible === false) return '本房间暂不符合此榜参与条件';
  if (!board.current) return board.message || '等待本房间排名';
  const { rank, distance } = board.current;
  if (rank === 1) return '当前位列榜首';
  if (distance === null || distance === undefined) return rank ? '' : `暂未进入前 ${board.limit} 名`;
  return `${rank ? '距上一名' : '距上榜'} ${distance.toLocaleString('zh-CN')} ${board.unit}`;
}
