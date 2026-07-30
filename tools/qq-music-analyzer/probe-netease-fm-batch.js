// 私人FM 能不能一次拿多首？心动模式接口可用吗？
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

const COOKIE = process.env.NETEASE_COOKIE || '';
const provider = new NeteaseMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

function count(data) {
  if (!data) return -1;
  if (Array.isArray(data.data)) return data.data.length;
  if (data.data && Array.isArray(data.data.list)) return data.data.list.length;
  return -1;
}

(async () => {
  console.log(COOKIE ? '带 Cookie（已登录）' : '匿名');

  console.log('\n=== 私人FM 各种参数下返回几首 ===');
  const paramSets = [
    {},
    { limit: '10' },
    { batch: '10' },
    { count: '10' },
    { size: '10' },
    { mode: 'DEFAULT' },
    { mode: 'EXPLORE' },
    { mode: 'SCENE_RCMD' }
  ];
  for (const params of paramSets) {
    const data = await provider.requestJson('/api/v1/radio/get', params).catch((e) => ({ err: e.message }));
    if (data && data.err) { console.log(`  ${JSON.stringify(params)} -> 失败 ${data.err}`); continue; }
    console.log(`  ${JSON.stringify(params)} -> code=${data.code} 返回 ${count(data)} 首`);
  }

  console.log('\n=== 心动模式 playmode/intelligence/list（需要 songId + playlistId）===');
  const daily = await provider.requestJson('/api/v3/discovery/recommend/songs').catch(() => null);
  const first = daily && daily.data && Array.isArray(daily.data.dailySongs) ? daily.data.dailySongs[0] : null;
  if (!first) {
    console.log('  拿不到种子歌曲，跳过');
  } else {
    for (const path of ['/api/playmode/intelligence/list', '/api/v1/playmode/intelligence/list']) {
      const data = await provider.requestJson(path, {
        songId: String(first.id),
        type: 'fromPlayOne',
        playlistId: '3778678',
        startMusicId: String(first.id),
        count: '30'
      }).catch((e) => ({ err: e.message }));
      if (data && data.err) { console.log(`  ${path} -> 失败 ${data.err}`); continue; }
      console.log(`  ${path} -> code=${data.code} 返回 ${count(data)} 首  顶层=${Object.keys(data).join(',')}`);
    }
  }

  console.log('\n=== 私人FM 累计能刷出多少首（20 次）===');
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const data = await provider.requestJson('/api/v1/radio/get').catch(() => null);
    const list = data && Array.isArray(data.data) ? data.data : [];
    for (const song of list) if (song && song.id) seen.add(String(song.id));
  }
  console.log(`  20 次调用累计去重 ${seen.size} 首`);
})();
