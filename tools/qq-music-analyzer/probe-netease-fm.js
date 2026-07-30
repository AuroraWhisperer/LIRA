// 看清楚 网易云 私人FM / 每日推荐 的响应结构和可分页性
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

const COOKIE = process.env.NETEASE_COOKIE || '';
const provider = new NeteaseMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

function shape(value, depth = 0) {
  if (Array.isArray(value)) {
    return `Array(${value.length})` + (value.length && depth < 2 ? ` of ${shape(value[0], depth + 1)}` : '');
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).slice(0, 14);
    return `{${keys.join(',')}}`;
  }
  return typeof value;
}

(async () => {
  console.log(COOKIE ? '带 Cookie（已登录）' : '匿名');

  console.log('\n=== 私人FM 响应结构 ===');
  const fm = await provider.requestJson('/api/v1/radio/get');
  console.log('顶层:', shape(fm));
  if (Array.isArray(fm.data)) {
    console.log('data 长度:', fm.data.length);
    console.log('单曲字段:', shape(fm.data[0]));
    for (const song of fm.data) {
      console.log(`  ${song.id}  ${song.name}  fee=${song.fee}  ar=${(song.artists || song.ar || []).map((a) => a.name).join('/')}`);
    }
  }

  console.log('\n=== 私人FM 连续拉 8 次，累计去重后有多少首 ===');
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    const data = await provider.requestJson('/api/v1/radio/get').catch(() => null);
    const list = data && Array.isArray(data.data) ? data.data : [];
    for (const song of list) if (song && song.id) seen.add(String(song.id));
    console.log(`  第${i + 1}次 拿到 ${list.length} 首，累计去重 ${seen.size}`);
  }

  console.log('\n=== 每日推荐 v3 结构 & 是否有分页/时间字段 ===');
  const v3 = await provider.requestJson('/api/v3/discovery/recommend/songs');
  console.log('顶层:', shape(v3));
  if (v3.data) {
    console.log('data:', shape(v3.data));
    if (Array.isArray(v3.data.dailySongs)) {
      console.log('dailySongs 长度:', v3.data.dailySongs.length);
    }
  }

  console.log('\n=== 每日推荐 v3 传 offset/limit 有没有用 ===');
  for (const params of [{}, { limit: '100' }, { offset: '30', limit: '30' }, { page: '2' }]) {
    const data = await provider.requestJson('/api/v3/discovery/recommend/songs', params).catch(() => null);
    const list = data && data.data && Array.isArray(data.data.dailySongs) ? data.data.dailySongs : [];
    const first = list[0] ? String(list[0].id) : '-';
    console.log(`  params=${JSON.stringify(params)} -> ${list.length} 首，首曲 ${first}`);
  }
})();
