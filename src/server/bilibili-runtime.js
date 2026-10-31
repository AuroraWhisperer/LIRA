'use strict';

const { BilibiliApiClient } = require('../bilibili/danmaku/api-client');
const { createDanmakuSenderService } = require('../bilibili/danmaku/sender-service');
const { createGameWinnerProfileResolver } = require('../bilibili/users/game-winner-profile');
const { BilibiliUserProfileProvider } = require('../bilibili/users/profile-provider');
const { UserInfoService } = require('../bilibili/users/user-info-service');
const sharedUtils = require('../shared/utils');
const { normalizeRoomInput } = require('../bilibili/room-input');
const { publicBilibiliErrorMessage } = require('../bilibili/api-error');
const { logBilibiliDiagnostic, summarizeConnectionAuth } = require('../bilibili/diagnostics');
const { createRoomGuardService } = require('../bilibili/room-guard-service');

function createBilibiliRuntime(options) {
  const { settingsStore, domainServices, broadcastSnapshot, buildClient, setActiveDanmakuRoom = () => {} } = options;
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
  let authFailureRevision = 0;
  let client = null;
  let lastRealtimeRoom = '';
  let lastRealtimeInput = '';
  const realtimeListeners = new Set();
  const userInfoService = new UserInfoService({
    profileProvider: {
      async fetchProfile(uid) {
        const apiClient = client?.apiClient || new BilibiliApiClient(getConfiguredRoomId(), authCache);
        return new BilibiliUserProfileProvider(apiClient).fetchProfile(uid);
      },
    },
    diagnostics,
  });
  const resolveGameWinnerProfile = createGameWinnerProfileResolver({
    getHostIdentity: () => ({ uid: client?.ownerUid, name: client?.ownerName }),
    resolveRoomInfo: () => getGameApiClient().resolveRoomInfo(),
    ensureProfile: (uid, profileOptions) => userInfoService.ensure(uid, profileOptions),
  });
  let stopped = false;
  let clientGeneration = 0;
  let replaceClientChain = Promise.resolve();
  let authRetryTimer = null;
  let authRetryAttempts = 0;
  const roomGuard = createRoomGuardService({
    readCount: options.readRoomGuardCount || ((roomId, readOptions) =>
      new BilibiliApiClient(roomId, authCache).fetchRoomGuardCount(readOptions)),
    onChange: () => broadcastSnapshot('bilibili:room-guard'),
  });

  const danmakuSender = createDanmakuSenderService({
    async getAuth() {
      const state = await refreshAuthCache(true);
      return {
        loggedIn: Boolean(state.loggedIn),
        uid: Number(state.uid || authCache.uid) || 0,
        cookieHeader: authCache.cookieHeader,
      };
    },
    async getRoom() {
      return { roomId: getConfiguredRoomId() };
    },
    getSessionKey: () => JSON.stringify([
      stopped, authFailureRevision,
      authProvider?.getIdentityRevision?.() ?? authProvider?.getSessionRevision?.(),
      settingsStore.getRoomRevision?.(), getConfiguredRoomId(),
    ]),
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
    },
  });

  function getConfiguredRoomId() {
    return normalizeRoomInput(settingsStore.getSettings().roomId);
  }

  function getGameApiClient() {
    return client?.apiClient || new BilibiliApiClient(getConfiguredRoomId(), authCache);
  }

  function fetchAvatarImage(value) {
    return getGameApiClient().fetchAvatarImage(value);
  }

  async function getUserAvatar(uid) {
    await refreshAuthCache();
    const profile = await userInfoService.ensure(uid, { fields: ['avatarUrl'] });
    return profile?.avatarUrl || '';
  }

  async function getRoomProfile() {
    const roomId = getConfiguredRoomId();
    if (!roomId) return { roomId: '', uid: '', name: '', avatarUrl: '' };
    await refreshAuthCache();
    const room = await new BilibiliApiClient(roomId, authCache).resolveRoomInfo();
    const profile = await userInfoService.ensure(room.uid, {
      fields: ['name', 'avatarUrl'],
    });
    return {
      roomId: String(room.roomId),
      uid: String(room.uid || ''),
      name: profile?.name || room.ownerName || '',
      avatarUrl: profile?.avatarUrl || '',
    };
  }

  async function requestRandomSong() {
    const requestAuthProvider = authProvider;
    const identityRevision = requestAuthProvider?.getIdentityRevision?.();
    const roomId = getConfiguredRoomId();
    const requestRoomRevision = settingsStore.getRoomRevision?.();
    const readIdentity = () => requestAuthProvider?.getRequestIdentity?.() ?? requestAuthProvider?.getAuthState();
    const isCurrent = () => !stopped && requestAuthProvider === authProvider &&
      identityRevision === requestAuthProvider?.getIdentityRevision?.() &&
      requestRoomRevision === settingsStore.getRoomRevision?.() && roomId === getConfiguredRoomId();
    const cancelled = { accepted: false, reason: '直播账号或房间已变更，已取消本次随机点歌，请重试。' };
    const fanScope = options.getFanScope?.() || null;
    const account = await readIdentity();
    if (!isCurrent()) return cancelled;
    const uid = Number(account?.uid) || 0;
    if (!account?.loggedIn || !uid) {
      return { accepted: false, reason: '请先登录直播账号后再随机点歌。' };
    }
    await refreshAuthCache();
    if (!isCurrent()) return cancelled;
    const profile = await userInfoService.ensure(uid, { fields: ['name'] });
    if (!isCurrent()) return cancelled;
    const currentAccount = await readIdentity();
    if (!isCurrent() || !currentAccount?.loggedIn || Number(currentAccount.uid) !== uid) return cancelled;
    const identity = userInfoService.peek(uid, {
      fields: ['guard', 'fansMedal'],
      roomId,
    });
    // The message handler inserts synchronously; a later switch must not undo an accepted song.
    return domainServices.messages.handleDanmaku({
      message: '随机点歌',
      userName: profile?.name || `UID ${uid}`,
      uid: String(uid),
      identityType: 'uid',
      fanScope,
      source: 'danmaku',
      messageTimestamp: Date.now(),
      requesterGuardLevel: identity?.guard?.level,
      requesterMedalName: identity?.fansMedal?.value?.name,
      requesterMedalLevel: identity?.fansMedal?.value?.level,
      requesterGuardVerified: identity?.guard?.known === true,
      requesterMedalVerified: identity?.fansMedal?.known === true,
    });
  }

  function setAuthProvider(nextAuthProvider) {
    if (authProvider !== (nextAuthProvider || null)) {
      authCache = { cookieHeader: '', uid: 0 };
      authFailureRevision += 1;
      authRetryAttempts = 0;
      disconnect();
    }
    authProvider = nextAuthProvider || null;
  }

  function configure(force = false) {
    if (stopped) return;
    const settings = settingsStore.getSettings();
    const roomId = normalizeRoomInput(settings.roomId);
    roomGuard.configure(roomId, force);
    const enabled = (settings.danmakuMonitoringEnabled ?? settings.enableBilibili) === 'true' && roomId;
    options.onRealtimeStatus?.();
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
        message: publicBilibiliErrorMessage(error, true),
      });
    });
  }

  async function reconnect() {
    if (stopped) throw new Error('Bilibili runtime is shutting down.');
    authRetryAttempts = 0;
    const settings = settingsStore.getSettings();
    const roomId = normalizeRoomInput(settings.roomId);
    const enabled = (settings.danmakuMonitoringEnabled ?? settings.enableBilibili) === 'true' && roomId;
    logBilibiliDiagnostic('refresh-requested', {
      roomId,
      enabled: Boolean(enabled),
    });
    options.onRealtimeStatus?.();
    setActiveDanmakuRoom(enabled ? roomId : '');

    if (!enabled) {
      configure(true);
      return { liveStatus };
    }

    roomGuard.configure(roomId, true);
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
      authRetryAttempts = 0;
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
        async captureReplySession() {
          const sessionAuthProvider = authProvider;
          const authSessionRevision = authProvider?.getSessionRevision?.();
          const failureRevision = authFailureRevision;
          let accountUid;
          try {
            accountUid = Number(await (sessionAuthProvider?.getUid?.() ?? authCache.uid)) || 0;
          } catch (_) {
            accountUid = null;
          }
          return (auth) => {
            if (
              isCurrent() &&
              roomId === getConfiguredRoomId() &&
              sessionAuthProvider === authProvider &&
              authSessionRevision === authProvider?.getSessionRevision?.() &&
              failureRevision === authFailureRevision &&
              accountUid !== null &&
              (!auth || (auth.loggedIn && Number(auth.uid) === accountUid))
            ) {
              return;
            }
            const error = new Error('弹幕会话已变更，已取消旧回复。');
            error.code = 'DANMAKU_SESSION_CHANGED';
            throw error;
          };
        },
        danmakuSender,
        updateLiveStatus: (status) => {
          if (isCurrent()) updateStatus(status);
        },
        onRealtimeStatus: () => {
          if (isCurrent()) options.onRealtimeStatus?.();
        },
        onRealtimeDanmaku: (event) => {
          if (isCurrent()) for (const listener of realtimeListeners) listener(event);
        },
        bilibiliDiagnostics: diagnostics,
        bilibiliAuthCache: authCache,
        bilibiliClientGeneration: generation,
        userInfoService,
      });
      client = nextClient;
      lastRealtimeInput = roomId;
      if (restart) {
        await nextClient.restart();
      } else {
        nextClient.start();
      }
    };
    const result = replaceClientChain.then(run, run).catch((error) => {
      if (!isCurrent()) return;
      throw error;
    });
    replaceClientChain = result.catch(() => {});
    return result;
  }

  function scheduleAuthRecovery() {
    const settings = settingsStore.getSettings();
    if (stopped || authRetryTimer || authRetryAttempts >= 3 ||
      (settings.danmakuMonitoringEnabled ?? settings.enableBilibili) !== 'true' || !getConfiguredRoomId()) return;
    const generation = clientGeneration;
    authRetryTimer = setTimeout(() => {
      authRetryTimer = null;
      if (!stopped && generation === clientGeneration) configure(true);
    }, 1000 * (2 ** authRetryAttempts++));
    authRetryTimer.unref?.();
  }

  async function refreshAuthCache(includeState = false) {
    const provider = authProvider;
    if (!provider) return { loggedIn: false, uid: 0 };
    const revision = provider.getSessionRevision?.();
    const generation = clientGeneration;
    try {
      const [cookieHeader, uid, state] = await Promise.all([
        Promise.resolve().then(() => provider.getCookieHeader()),
        Promise.resolve().then(() => provider.getUid()),
        includeState ? Promise.resolve().then(() => provider.getAuthState()) : null,
      ]);
      if (provider !== authProvider || revision !== provider.getSessionRevision?.() || generation !== clientGeneration) {
        throw new Error('Bilibili auth session changed during credential read.');
      }
      if (authCache.cookieHeader !== (cookieHeader || '') || authCache.uid !== (Number(uid) || 0)) {
        logBilibiliDiagnostic('auth-cache-changed', {
          clientGeneration,
          ...summarizeConnectionAuth({ cookieHeader, uid }),
        });
      }
      authCache = { cookieHeader: cookieHeader || '', uid: Number(uid) || 0 };
      options.onRealtimeStatus?.();
      return state;
    } catch (cause) {
      if (provider === authProvider && revision === provider.getSessionRevision?.() && generation === clientGeneration) {
        authCache = { cookieHeader: '', uid: 0 };
        authFailureRevision += 1;
        client?.apiClient?.updateAuth('', 0);
        stopClient();
        updateStatus({ connected: false, message: '直播账号凭据读取失败，请稍后重试。' });
        scheduleAuthRecovery();
      }
      logBilibiliDiagnostic('auth-read-failed', { clientGeneration });
      throw Object.assign(new Error('直播账号凭据读取失败，请稍后重试。', { cause }), {
        code: 'BILIBILI_AUTH_UNAVAILABLE',
      });
    }
  }

  function updateStatus(nextStatus) {
    if (stopped) return;
    Object.assign(liveStatus, {
      ...nextStatus,
      updatedAt: sharedUtils.now(),
    });
    options.onRealtimeStatus?.();
    broadcastSnapshot('live:status');
  }

  function stopClient() {
    if (!client) return;
    lastRealtimeRoom = client.getRealtimeState?.().roomId || lastRealtimeRoom;
    client.stop();
    client = null;
  }

  function disconnect() {
    if (authRetryTimer) clearTimeout(authRetryTimer);
    authRetryTimer = null;
    clientGeneration += 1;
    stopClient();
    options.onRealtimeStatus?.();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    roomGuard.stop();
    disconnect();
    realtimeListeners.clear();
    userInfoService.dispose();
  }

  function getRealtimeState() {
    const state = client?.getRealtimeState?.();
    if (client && !lastRealtimeInput) lastRealtimeInput = client.roomId;
    if (state?.roomId) lastRealtimeRoom = state.roomId;
    return {
      ready: false,
      roomId: lastRealtimeRoom,
      reason: '实时弹幕尚未就绪',
      ...state,
      accountUid: String(authCache.uid || ''),
      configuredRoomChanged: Boolean(lastRealtimeInput && lastRealtimeInput !== getConfiguredRoomId()),
    };
  }

  function getLikeState() {
    const roomId = getConfiguredRoomId();
    if (client && client.roomId === roomId) return client.getLikeState();
    return { roomId, count: null, updatedAt: null, connected: false };
  }

  return {
    getRoomGuardState: roomGuard.getSnapshot,
    getRealtimeState,
    getLikeState,
    subscribeRealtime(listener) {
      realtimeListeners.add(listener);
      return () => realtimeListeners.delete(listener);
    },
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
    refreshViewerCandidates: () => client?.refreshViewerCandidates?.() || Promise.resolve(),
    getGameWinnerProfile: resolveGameWinnerProfile,
    getRoomProfile,
    getUserAvatar,
    fetchAvatarImage,
    requestRandomSong,
  };
}

module.exports = { createBilibiliRuntime };
