'use strict';

const { BilibiliApiClient } = require('../bilibili/danmaku/api-client');
const { createDanmakuSenderService } = require('../bilibili/danmaku/sender-service');
const { createMessageBuffer } = require('../bilibili/diagnostics/message-buffer');
const sharedUtils = require('../shared/utils');

function createBilibiliRuntime(options) {
  const {
    settingsStore,
    domainServices,
    broadcastSnapshot,
    buildClient
  } = options;
  const liveStatus = {
    connected: false,
    enabled: false,
    roomId: '',
    mode: 'disabled',
    message: '未启用 Bilibili 监听',
    updatedAt: sharedUtils.now()
  };
  const diagnostics = {
    lastPacketAt: '',
    lastCommandAt: '',
    lastGiftAt: '',
    parsedGiftCount: 0,
    unparsedGiftCount: 0,
    commandCounts: {},
    recentCommands: [],
    recentGiftLikeCommands: []
  };
  const runtimeGiftCommandPrefixes = new Set();
  const messageBuffer = createMessageBuffer(500);
  let authProvider = null;
  let authCache = { cookieHeader: '', uid: 0 };
  let client = null;
  let stopped = false;
  let replaceClientChain = Promise.resolve();

  const danmakuSender = createDanmakuSenderService({
    async getAuth() {
      await refreshAuthCache();
      const state = authProvider
        ? await authProvider.getAuthState().catch(() => ({ loggedIn: false, uid: 0 }))
        : { loggedIn: false, uid: 0 };
      return {
        loggedIn: Boolean(state.loggedIn),
        uid: Number(state.uid || authCache.uid) || 0,
        cookieHeader: authCache.cookieHeader
      };
    },
    async getRoom() {
      return { roomId: getConfiguredRoomId() };
    },
    getLiveStatus: () => liveStatus,
    getMentionTarget: () => domainServices.requesterTargets.getLatestRandomRequester(),
    getAutoReplyEnabled: () => settingsStore.getSettings().enableRandomTagReply === 'true',
    getCheckinBotEnabled: () => settingsStore.getSettings().enableCheckinBot === 'true',
    getFortuneBotEnabled: () => settingsStore.getSettings().enableFortuneBot === 'true',
    getCustomReplyBotEnabled: () => settingsStore.getSettings().enableCustomReplyBot === 'true',
    createClient(roomId, auth) {
      if (client && client.roomId === roomId) {
        client.apiClient.updateAuth(auth.cookieHeader, auth.uid);
        return client.apiClient;
      }
      return new BilibiliApiClient(roomId, auth);
    }
  });

  function getConfiguredRoomId() {
    return sharedUtils.normalizeRoomInput(settingsStore.getSettings().roomId);
  }

  async function getGameWinnerProfile(winner = {}) {
    const role = winner.role === 'viewer' ? 'viewer' : winner.role === 'host' ? 'host' : '';
    if (!role) return { avatarUrl: '', name: '' };

    const apiClient = client?.apiClient || new BilibiliApiClient(getConfiguredRoomId(), authCache);
    let uid = role === 'viewer' ? String(winner.uid || '').trim() : String(client?.ownerUid || '').trim();
    let name = String(winner.name || '').trim();
    try {
      if (role === 'host' && !uid) {
        const roomInfo = await apiClient.resolveRoomInfo();
        uid = String(roomInfo.uid || '').trim();
        name = String(roomInfo.ownerName || '').trim();
      }
      if (!uid) return { avatarUrl: '', name };
      const profile = await apiClient.fetchUserProfile(uid);
      return { avatarUrl: profile.avatarUrl, name: profile.name || name };
    } catch (_) {
      return { avatarUrl: '', name };
    }
  }

  function fetchAvatarImage(value) {
    const apiClient = client?.apiClient || new BilibiliApiClient(getConfiguredRoomId(), authCache);
    return apiClient.fetchAvatarImage(value);
  }

  function setAuthProvider(nextAuthProvider) {
    authProvider = nextAuthProvider || null;
  }

  function configure(force = false) {
    if (stopped) return;
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;

    if (!enabled) {
      stopClient();
      updateStatus({
        connected: false,
        enabled: false,
        roomId,
        mode: 'disabled',
        message: '未启用 Bilibili 监听'
      });
      return;
    }

    if (!force && client && client.roomId === roomId) return;

    replaceClient(roomId).catch((error) => {
      if (stopped) return;
      console.warn(`[Bilibili] configure failed: ${error.message}`);
      updateStatus({
        connected: false,
        enabled: true,
        roomId,
        mode: 'bilibili',
        message: sharedUtils.publicBilibiliErrorMessage(error, true)
      });
    });
  }

  async function reconnect() {
    if (stopped) throw new Error('Bilibili runtime is shutting down.');
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;

    if (!enabled) {
      configure(true);
      return { liveStatus };
    }

    await replaceClient(roomId, true);
    return { liveStatus };
  }

  function replaceClient(roomId, restart = false) {
    const run = async () => {
      if (stopped) return;
      stopClient();
      await refreshAuthCache();
      if (stopped) return;
      const nextClient = buildClient(roomId, {
        isShuttingDown: () => stopped,
        danmakuSender,
        updateLiveStatus: updateStatus,
        bilibiliDiagnostics: diagnostics,
        runtimeGiftCommandPrefixes,
        messageBuffer,
        bilibiliAuthCache: authCache
      });
      client = nextClient;
      if (restart) {
        try {
          await nextClient.restart();
        } finally {
          if (stopped) nextClient.stop();
        }
      } else {
        nextClient.start();
      }
    };
    const result = replaceClientChain.then(run, run);
    replaceClientChain = result.catch(() => {});
    return result;
  }

  async function refreshAuthCache() {
    if (!authProvider) return;
    try {
      const [cookieHeader, uid] = await Promise.all([
        authProvider.getCookieHeader().catch(() => ''),
        authProvider.getUid().catch(() => 0)
      ]);
      authCache = { cookieHeader: cookieHeader || '', uid: Number(uid) || 0 };
    } catch (_) {
      // Non-Electron mode can run without a Bilibili auth provider.
    }
  }

  function updateStatus(nextStatus) {
    if (stopped) return;
    Object.assign(liveStatus, {
      ...nextStatus,
      updatedAt: sharedUtils.now()
    });
    broadcastSnapshot('live:status');
  }

  function stopClient() {
    if (!client) return;
    client.stop();
    client = null;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stopClient();
  }

  return {
    configure,
    disconnect: stopClient,
    reconnect,
    stop,
    setAuthProvider,
    updateStatus,
    getAuthProvider: () => authProvider,
    getDanmakuSender: () => danmakuSender,
    getDiagnostics: () => diagnostics,
    getLiveStatus: () => liveStatus,
    getMessageBuffer: () => messageBuffer,
    getViewerCandidates: () => client?.getViewerCandidates?.() || [],
    getGameWinnerProfile,
    fetchAvatarImage
  };
}

module.exports = { createBilibiliRuntime };
