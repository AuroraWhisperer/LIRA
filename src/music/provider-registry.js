'use strict';

const { NeteaseMusicProvider } = require('./providers/netease-provider');
const { QQMusicProvider } = require('./providers/qq-provider');

const SUPPORTED_MUSIC_PLATFORMS = new Set(['qq', 'netease']);

const PROVIDER_LABELS = {
  qq: 'QQ音乐',
  netease: '网易云音乐'
};

function normalizeMusicPlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!SUPPORTED_MUSIC_PLATFORMS.has(platform)) {
    throw new Error('音乐平台只能是 qq 或 netease。');
  }
  return platform;
}

function createMusicProviderRegistry(options = {}) {
  const authStateProvider = typeof options.getAuthState === 'function'
    ? options.getAuthState
    : () => null;
  const cookieHeaderProvider = typeof options.getCookieHeader === 'function'
    ? options.getCookieHeader
    : () => '';

  const providers = {
    qq: new QQMusicProvider({
      getAuthState: authStateProvider,
      getCookieHeader: cookieHeaderProvider
    }),
    netease: new NeteaseMusicProvider({
      getAuthState: authStateProvider,
      getCookieHeader: cookieHeaderProvider
    })
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
    }
  };
}

class PlaceholderMusicProvider {
  constructor(source, authStateProvider) {
    this.source = source;
    this.name = PROVIDER_LABELS[source] || source;
    this.authStateProvider = authStateProvider;
  }

  async healthCheck() {
    const auth = await this.authStateProvider(this.source);
    const loggedIn = Boolean(auth && auth.loggedIn);
    return {
      source: this.source,
      name: this.name,
      ok: false,
      status: loggedIn ? 'provider-not-integrated' : 'login-required',
      message: loggedIn
        ? `${this.name} 登录 Cookie 已保存，接口 Provider 尚未接入。`
        : `${this.name} Provider 尚未接入，请先用桌面端完成最小登录验证。`,
      auth: auth ? sanitizeAuthState(auth) : null
    };
  }

  async searchTracks() {
    throw new Error(`${this.name} 搜索 Provider 尚未接入。`);
  }

  async getPersonalizedPlaylists() {
    throw new Error(`${this.name} 推荐歌单 Provider 尚未接入。`);
  }

  async getDailyTracks() {
    throw new Error(`${this.name} 每日推荐 Provider 尚未接入。`);
  }

  async getRadioTracks() {
    throw new Error(`${this.name} 电台 Provider 尚未接入。`);
  }

  async getLikedTracks() {
    throw new Error(`${this.name} 我喜欢 Provider 尚未接入。`);
  }

  async getPlaylistTracks() {
    throw new Error(`${this.name} 歌单 Provider 尚未接入。`);
  }

  async getLyrics() {
    throw new Error(`${this.name} 歌词 Provider 尚未接入。`);
  }

  async resolvePlayableUrl() {
    throw new Error(`${this.name} 在线播放 Provider 尚未接入。`);
  }
}

function sanitizeAuthState(auth) {
  return {
    loggedIn: Boolean(auth && auth.loggedIn),
    cookieCount: Number(auth && auth.cookieCount) || 0,
    keyCookieNames: Array.isArray(auth && auth.keyCookieNames) ? auth.keyCookieNames : [],
    encryptedSnapshotExists: Boolean(auth && auth.encryptedSnapshotExists),
    lastSavedAt: auth && auth.lastSavedAt ? auth.lastSavedAt : ''
  };
}

module.exports = {
  PROVIDER_LABELS,
  SUPPORTED_MUSIC_PLATFORMS,
  createMusicProviderRegistry,
  normalizeMusicPlatform
};
