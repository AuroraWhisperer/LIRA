// 端到端验证 /api/music/home 的 radio / daily 是否每次给新歌（走 lyrics-service，含缓存逻辑）
// 用法: node probe-service-refresh.js
const path = require('path');
const { initLyricsService, getMusicHomeContent } = require('../../src/music/lyrics-service');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');

initLyricsService({ dataDir: path.join(__dirname, '.probe-cache') });

const noAuth = { getAuthState: () => null, getCookieHeader: () => '' };
const providers = {
  qq: new QQMusicProvider(noAuth),
  netease: new NeteaseMusicProvider(noAuth)
};
const registry = { get: (platform) => providers[platform] };

function overlap(a, b) {
  const s = new Set(b.map((t) => t.sourceTrackId));
  return a.filter((t) => s.has(t.sourceTrackId)).length;
}

async function run(platform, action) {
  console.log(`\n=== ${platform} / ${action} ===`);
  const rounds = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await getMusicHomeContent(registry, {
        platform, action, limit: 30, page, refresh: page > 1
      });
      const tracks = res.tracks || [];
      rounds.push(tracks);
      console.log(`page=${page} cached=${Boolean(res.cached)} 拿到=${tracks.length} 示例=${tracks.slice(0, 2).map((t) => t.title).join(' | ')}`);
    } catch (e) {
      console.log(`page=${page} 失败: ${e.message}`);
      return;
    }
  }
  if (rounds.length === 3) {
    console.log(`page1 vs page2 重复=${overlap(rounds[0], rounds[1])}/${rounds[1].length}`);
    console.log(`page1 vs page3 重复=${overlap(rounds[0], rounds[2])}/${rounds[2].length}`);
    const all = new Set(rounds.flat().map((t) => t.sourceTrackId));
    console.log(`3 页累计不重复=${all.size}`);
  }
}

(async () => {
  await run('qq', 'radio');
  await run('netease', 'radio');
  await run('qq', 'daily');
  await run('netease', 'daily');
})();
