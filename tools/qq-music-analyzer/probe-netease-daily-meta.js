// 看 网易云每日推荐 的元信息：是不是「当天固定」，有没有刷新/过期机制
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

const COOKIE = process.env.NETEASE_COOKIE || '';
const provider = new NeteaseMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

(async () => {
  console.log(COOKIE ? '带 Cookie（已登录）' : '匿名');

  const data = await provider.requestJson('/api/v3/discovery/recommend/songs');
  const payload = data && data.data ? data.data : {};

  console.log('\nfromCache:', payload.fromCache);
  console.log('demote:', payload.demote, ' algReturnDemote:', payload.algReturnDemote);
  console.log('dailyRecommendInfo:', JSON.stringify(payload.dailyRecommendInfo, null, 2));
  console.log('orderSongs 长度:', Array.isArray(payload.orderSongs) ? payload.orderSongs.length : 'n/a');
  console.log('recommendReasons 长度:', Array.isArray(payload.recommendReasons) ? payload.recommendReasons.length : 'n/a');
  if (Array.isArray(payload.recommendReasons) && payload.recommendReasons[0]) {
    console.log('reason 样例:', JSON.stringify(payload.recommendReasons[0]));
  }

  console.log('\n=== 前 5 首 ===');
  for (const song of (payload.dailySongs || []).slice(0, 5)) {
    console.log(`  ${song.id}  ${song.name}  ${(song.ar || song.artists || []).map((a) => a.name).join('/')}`);
  }

  // 官方每日推荐是按「天」算的，看看服务端认为的日期边界
  console.log('\n=== 本地时间 ===', new Date().toString());
})();
