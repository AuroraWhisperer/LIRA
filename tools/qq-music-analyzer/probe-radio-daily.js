// 探测「心动/电台」和「每日推荐」能不能换新歌
// 用法: node probe-radio-daily.js   /   QQ_COOKIE="..." node probe-radio-daily.js
const URL_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const COOKIE = process.env.QQ_COOKIE || '';
const uinMatch = COOKIE.match(/(?:^|;\s*)(?:uin|o_cookie)=o?(\d+)/);
const UIN = uinMatch ? uinMatch[1] : '0';

function randomGuid() {
  let s = '';
  for (let i = 0; i < 32; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  return s;
}

async function musicu(modules, guid) {
  const body = JSON.stringify({
    comm: {
      format: 'json', ct: 20, cv: 2241, platform: 'wk_v17',
      guid: guid || randomGuid(), uin: UIN,
      inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
    },
    ...modules
  });
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com',
    'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
  };
  if (COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(URL_MUSICU, { method: 'POST', headers, body });
  return JSON.parse(await res.text());
}

function pickTracks(data) {
  const d = (data && data.songlist && data.songlist.data) || {};
  const list = Array.isArray(d.tracks) ? d.tracks
    : (Array.isArray(d.track_list) ? d.track_list
      : (Array.isArray(d.songlist) ? d.songlist : []));
  return list.map((s) => ({ id: String(s.id || s.songid || ''), name: s.name || s.songname || '' }))
    .filter((s) => s.id);
}

async function radio({ id = 99, firstplay = 1, num = 20, guid }) {
  const j = await musicu({
    songlist: {
      module: 'mb_track_radio_svr', method: 'get_radio_track',
      param: { id, firstplay, num }
    }
  }, guid);
  return { code: j.songlist && j.songlist.code, tracks: pickTracks(j) };
}

function overlap(a, b) {
  const setB = new Set(b.map((t) => t.id));
  return a.filter((t) => setB.has(t.id)).length;
}

(async () => {
  console.log(COOKIE ? `带 Cookie (uin=${UIN})` : '匿名（未设置 QQ_COOKIE）');

  // 1. 现状复现：id=101, firstplay=1，固定 guid 连抓 3 次
  console.log('\n=== 1. 现状 id=101 firstplay=1（固定 guid）===');
  const guid1 = randomGuid();
  let prev = null;
  for (let i = 1; i <= 3; i++) {
    const r = await radio({ id: 101, firstplay: 1, guid: guid1 });
    const dup = prev ? overlap(r.tracks, prev) : 0;
    console.log(`第${i}次 code=${r.code} 歌曲=${r.tracks.length} 与上次重复=${dup}`);
    if (i === 1) console.log('   示例:', r.tracks.slice(0, 3).map((t) => t.name).join(' | '));
    prev = r.tracks;
  }

  // 2. firstplay=0 是否给新歌
  console.log('\n=== 2. firstplay=1 打头，之后 firstplay=0（固定 guid）===');
  const guid2 = randomGuid();
  const first = await radio({ id: 101, firstplay: 1, guid: guid2 });
  console.log(`firstplay=1 歌曲=${first.tracks.length}`);
  prev = first.tracks;
  const seen2 = new Set(prev.map((t) => t.id));
  for (let i = 1; i <= 3; i++) {
    const r = await radio({ id: 101, firstplay: 0, guid: guid2 });
    const dup = overlap(r.tracks, prev);
    const fresh = r.tracks.filter((t) => !seen2.has(t.id)).length;
    r.tracks.forEach((t) => seen2.add(t.id));
    console.log(`firstplay=0 第${i}次 code=${r.code} 歌曲=${r.tracks.length} 与上次重复=${dup} 全程新增=${fresh}`);
    prev = r.tracks;
  }
  console.log(`累计不重复: ${seen2.size}`);

  // 3. 每次换新 guid
  console.log('\n=== 3. 每次新 guid, firstplay=1 ===');
  const seen3 = new Set();
  for (let i = 1; i <= 3; i++) {
    const r = await radio({ id: 101, firstplay: 1, guid: randomGuid() });
    const fresh = r.tracks.filter((t) => !seen3.has(t.id)).length;
    r.tracks.forEach((t) => seen3.add(t.id));
    console.log(`第${i}次 code=${r.code} 歌曲=${r.tracks.length} 新增=${fresh}`);
  }
  console.log(`累计不重复: ${seen3.size}`);

  // 4. 换电台 id，看哪些 id 有效
  console.log('\n=== 4. 扫电台 id（哪些能出歌 + 是否互不相同）===');
  const ids = [99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
  const idResults = [];
  for (const id of ids) {
    try {
      const r = await radio({ id, firstplay: 1, num: 15 });
      if (r.tracks.length > 0) {
        idResults.push({ id, tracks: r.tracks });
        console.log(`id=${id} ✓ 歌曲=${r.tracks.length} 示例=${r.tracks.slice(0, 2).map((t) => t.name).join(' | ')}`);
      } else {
        console.log(`id=${id} ✗ code=${r.code} 无歌曲`);
      }
    } catch (e) {
      console.log(`id=${id} ✗ 错误 ${e.message}`);
    }
  }
  if (idResults.length > 1) {
    const a = idResults[0];
    const b = idResults[1];
    console.log(`   id=${a.id} vs id=${b.id} 重复=${overlap(a.tracks, b.tracks)}/${a.tracks.length}`);
  }
  console.log(`有效电台 id: ${idResults.map((r) => r.id).join(', ')}`);

  // 5. 每日推荐 —— 客户端接口（不是抓 HTML）
  console.log('\n=== 5. 每日推荐 client API (music.recommend.DailyRecommend) ===');
  for (const [mod, method] of [
    ['music.recommend.DailyRecommend', 'get_daily_track'],
    ['music.recommend.DailyRecommendSvr', 'get_daily_track'],
    ['music.recommend.RecommendSongSvr', 'get_daily_song'],
    ['musicToplist.ToplistInfoServer', 'GetDetail']
  ]) {
    try {
      const j = await musicu({ req_1: { module: mod, method, param: {} } });
      const c = j.req_1 && j.req_1.code;
      const keys = j.req_1 && j.req_1.data ? Object.keys(j.req_1.data).slice(0, 8) : [];
      console.log(`${mod}.${method} code=${c} data keys=[${keys.join(',')}]`);
    } catch (e) {
      console.log(`${mod}.${method} 错误 ${e.message}`);
    }
  }
})();
