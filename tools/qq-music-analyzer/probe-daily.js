// 探测「每日推荐」：HTML 抓到的歌单 id 有几个、内容是否不同、以及能否累积电台歌曲
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

const COOKIE = process.env.QQ_COOKIE || '';
const provider = new QQMusicProvider({
  getAuthState: () => (COOKIE ? { cookie: COOKIE, loggedIn: true } : null),
  getCookieHeader: () => COOKIE
});

const QQ_DAILY_PAGE_URL = 'https://c.y.qq.com/node/musicmac/v6/index.html';

(async () => {
  console.log(COOKIE ? '带 Cookie' : '匿名（未设置 QQ_COOKIE）');

  console.log('\n=== A. 每日页面能抓到哪些歌单 id ===');
  let ids = [];
  try {
    const html = await provider.requestText(QQ_DAILY_PAGE_URL);
    console.log(`HTML 长度=${html.length}`);
    const set = [];
    for (const m of html.matchAll(/data-rid=["']?(\d+)/g)) {
      if (!set.includes(m[1])) set.push(m[1]);
      if (set.length >= 20) break;
    }
    ids = set;
    console.log(`抓到 ${ids.length} 个歌单 id: ${ids.join(', ')}`);
  } catch (e) {
    console.log('抓页面失败:', e.message);
  }

  console.log('\n=== B. 前几个歌单里的歌是否不同 ===');
  const perPlaylist = [];
  for (const id of ids.slice(0, 5)) {
    try {
      const tracks = await provider.getPlaylistTracks(id, { limit: 30 });
      perPlaylist.push({ id, tracks });
      console.log(`歌单 ${id}: ${tracks.length} 首  示例=${tracks.slice(0, 2).map((t) => t.title).join(' | ')}`);
    } catch (e) {
      console.log(`歌单 ${id}: 失败 ${e.message}`);
    }
  }
  if (perPlaylist.length >= 2) {
    const a = new Set(perPlaylist[0].tracks.map((t) => t.sourceTrackId));
    const dup = perPlaylist[1].tracks.filter((t) => a.has(t.sourceTrackId)).length;
    console.log(`歌单${perPlaylist[0].id} vs 歌单${perPlaylist[1].id} 重复=${dup}/${perPlaylist[1].tracks.length}`);
  }

  console.log('\n=== C. 电台连抓 6 次能累积多少不重复歌曲 ===');
  const seen = new Map();
  for (let i = 1; i <= 6; i++) {
    const tracks = await provider.getRadioTracks({ limit: 30 }).catch((e) => {
      console.log(`第${i}次失败 ${e.message}`);
      return [];
    });
    let fresh = 0;
    tracks.forEach((t) => {
      if (!seen.has(t.sourceTrackId)) { seen.set(t.sourceTrackId, t); fresh++; }
    });
    console.log(`第${i}次 拿到=${tracks.length} 新增=${fresh} 累计=${seen.size}`);
  }
})();
