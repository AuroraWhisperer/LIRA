'use strict';

const { BilibiliApiClient } = require('../bilibili/danmaku/api-client');
const {
  createDanmakuSenderService,
} = require('../bilibili/danmaku/sender-service');
const {
  createGameWinnerProfileResolver,
} = require('../bilibili/users/game-winner-profile');
const {
  BilibiliUserProfileProvider,
} = require('../bilibili/users/profile-provider');
const { UserInfoService } = require('../bilibili/users/user-info-service');
const sharedUtils = require('../shared/utils');
const {
  logBilibiliDiagnostic,
  summarizeConnectionAuth,
} = require('../bilibili/diagnostics');

function createBilibiliRuntime(options) {
  const {
    settingsStore,
    domainServices,
    broadcastSnapshot,
    buildClient,
    setActiveDanmakuRoom = () => {},
  } = options;
  const liveStatus = {
    connected: false,
    enabled: false,
    roomId: '',
    mode: 'disabled',
    message: '未启用弹幕监听',
    updatedAt: sharedUtils.now(),
  };
  const diagnostics = {
    lastPacketAt: '',
    lastCommandAt: '',
    lastGiftAt: '',
    parsedGiftCount: 0,
    unparsedGiftCount: 0,
    commandCounts: {},
    recentCommands: [],
    recentGiftLikeCommands: [],
  };
  let authProvider = null;
  let authCache = { cookieHeader: '', uid: 0 };
  let client = null;
  const userInfoService = new UserInfoService({
    profileProvider: {
      async fetchProfile(uid) {
        const apiClient =
          client?.apiClient ||
          new BilibiliApiClient(getConfiguredRoomId(), authCache);
        return new BilibiliUserProfileProvider(apiClient).fetchProfile(uid);
      },
    },
    diagnostics,
  });
  const resolveGameWinnerProfile = createGameWinnerProfileResolver({
    getHostIdentity: () => ({ uid: client?.ownerUid, name: client?.ownerName }),
    resolveRoomInfo: () => getGameApiClient().resolveRoomInfo(),
    ensureProfile: (uid, profileOptions) =>
      userInfoService.ensure(uid, profileOptions),
  });
  let stopped = false;
  let clientGeneration = 0;
  let replaceClientChain = Promise.resolve();

  const danmakuSender = createDanmakuSenderService({
    async getAuth() {
      await refreshAuthCache();
      const state = authProvider
        ? await authProvider
            .getAuthState()
            .catch(() => ({ loggedIn: false, uid: 0 }))
        : { loggedIn: false, uid: 0 };
      return {
        loggedIn: Boolean(state.loggedIn),
        uid: Number(state.uid || authCache.uid) || 0,
        cookieHeader: authCache.cookieHeader,
      };
    },
    async getRoom() {
      return { roomId: getConfiguredRoomId() };
    },
    getLiveStatus: () => liveStatus,
    getMentionTarget: () =>
      domainServices.requesterTargets.getLatestRandomRequester(),
    getAutoReplyEnabled: () =>
      settingsStore.getSettings().enableRandomTagReply === 'true',
    getCheckinBotEnabled: () =>
      settingsStore.getSettings().enableCheckinBot === 'true',
    getFortuneBotEnabled: () =>
      settingsStore.getSettings().enableFortuneBot === 'true',
    getCustomReplyBotEnabled: () =>
      settingsStore.getSettings().enableCustomReplyBot === 'true',
    createClient(roomId, auth) {
      if (client && client.roomId === roomId) {
        client.apiClient.updateAuth(auth.cookieHeader, auth.uid);
        return client.apiClient;
      }
      return new BilibiliApiClient(roomId, auth);
    },
  });

  function getConfiguredRoomId() {
    return sharedUtils.normalizeRoomInput(settingsStore.getSettings().roomId);
  }

  function getGameApiClient() {
    return (
      client?.apiClient ||
      new BilibiliApiClient(getConfiguredRoomId(), authCache)
    );
  }

  function fetchAvatarImage(value) {
    return getGameApiClient().fetchAvatarImage(value);
  }

  async function requestRandomSong() {
    const account = await authProvider?.getAuthState();
    const uid = Number(account?.uid) || 0;
    if (!account?.loggedIn || !uid) {
      return { accepted: false, reason: '请先登录直播账号后再随机点歌。' };
    }
    await refreshAuthCache();
    const profile = await userInfoService.ensure(uid, { fields: ['name'] });
    const identity = userInfoService.peek(uid, {
      fields: ['guard', 'fansMedal'],
      roomId: getConfiguredRoomId(),
    });
    return domainServices.messages.handleDanmaku({
      message: '随机点歌',
      userName: profile?.name || `UID ${uid}`,
      uid: String(uid),
      source: 'danmaku',
      messageTimestamp: Date.now(),
      requesterGuardLevel: identity?.guard?.level,
      requesterMedalName: identity?.fansMedal?.value?.name,
      requesterMedalLevel: identity?.fansMedal?.value?.level,
    });
  }

  function setAuthProvider(nextAuthProvider) {
    authProvider = nextAuthProvider || null;
  }

  function configure(force = false) {
    if (stopped) return;
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;
    setActiveDanmakuRoom(enabled ? roomId : '');

    if (!enabled) {
      disconnect();
      updateStatus({
        connected: false,
        enabled: false,
        roomId,
        mode: 'disabled',
        message: roomId ? '未启用弹幕监听' : '未设置直播间',
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
        message: sharedUtils.publicBilibiliErrorMessage(error, true),
      });
    });
  }

  async function reconnect() {
    if (stopped) throw new Error('Bilibili runtime is shutting down.');
    const settings = settingsStore.getSettings();
    const roomId = sharedUtils.normalizeRoomInput(settings.roomId);
    const enabled = settings.enableBilibili === 'true' && roomId;
    logBilibiliDiagnostic('refresh-requested', {
      roomId, enabled: Boolean(enabled),
    });
    setActiveDanmakuRoom(enabled ? roomId : '');

    if (!enabled) {
      configure(true);
      return { liveStatus };
    }

    await replaceClient(roomId, true);
    return { liveStatus };
  }

  function replaceClient(roomId, restart = false) {
    disconnect();
    const generation = clientGeneration;
    const isCurrent = () => !stopped && generation === clientGeneration;
    const run = async () => {
      if (!isCurrent()) return;
      await refreshAuthCache();
      if (!isCurrent()) return;
      logBilibiliDiagnostic('listener-created', {
        roomId,
        clientGeneration: generation,
        trigger: restart ? 'refresh' : 'configure',
        ...summarizeConnectionAuth(authCache),
        requestsPaused: settingsStore.getSettings().paused === 'true',
        onlyFromLibrary: settingsStore.getSettings().onlyFromLibrary === 'true',
      });
      const nextClient = buildClient(roomId, {
        isShuttingDown: () => !isCurrent(),
        danmakuSender,
        updateLiveStatus: (status) => {
          if (isCurrent()) updateStatus(status);
        },
        bilibiliDiagnostics: diagnostics,
        bilibiliAuthCache: authCache,
        bilibiliClientGeneration: generation,
        userInfoService,
      });
      client = nextClient;
      if (restart) {
        await nextClient.restart();
      } else {
        nextClient.start();
      }
    };
    const result = replaceClientChain.then(run, run).catch((error) => {
      if (isCurrent()) throw error;
    });
    replaceClientChain = result.catch(() => {});
    return result;
  }

  async function refreshAuthCache() {
    if (!authProvider) return;
    try {
      const [cookieHeader, uid] = await Promise.all([
        authProvider.getCookieHeader().catch(() => {
          logBilibiliDiagnostic('auth-read-failed', { field: 'cookieHeader' });
          return '';
        }),
        authProvider.getUid().catch(() => {
          logBilibiliDiagnostic('auth-read-failed', { field: 'uid' });
          return 0;
        }),
      ]);
      if (
        authCache.cookieHeader !== (cookieHeader || '') ||
        authCache.uid !== (Number(uid) || 0)
      ) {
        logBilibiliDiagnostic('auth-cache-changed', {
          clientGeneration,
          ...summarizeConnectionAuth({ cookieHeader, uid }),
        });
      }
      authCache = { cookieHeader: cookieHeader || '', uid: Number(uid) || 0 };
    } catch (_) {
      // Non-Electron mode can run without a Bilibili auth provider.
    }
  }

  function updateStatus(nextStatus) {
    if (stopped) return;
    Object.assign(liveStatus, {
      ...nextStatus,
      updatedAt: sharedUtils.now(),
    });
    broadcastSnapshot('live:status');
  }

  function stopClient() {
    if (!client) return;
    client.stop();
    client = null;
  }

  function disconnect() {
    clientGeneration += 1;
    stopClient();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    disconnect();
    userInfoService.dispose();
  }

  return {
    configure,
    disconnect,
    reconnect,
    stop,
    setAuthProvider,
    updateStatus,
    getAuthProvider: () => authProvider,
    getDanmakuSender: () => danmakuSender,
    getDiagnostics: () => diagnostics,
    getLiveStatus: () => liveStatus,
    getViewerCandidates: () => client?.getViewerCandidates?.() || [],
    refreshViewerCandidates: () =>
      client?.refreshViewerCandidates?.() || Promise.resolve(),
    getGameWinnerProfile: resolveGameWinnerProfile,
    fetchAvatarImage,
    requestRandomSong,
  };
}

module.exports = { createBilibiliRuntime };
