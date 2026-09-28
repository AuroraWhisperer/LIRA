'use strict';

const { NeteaseMusicProvider } = require('./providers/netease-provider');
const { QQMusicProvider } = require('./providers/qq-provider');

const SUPPORTED_MUSIC_PLATFORMS = new Set(['qq', 'netease']);

function normalizeMusicPlatform(value) {
  const platform = String(value || '')
    .trim()
    .toLowerCase();
  if (!SUPPORTED_MUSIC_PLATFORMS.has(platform)) {
    const error = new Error('音乐平台只能是 qq 或 netease。');
    error.statusCode = 400;
    throw error;
  }
  return platform;
}

function createMusicProviderRegistry(options = {}) {
  const authStateProvider = typeof options.getAuthState === 'function' ? options.getAuthState : () => null;
  const cookieHeaderProvider = typeof options.getCookieHeader === 'function' ? options.getCookieHeader : () => '';

  const providers = {
    qq: new QQMusicProvider({
      getAuthState: authStateProvider,
      getCookieHeader: cookieHeaderProvider,
    }),
    netease: new NeteaseMusicProvider({
      getAuthState: authStateProvider,
      getCookieHeader: cookieHeaderProvider,
    }),
  };

  return {
    get(platform) {
      return providers[normalizeMusicPlatform(platform)];
    },
    list() {
      return Object.values(providers);
    },
    async healthCheck(platform) {
      if (platform) return providers[normalizeMusicPlatform(platform)].healthCheck();
      return Promise.all(Object.values(providers).map((provider) => provider.healthCheck()));
    },
    async getHealthyFallback(preferredPlatform) {
      const preferred = preferredPlatform ? normalizeMusicPlatform(preferredPlatform) : '';
      const health = await Promise.all(Object.values(providers).map((provider) => provider.healthCheck()));
      return health.find((item) => item.ok && item.source !== preferred) || null;
    },
  };
}

module.exports = {
  SUPPORTED_MUSIC_PLATFORMS,
  createMusicProviderRegistry,
  normalizeMusicPlatform,
};
