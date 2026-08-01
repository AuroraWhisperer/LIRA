// 导出当前 QQ 音乐账号的所有歌单 ID
// 用法:
//   QQ_COOKIE="uin=xxx; qqmusic_key=xxx; ..." node dump-playlists.js
// 或者从 Electron 运行: 在 app 里调用 getCreatedPlaylists + getCollectedPlaylists
'use strict';

const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

const COOKIE = process.env.QQ_COOKIE || '';

const provider = new QQMusicProvider({
  getAuthState: () => COOKIE ? { loggedIn: true, cookieCount: 1 } : null,
  getCookieHeader: () => COOKIE
});

async function run() {
  if (!COOKIE) {
    console.log('⚠️  未设置 QQ_COOKIE 环境变量，仅尝试公开接口。');
    console.log('   设置方法: QQ_COOKIE="uin=xxx; qqmusic_key=xxx; ..." node dump-playlists.js\n');
  }

  // ===== 1. 自建歌单（包括"我喜欢"） =====
  console.log('===== 自建歌单 (getCreatedPlaylists) =====');
  try {
    const created = await provider.getCreatedPlaylists({ limit: 200, includeLiked: true });
    console.log(`共 ${created.length} 个歌单:\n`);
    created.forEach((pl, i) => {
      const isLiked = pl.dirId === '201' ? ' ❤️ 我喜欢' : '';
      console.log(`  ${i + 1}. [dirId=${pl.dirId || '-'}] id=${pl.id}  "${pl.title}"  ${pl.trackCount}首${isLiked}`);
    });
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    console.log('  (需要登录态 Cookie，请设置 QQ_COOKIE 环境变量)\n');
  }

  // ===== 2. 收藏歌单 =====
  console.log('\n===== 收藏歌单 (getCollectedPlaylists) =====');
  try {
    const collected = await provider.getCollectedPlaylists({ limit: 200 });
    console.log(`共 ${collected.length} 个歌单:\n`);
    collected.forEach((pl, i) => {
      console.log(`  ${i + 1}. [dirId=${pl.dirId || '-'}] id=${pl.id}  "${pl.title}"  ${pl.trackCount}首`);
    });
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    console.log('  (需要登录态 Cookie，请设置 QQ_COOKIE 环境变量)\n');
  }

  // ===== 3. 推荐歌单（公开接口，不需要登录）=====
  console.log('\n===== 推荐歌单 (getPersonalizedPlaylists, 公开) =====');
  try {
    const rec = await provider.getPersonalizedPlaylists({ limit: 12, page: 1 });
    console.log(`共 ${rec.length} 个推荐歌单:\n`);
    rec.forEach((pl, i) => {
      console.log(`  ${i + 1}. [dirId=${pl.dirId || '-'}] id=${pl.id}  "${pl.title}"  ${pl.trackCount}首`);
    });
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}\n`);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
