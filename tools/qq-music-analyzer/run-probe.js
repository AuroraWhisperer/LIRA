// 通过运行中的点歌助手正式 API 验证 QQ 音乐歌单写入。
// 用法: node run-probe.js [--dry-run] [--port=3000]
'use strict';

let port = 3000;
let dryRun = false;
const config = {
  songId: 563728446,
  dirId: 201,
  dirName: '我喜欢',
  tid: 2924077536
};

for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }
  const match = arg.match(/^--([\w-]+)=(.*)$/);
  if (!match) continue;
  if (match[1] === 'port') port = Number(match[2]) || 3000;
  if (match[1] === 'song-id') config.songId = Number(match[2]);
  if (match[1] === 'dir-id') config.dirId = Number(match[2]);
  if (match[1] === 'dir-name') config.dirName = match[2];
  if (match[1] === 'tid') config.tid = Number(match[2]);
}

const baseUrl = `http://127.0.0.1:${port}`;
const playlist = {
  id: String(config.tid),
  tid: String(config.tid),
  dirId: String(config.dirId),
  title: config.dirName
};
const track = {
  source: 'qq',
  sourceSongId: config.songId,
  sourceTrackId: `song-id:${config.songId}`,
  title: '探针测试歌曲'
};

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch (_) { throw new Error(`服务返回了非 JSON 响应：${text.slice(0, 120)}`); }
}

async function callWrite(operation) {
  const response = await fetch(`${baseUrl}/api/music/playlists/tracks/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'qq', playlist, tracks: [track] }),
    signal: AbortSignal.timeout(15000)
  });
  const payload = await readJson(response);
  const result = payload && payload.data && payload.data.result;
  const song = result && Array.isArray(result.songlist) ? result.songlist[0] : null;
  console.log(JSON.stringify({
    operation,
    http: response.status,
    ok: payload && payload.ok,
    error: payload && payload.error,
    dirId: result && result.dirId,
    tid: result && result.tid,
    existed: song && song.existed
  }));
  return { ok: response.ok && payload && payload.ok, song };
}

function askConfirm() {
  if (process.env.CONFIRM_WRITE === '1') return Promise.resolve(true);
  if (!process.stdin.isTTY) return Promise.resolve(false);
  return new Promise((resolve) => {
    const readline = require('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('输入 yes 执行添加并自动删除回滚: ', (answer) => {
      rl.close();
      resolve(String(answer || '').trim().toLowerCase() === 'yes');
    });
  });
}

(async () => {
  const healthResponse = await fetch(`${baseUrl}/api/music/health?platform=qq`, {
    signal: AbortSignal.timeout(5000)
  });
  const health = await readJson(healthResponse);
  if (!healthResponse.ok || !health.ok || !health.data || !health.data.auth || !health.data.auth.loggedIn) {
    throw new Error('运行中的点歌助手尚未登录 QQ 音乐。');
  }

  console.log(JSON.stringify({ baseUrl, playlist, songId: config.songId, dryRun }, null, 2));
  if (dryRun) return;
  if (!await askConfirm()) {
    console.log('已取消，未发送写请求。');
    return;
  }

  const add = await callWrite('add');
  if (!add.ok) throw new Error('AddSonglist 失败，未执行删除。');
  if (!add.song || Number(add.song.existed) !== 0) {
    console.log('歌曲原本已存在或新增状态不明确；为保护原数据，不执行删除。');
    return;
  }
  const remove = await callWrite('remove');
  if (!remove.ok) throw new Error('添加成功但自动删除失败，请手动检查目标歌单。');
  console.log('正式 API 闭环验证通过：添加和删除均成功。');
})().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
