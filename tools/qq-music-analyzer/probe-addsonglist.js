// 测试 AddSonglist / DelSonglist API
// 用法:
//   QQ_COOKIE="..." node probe-addsonglist.js [--dry-run] [--endpoint musicu|musics]
//
// 安全设计:
//   - 默认需要交互确认才发送写请求
//   - 添加成功后自动删除, 不改变账号数据
//   - --dry-run 只打印请求体, 不联网
//   - 不会输出 Cookie 或 token 前缀
//
// Cookie 来源:
//   - 环境变量 QQ_COOKIE
//   - 或运行 dump-cookies.js (从 Electron partition 提取)
'use strict';

const COOKIE = process.env.QQ_COOKIE || '';
const SONG_ID = parseInt(process.env.SONG_ID || '563728446', 10);
const DIR_ID = parseInt(process.env.DIR_ID || '201', 10);
const DIR_NAME = process.env.DIR_NAME || '我喜欢';
const TID = parseInt(process.env.TID || '2924077536', 10);
const ENDPOINT = process.env.ENDPOINT || 'musicu';  // musicu | musics
const DRY_RUN = process.argv.includes('--dry-run');

// ---- Cookie 解析 ----

function extractCookieValue(cookie, name) {
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

function extractUin(cookie) {
  // 按优先级: qqmusic_uin > uin > o_cookie > qm_hideuin
  const text = String(cookie || '');
  for (const key of ['qqmusic_uin', 'uin', 'o_cookie']) {
    const m = text.match(new RegExp(`(?:^|;\\s*)${key}=o?(\\d+)`));
    if (m) return m[1];
  }
  // qm_hideuin 可能包含编码
  const hide = extractCookieValue(text, 'qm_hideuin');
  if (hide) return hide.replace(/[^0-9]/g, '');
  return '0';
}

function extractGTKSource(cookie) {
  // 按优先级: qqmusic_key > qm_keyst > p_skey > skey
  const text = String(cookie || '');
  for (const key of ['qqmusic_key', 'qm_keyst', 'p_skey', 'skey']) {
    const val = extractCookieValue(text, key);
    if (val) return val;
  }
  return '';
}

function calcGTK(skey) {
  let hash = 5381;
  for (let i = 0; i < skey.length; i++) {
    hash += (hash << 5) + skey.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}

function buildGuid() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

// ---- 主流程 ----

const UIN = extractUin(COOKIE);
const GTK_SOURCE = extractGTKSource(COOKIE);
const GTK = calcGTK(GTK_SOURCE);
const GUID = buildGuid();

const addSongParam = {
  bFmtUtf8: true,
  dirId: DIR_ID,
  dirName: DIR_NAME,
  tid: TID,
  v_songInfo: [{ songId: SONG_ID, songType: 0 }]
};

console.log('═══════════════════════════════════════');
console.log('  QQ 音乐 AddSonglist 探针');
console.log('═══════════════════════════════════════');
console.log();
console.log('配置:');
console.log('  Cookie:    ' + (COOKIE ? `已设置 (${COOKIE.length} 字符)` : '❌ 未设置'));
console.log('  UIN:       ' + (UIN !== '0' ? UIN : '❌ 未能提取'));
console.log('  g_tk src:  ' + (GTK_SOURCE ? `已找到 → ${GTK}` : '❌ 未找到 qqmusic_key/qm_keyst'));
console.log('  端点:      ' + ENDPOINT + (ENDPOINT === 'musicu' ? ' (待验证是否需要 Sign)' : ' (桌面, 需要 Sign)'));
console.log('  歌曲 ID:   ' + SONG_ID);
console.log('  dirId:     ' + DIR_ID);
console.log('  dirName:   ' + DIR_NAME);
console.log('  tid:       ' + TID);
console.log('  Dry run:   ' + (DRY_RUN ? '是 (不会联网)' : '否'));
console.log();

// 基本校验
if (!COOKIE) {
  console.error('❌ 请设置 QQ_COOKIE 环境变量。');
  console.error('   用法: QQ_COOKIE="key1=val1; key2=val2; ..." node probe-addsonglist.js');
  console.error('   或先运行 Electron dump: node dump-cookies.js');
  process.exit(1);
}

if (UIN === '0') {
  console.error('❌ 未能从 Cookie 中提取 QQ 号 (uin/qqmusic_uin)。');
  console.error('   Cookie 中有这些 key: ' + (COOKIE.split(';').map(s => s.trim().split('=')[0]).join(', ') || '(无)'));
  process.exit(1);
}

if (TID === 0) {
  console.error('❌ TID 不能为 0，请通过 TID 环境变量设置真实歌单 ID。');
  process.exit(1);
}

// ---- 构建请求 ----

function buildMusicuRequest(addParam) {
  // Web 端 musicu.fcg: JSON body, 无 Sign/Mask
  const comm = {
    uin: UIN,
    format: 'json',
    ct: 24,
    cv: 0,
    guid: GUID,
    g_tk_new_20200303: GTK,
    g_tk: GTK,
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    notice: 0,
    needNewCode: 1
  };

  return {
    url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json,text/plain,*/*',
      'Origin': 'https://y.qq.com',
      'Referer': 'https://y.qq.com/',
      'User-Agent': 'Mozilla/5.0 SongAssistant/1.0',
      'Cookie': COOKIE
    },
    body: JSON.stringify({
      comm,
      'music.musicasset.PlaylistDetailWrite.AddSonglist': {
        module: 'music.musicasset.PlaylistDetailWrite',
        method: 'AddSonglist',
        param: addParam
      }
    })
  };
}

function buildMusicsRequest(addParam) {
  // 桌面端 musics.fcg: 原始 JSON body, 需要 Sign/Mask (暂不支持)
  // 这里只用于展示结构
  const comm = {
    _channelid: '20',
    _os_version: '6.2.9200-2',
    ct: '19',
    cv: '2241',
    guid: GUID,
    patch: '118',
    tmeAppID: 'qqmusic',
    tmeLoginType: 2,
    uin: UIN,
    wid: String(Math.floor(Math.random() * 1e19))
  };

  return {
    url: `https://u6.y.qq.com/cgi-bin/musics.fcg?pcachetime=${Date.now()}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      'Cookie': COOKIE
    },
    body: JSON.stringify({
      comm,
      'music.musicasset.PlaylistDetailWrite.AddSonglist': {
        module: 'music.musicasset.PlaylistDetailWrite',
        method: 'AddSonglist',
        param: addParam
      }
    }),
    note: '⚠️  musics.fcg 需要 Sign 和 Mask 头, 此脚本还不能生成。仅用于展示结构。'
  };
}

function buildDelRequest(addParam) {
  // Del 和 Add 参数结构完全相同, 仅 method 不同
  if (ENDPOINT === 'musicu') {
    const addReq = buildMusicuRequest(addParam);
    addReq.body = addReq.body.replace('"AddSonglist"', '"DelSonglist"');
    return addReq;
  } else {
    const addReq = buildMusicsRequest(addParam);
    addReq.body = addReq.body.replace('"AddSonglist"', '"DelSonglist"');
    return addReq;
  }
}

// ---- 发送请求 ----

async function sendRequest(req, label) {
  console.log(`\n── ${label} ──`);
  console.log(`POST ${req.url}`);
  if (req.note) console.log(req.note);

  if (DRY_RUN) {
    console.log('[DRY RUN] 不会实际发送。');
    console.log('Body:');
    try {
      console.log(JSON.stringify(JSON.parse(req.body), null, 2));
    } catch (_) {
      console.log(req.body.substring(0, 500));
    }
    return { dryRun: true };
  }

  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body
    });
    const text = await res.text();
    console.log(`HTTP ${res.status}`);

    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      console.log(`非 JSON 响应: ${text.substring(0, 300)}`);
      return { ok: false, httpStatus: res.status, raw: text };
    }

    const outerCode = result.code;
    console.log(`code: ${outerCode}`);

    // 查找写操作的结果
    const writeKey = Object.keys(result).find(k =>
      k.includes('PlaylistDetailWrite')
    );
    if (!writeKey) {
      console.log('未找到 PlaylistDetailWrite 响应键');
      console.log('完整响应:', JSON.stringify(result).substring(0, 400));
      return { ok: false, outerCode, detail: 'missing write key' };
    }

    const inner = result[writeKey];
    console.log(`${writeKey}:`);
    console.log(`  code: ${inner.code}`);
    if (inner.message || inner.msg) {
      console.log(`  message: ${inner.message || inner.msg}`);
    }

    if (inner.data) {
      console.log(`  retCode: ${inner.data.retCode}`);
      if (inner.data.message || inner.data.msg) {
        console.log(`  data message: ${inner.data.message || inner.data.msg}`);
      }
      if (inner.data.result) {
        const r = inner.data.result;
        console.log(`  dirId: ${r.dirId}`);
        console.log(`  tid: ${r.tid}`);
        if (Array.isArray(r.songlist)) {
          r.songlist.forEach(s => {
            console.log(`  songId: ${s.songId}, existed: ${s.existed}, loc: ${s.loc}`);
          });
        }
      }
    }

    const ok = outerCode === 0 && inner.code === 0 && inner.data && inner.data.retCode === 0;
    console.log(ok ? '  ✅ 成功' : '  ❌ 失败');

    return { ok, outerCode, inner, result };
  } catch (e) {
    console.log(`❌ 网络错误: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---- 交互确认 ----

function askConfirm(question) {
  return new Promise((resolve) => {
    if (process.env.CONFIRM_WRITE === '1') {
      console.log(`${question} [已通过 CONFIRM_WRITE=1 明确确认]`);
      resolve(true);
      return;
    }

    // 非交互模式自动跳过 (如管道)
    if (!process.stdin.isTTY) {
      console.log(`${question} [非交互模式, 自动跳过]`);
      resolve(false);
      return;
    }

    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + ' ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim().toLowerCase() === 'yes');
    });
  });
}

// ---- 入口 ----

(async () => {
  const addReq = ENDPOINT === 'musicu'
    ? buildMusicuRequest(addSongParam)
    : buildMusicsRequest(addSongParam);

  console.log('── 请求预览 ──');
  console.log(`POST ${addReq.url}`);
  console.log('Body:');
  try {
    console.log(JSON.stringify(JSON.parse(addReq.body), null, 2));
  } catch (_) {
    console.log(addReq.body.substring(0, 500));
  }
  console.log();

  if (DRY_RUN) {
    console.log('--dry-run: 不会发送任何请求。');
    process.exit(0);
  }

  if (ENDPOINT === 'musics') {
    console.log('⚠️  musics.fcg 端点需要 Sign + Mask 请求头, 当前脚本还不能生成。');
    console.log('   推荐先用 --endpoint musicu 测试 Web 端点。');
    console.log('   如果强行发送, 服务端会返回签名错误 (code=1000)。');
    console.log();
  }

  const confirmed = await askConfirm(
    `即将向「${DIR_NAME}」(dirId=${DIR_ID}) ${ENDPOINT === 'musicu' ? '添加' : '(尝试)添加'} 歌曲 ${SONG_ID}。\n` +
    `成功后会自动删除以恢复原状。\n` +
    `输入 yes 继续:`
  );

  if (!confirmed) {
    console.log('已取消。');
    process.exit(0);
  }

  // 1. 添加
  const addResult = await sendRequest(addReq, '1. AddSonglist');

  if (!addResult.ok) {
    console.log('\n❌ 添加失败, 停止 (不会尝试删除)。');
    if (addResult.inner) {
      console.log(`   原因: outerCode=${addResult.outerCode}, innerCode=${addResult.inner.code}`);
      if (addResult.inner.code === 1000) {
        console.log('   code=1000 通常是签名错误, 说明该端点需要签名验证。');
      }
    }
    process.exit(1);
  }

  const addedSong = addResult.inner && addResult.inner.data
    && addResult.inner.data.result
    && Array.isArray(addResult.inner.data.result.songlist)
    ? addResult.inner.data.result.songlist[0]
    : null;
  if (!addedSong || Number(addedSong.existed) !== 0) {
    console.log('\n⚠️  本次请求没有确认新增歌曲（可能原本已存在），为保护原有收藏，不执行自动删除。');
    process.exit(2);
  }

  // 2. 删除
  const delReq = buildDelRequest(addSongParam);
  const delResult = await sendRequest(delReq, '2. DelSonglist (自动恢复)');

  if (delResult.ok) {
    console.log('\n✅ 完整闭环验证通过: 添加 → 删除 均成功。');
    console.log(`   musicu.fcg 支持 PlaylistDetailWrite 模块。`);
    console.log();
    console.log('下一步: 在 qq-provider.js 中实现 addTracksToPlaylist / removeTracksFromPlaylist。');
    process.exit(0);
  } else {
    console.log('\n⚠️  添加成功但删除失败！请手动检查「' + DIR_NAME + '」歌单。');
    if (delResult.inner) {
      console.log(`   原因: outerCode=${delResult.outerCode}, innerCode=${delResult.inner.code}`);
    }
    process.exit(1);
  }
})();
