// 探测网易云「每日推荐」和「心动/电台」能不能换新歌
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

const COOKIE = process.env.NETEASE_COOKIE || '';
const provider = new NeteaseMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

function ids(tracks) { return new Set(tracks.map((t) => t.sourceTrackId)); }
function overlap(a, b) { const s = ids(b); return a.filter((t) => s.has(t.sourceTrackId)).length; }

(async () => {
  console.log(COOKIE ? '带 Cookie' : '匿名（未设置 NETEASE_COOKIE）');

  console.log('\n=== A. newsong 接口大 limit 能拿多少首（决定能不能翻页）===');
  for (const limit of [20, 50, 100]) {
    try {
      const data = await provider.requestJson('/api/personalized/newsong', { limit: String(limit) });
      const n = data && Array.isArray(data.result) ? data.result.length : -1;
      console.log(`limit=${limit} -> 返回 ${n} 首`);
    } catch (e) {
      console.log(`limit=${limit} -> 失败 ${e.message}`);
    }
  }

  console.log('\n=== B. 连续调 getRadioTracks 是否重复 ===');
  const r1 = await provider.getRadioTracks({ limit: 30, page: 1 }).catch((e) => { console.log('失败', e.message); return []; });
  const r2 = await provider.getRadioTracks({ limit: 30, page: 2 }).catch(() => []);
  const r3 = await provider.getRadioTracks({ limit: 30, page: 3 }).catch(() => []);
  console.log(`page1=${r1.length} page2=${r2.length} page3=${r3.length}`);
  console.log(`page1 vs page2 重复=${overlap(r1, r2)}  page1 vs page3 重复=${overlap(r1, r3)}`);
  if (r1[0]) console.log('page1 示例:', r1.slice(0, 3).map((t) => t.title).join(' | '));
  if (r2[0]) console.log('page2 示例:', r2.slice(0, 3).map((t) => t.title).join(' | '));

  console.log('\n=== C. 每日推荐（需要登录）===');
  try {
    const d1 = await provider.getDailyTracks({ limit: 30, page: 1 });
    const d2 = await provider.getDailyTracks({ limit: 30, page: 2 });
    console.log(`page1=${d1.length} page2=${d2.length} 重复=${overlap(d1, d2)}`);
  } catch (e) {
    console.log('每日推荐失败（预期：未登录）:', e.message);
  }
})();
