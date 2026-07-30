// 验证"换一批"到底靠什么：page 递增 vs v_uniq 去重 vs 每次新 guid
// 用法: node probe-refresh.js   /   QQ_COOKIE="..." node probe-refresh.js
const URL_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const COOKIE = process.env.QQ_COOKIE || '';
const uinMatch = COOKIE.match(/(?:^|;\s*)(?:uin|o_cookie)=o?(\d+)/);
const UIN = uinMatch ? uinMatch[1] : '0';

function randomGuid() {
  let s = '';
  for (let i = 0; i < 32; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  return s;
}

function comm(guid) {
  return {
    format: 'json', ct: 20, cv: 2241, platform: 'wk_v17', guid,
    inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1, uin: UIN
  };
}

async function fetchFeed({ page = 1, guid, vUniq = [], vCache = [], sNum = 4 }) {
  const body = JSON.stringify({
    comm: comm(guid),
    req_1: {
      module: 'music.recommend.RecommendFeed',
      method: 'get_recommend_feed',
      param: { direction: 1, page, v_cache: vCache, v_uniq: vUniq, s_num: sNum }
    }
  });
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com',
    'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
  };
  if (COOKIE) headers.Cookie = COOKIE;

  const res = await fetch(URL_MUSICU, { method: 'POST', headers, body });
  const j = JSON.parse(await res.text());
  const data = (j.req_1 && j.req_1.data) || {};
  const playlists = [];
  (data.v_shelf || []).forEach(s => (s.v_niche || []).forEach(ni =>
    (ni.v_card || []).forEach(c => {
      if (c.type === 500) playlists.push({ id: String(c.id), title: c.title, cnt: c.cnt, cover: c.cover });
    })));
  return { code: j.req_1 && j.req_1.code, shelves: data.v_shelf || [], playlists };
}

function pct(a, b) { return b === 0 ? '0%' : Math.round((a / b) * 100) + '%'; }

(async () => {
  console.log(COOKIE ? `带 Cookie (uin=${UIN})` : '匿名');

  // A: 固定 guid，page 递增
  console.log('\n=== A. 固定 guid，page 1→5 ===');
  const guidA = randomGuid();
  const seenA = new Set();
  for (let page = 1; page <= 5; page++) {
    const r = await fetchFeed({ page, guid: guidA });
    const fresh = r.playlists.filter(p => !seenA.has(p.id));
    r.playlists.forEach(p => seenA.add(p.id));
    console.log(`page=${page} code=${r.code} shelf=${r.shelves.length} 歌单=${r.playlists.length} 新增=${fresh.length}`);
    if (page === 1) console.log('   示例:', r.playlists.slice(0, 3).map(p => p.title).join(' | '));
  }
  console.log(`A 累计不重复: ${seenA.size}`);

  // B: 固定 guid + page=1，把已见 id 塞进 v_uniq
  console.log('\n=== B. page 固定=1，v_uniq 累积去重 ===');
  const guidB = randomGuid();
  const seenB = new Set();
  let vUniq = [];
  for (let round = 1; round <= 5; round++) {
    const r = await fetchFeed({ page: 1, guid: guidB, vUniq });
    const fresh = r.playlists.filter(p => !seenB.has(p.id));
    r.playlists.forEach(p => seenB.add(p.id));
    vUniq = Array.from(seenB);
    console.log(`round=${round} code=${r.code} 歌单=${r.playlists.length} 新增=${fresh.length} v_uniq送出=${vUniq.length - fresh.length}`);
  }
  console.log(`B 累计不重复: ${seenB.size}`);

  // C: 每轮换新 guid，page=1
  console.log('\n=== C. 每轮新 guid，page=1 ===');
  const seenC = new Set();
  for (let round = 1; round <= 5; round++) {
    const r = await fetchFeed({ page: 1, guid: randomGuid() });
    const fresh = r.playlists.filter(p => !seenC.has(p.id));
    r.playlists.forEach(p => seenC.add(p.id));
    console.log(`round=${round} code=${r.code} 歌单=${r.playlists.length} 新增=${fresh.length}`);
  }
  console.log(`C 累计不重复: ${seenC.size}`);

  console.log('\n=== 汇总（5 轮各自累计到的不重复歌单数）===');
  console.log(`A page递增   : ${seenA.size}`);
  console.log(`B v_uniq去重 : ${seenB.size}`);
  console.log(`C 换 guid    : ${seenC.size}`);
})();
