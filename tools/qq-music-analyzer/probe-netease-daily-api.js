// 探测网易云哪些推荐接口「每次调用真的会变」
// 用法: node probe-netease-daily-api.js        （匿名）
//       NETEASE_COOKIE="MUSIC_U=..." node probe-netease-daily-api.js  （带登录）
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

const COOKIE = process.env.NETEASE_COOKIE || '';
const provider = new NeteaseMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

// 从各种响应结构里尽量抠出歌曲 id 列表
function pickIds(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.recommend,
    data.data && data.data.dailySongs,
    data.data,
    data.result
  ];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    const ids = list
      .map((item) => {
        const song = item && (item.song || item);
        return song && song.id ? String(song.id) : '';
      })
      .filter(Boolean);
    if (ids.length) return ids;
  }
  return null;
}

function overlapCount(a, b) {
  const set = new Set(b);
  return a.filter((id) => set.has(id)).length;
}

const TARGETS = [
  { label: '每日推荐 v1', path: '/api/v1/discovery/recommend/songs', params: {} },
  { label: '每日推荐 v3', path: '/api/v3/discovery/recommend/songs', params: {} },
  { label: '推荐新音乐 newsong', path: '/api/personalized/newsong', params: { limit: '100' } },
  { label: '推荐歌单 personalized', path: '/api/personalized/playlist', params: { limit: '12' } },
  { label: '私人FM radio/get', path: '/api/v1/radio/get', params: {} },
  { label: '私人FM radio/get(带mode)', path: '/api/v1/radio/get', params: { mode: 'DEFAULT' } }
];

(async () => {
  console.log(COOKIE ? '带 Cookie（已登录）' : '匿名（未设置 NETEASE_COOKIE）');

  for (const target of TARGETS) {
    console.log(`\n=== ${target.label}  ${target.path} ===`);
    const rounds = [];
    let failed = false;
    for (let i = 0; i < 3; i++) {
      try {
        const data = await provider.requestJson(target.path, target.params);
        const ids = pickIds(data);
        if (!ids) {
          console.log(`  第${i + 1}次: code=${data && data.code} 未取到歌曲列表，顶层字段: ${Object.keys(data || {}).join(',')}`);
          failed = true;
          break;
        }
        rounds.push(ids);
        console.log(`  第${i + 1}次: ${ids.length} 首`);
      } catch (error) {
        console.log(`  第${i + 1}次: 失败 ${error.message}`);
        failed = true;
        break;
      }
    }
    if (failed || rounds.length < 2) continue;
    console.log(`  1 vs 2 重复 ${overlapCount(rounds[0], rounds[1])}/${rounds[0].length}`);
    console.log(`  1 vs 3 重复 ${overlapCount(rounds[0], rounds[2] || [])}/${rounds[0].length}`);
  }
})();
