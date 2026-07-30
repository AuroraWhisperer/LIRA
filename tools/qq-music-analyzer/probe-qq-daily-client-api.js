// 验证新的客户端 API 流程：get_recommend_feed 抽 type 200 → CgiGetTrackInfo 解析歌曲
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

  console.log('\n=== 新 getDailyTracks (客户端 API) 连翻 3 页 ===');
  const pages = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const tracks = await provider.getDailyTracks({ limit: 30, page });
      pages.push(tracks);
      console.log(`page=${page} 拿到 ${tracks.length} 首  示例=${tracks.slice(0, 3).map((t) => t.title).join(' | ')}`);
    } catch (e) {
      console.log(`page=${page} 失败: ${e.message}`);
      break;
    }
  }
  if (pages.length === 3 && pages[0].length > 0 && pages[1].length > 0) {
    console.log(`page1 vs page2 重复=${overlap(pages[0], pages[1])}/${pages[1].length}`);
    console.log(`page1 vs page3 重复=${overlap(pages[0], pages[2])}/${pages[2].length}`);
    const all = new Set(pages.flat().map((t) => t.sourceTrackId));
    console.log(`3 页累计不重复 ${all.size} 首`);
  }
})();
