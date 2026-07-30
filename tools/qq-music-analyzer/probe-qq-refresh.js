// 验证改动后 QQ 的 getRadioTracks / getDailyTracks 每次是否给新歌
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

const COOKIE = process.env.QQ_COOKIE || '';
const provider = new QQMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

function overlap(a, b) {
  const s = new Set(b.map((t) => t.sourceTrackId));
  return a.filter((t) => s.has(t.sourceTrackId)).length;
}

(async () => {
  console.log(COOKIE ? '带 Cookie' : '匿名（未设置 QQ_COOKIE）');

  console.log('\n=== 电台 getRadioTracks(limit=30) 连开 3 页 ===');
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    const tracks = await provider.getRadioTracks({ limit: 30, page }).catch((e) => {
      console.log(`page=${page} 失败 ${e.message}`);
      return [];
    });
    pages.push(tracks);
    console.log(`page=${page} 拿到 ${tracks.length} 首  示例=${tracks.slice(0, 3).map((t) => t.title).join(' | ')}`);
  }
  if (pages.length === 3) {
    console.log(`page1 vs page2 重复=${overlap(pages[0], pages[1])}/${pages[1].length}`);
    console.log(`page1 vs page3 重复=${overlap(pages[0], pages[2])}/${pages[2].length}`);
    const all = new Set(pages.flat().map((t) => t.sourceTrackId));
    console.log(`3 页累计不重复 ${all.size} 首`);
  }

  console.log('\n=== 每日推荐 getDailyTracks 连开 3 页 ===');
  try {
    const d = [];
    for (let page = 1; page <= 3; page++) {
      const tracks = await provider.getDailyTracks({ limit: 30, page });
      d.push(tracks);
      console.log(`page=${page} 拿到 ${tracks.length} 首  示例=${tracks.slice(0, 3).map((t) => t.title).join(' | ')}`);
    }
    if (d.length === 3) {
      console.log(`page1 vs page2 重复=${overlap(d[0], d[1])}/${d[1].length}`);
      console.log(`page1 vs page3 重复=${overlap(d[0], d[2])}/${d[2].length}`);
    }
  } catch (e) {
    console.log('每日推荐失败（预期：未登录）:', e.message);
  }
})();
