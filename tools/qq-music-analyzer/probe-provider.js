// 快速验证改动后的 QQMusicProvider.getPersonalizedPlaylists
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');

const provider = new QQMusicProvider({
  getAuthState: () => null,
  getCookieHeader: () => ''
});

(async () => {
  console.log('测试 getPersonalizedPlaylists (page=1)...');
  try {
    const playlists = await provider.getPersonalizedPlaylists({ limit: 12, page: 1 });
    console.log(`✓ 返回 ${playlists.length} 个歌单`);
    if (playlists[0]) {
      console.log('  示例:', playlists[0].title, `(id=${playlists[0].id})`);
    }
  } catch (error) {
    console.error('✗ 失败:', error.message);
    process.exit(1);
  }

  console.log('\n测试 getPersonalizedPlaylists (page=2)...');
  try {
    const playlists = await provider.getPersonalizedPlaylists({ limit: 12, page: 2 });
    console.log(`✓ 返回 ${playlists.length} 个歌单`);
    if (playlists[0]) {
      console.log('  示例:', playlists[0].title, `(id=${playlists[0].id})`);
    }
  } catch (error) {
    console.error('✗ 失败:', error.message);
    process.exit(1);
  }

  console.log('\n✓ 所有测试通过');
})();
