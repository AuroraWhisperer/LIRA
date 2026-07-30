// 测试 get_recommend_feed 在不同端点/签名下是否可用
// 用法: node probe-recommend.js                          （匿名）
//      QQ_COOKIE="..." node probe-recommend.js           （带自己的 Cookie，走个性化推荐）

const COOKIE = process.env.QQ_COOKIE || '';
const uinMatch = COOKIE.match(/(?:^|;\s*)(?:uin|o_cookie)=o?(\d+)/);
const UIN = uinMatch ? uinMatch[1] : '0';

function randomGuid() {
  let s = '';
  for (let i = 0; i < 32; i++) s += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  return s;
}
const GUID = randomGuid();

const COMM_WEB = {
  format: 'json', ct: 24, cv: 0, uin: UIN, guid: GUID,
  inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1
};
const COMM_CLIENT = {
  format: 'json', ct: 20, cv: 2241, platform: 'wk_v17', guid: GUID,
  inCharset: 'utf-8', outCharset: 'utf-8', notice: 0, needNewCode: 1, uin: UIN
};

function payload(comm, page) {
  return {
    comm,
    req_1: {
      module: 'music.recommend.RecommendFeed',
      method: 'get_recommend_feed',
      param: { direction: 1, page, v_cache: [], v_uniq: [], s_num: 4 }
    }
  };
}

function headers() {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent': 'Mozilla/5.0 SongAssistant/1.0'
  };
  if (COOKIE) h.Cookie = COOKIE;
  return h;
}

function collectPlaylistIds(shelves) {
  const ids = [];
  (shelves || []).forEach(s => (s.v_niche || []).forEach(ni =>
    (ni.v_card || []).forEach(c => { if (c.type === 500) ids.push(String(c.id)); })));
  return ids;
}

async function call(label, url, method, comm, page) {
  const body = JSON.stringify(payload(comm, page));
  let target = url;
  const init = { method, headers: headers() };
  if (method === 'GET') {
    target = url + (url.includes('?') ? '&' : '?') + 'data=' + encodeURIComponent(body);
  } else {
    init.body = body;
  }
  try {
    const res = await fetch(target, init);
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    const r1 = j && j.req_1;
    const data = r1 && r1.data;
    const shelves = (data && data.v_shelf) || [];
    const titles = shelves.map(s => s.title_template).filter(Boolean);
    const playlistIds = collectPlaylistIds(shelves);
    console.log(`${label} page=${page}`);
    console.log(`   HTTP ${res.status} | top.code=${j && j.code} | req_1.code=${r1 && r1.code} | retcode=${data && data.retcode}`);
    console.log(`   shelf=${shelves.length} 歌单卡=${playlistIds.length}${titles.length ? ' 标题=' + JSON.stringify(titles) : ''}`);
    if (!j) console.log('   非 JSON:', text.substring(0, 150));
    return { ok: shelves.length > 0, shelves, playlistIds };
  } catch (e) {
    console.log(`${label} page=${page}`);
    console.log('   请求失败:', e.message);
    return { ok: false };
  }
}

(async () => {
  console.log('Cookie:', COOKIE ? `已提供 (uin=${UIN})` : '未提供（匿名测试）');
  console.log();

  const variants = [
    ['[1] GET  u.musicu  web   ', 'https://u.y.qq.com/cgi-bin/musicu.fcg', 'GET', COMM_WEB],
    ['[2] GET  u.musicu  client', 'https://u.y.qq.com/cgi-bin/musicu.fcg', 'GET', COMM_CLIENT],
    ['[3] POST u.musicu  client', 'https://u.y.qq.com/cgi-bin/musicu.fcg', 'POST', COMM_CLIENT],
    ['[4] POST u6.musics client', 'https://u6.y.qq.com/cgi-bin/musics.fcg', 'POST', COMM_CLIENT],
    ['[5] GET  u6.musics client', 'https://u6.y.qq.com/cgi-bin/musics.fcg', 'GET', COMM_CLIENT]
  ];

  const results = [];
  for (const v of variants) {
    results.push([...v, await call(v[0], v[1], v[2], v[3], 1)]);
  }

  const win = results.find(r => r[4].ok);
  if (!win) {
    console.log('\n没有可用变体：可能需要 sign 或登录态。');
    return;
  }

  console.log(`\n=== 用 ${win[0].trim()} 验证翻页是否换内容 ===`);
  const seen = new Set();
  for (const page of [1, 2, 3]) {
    const r = await call('   翻页', win[1], win[2], win[3], page);
    const fresh = (r.playlistIds || []).filter(id => !seen.has(id));
    (r.playlistIds || []).forEach(id => seen.add(id));
    console.log(`   -> 歌单ID ${(r.playlistIds || []).length} 个，新增 ${fresh.length} 个`);
  }
  console.log(`\n累计不重复歌单 ID: ${seen.size}`);
})();
