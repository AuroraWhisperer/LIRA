// 编写人：Aurora
// 音乐源（Provider）操作模块
'use strict';

import { createPlaybackStateActions } from '../state/actions.js';

import * as PlaybackUtils from '../utils.js';

/**
 * 创建音乐源操作模块
 * @param {Object} deps - 依赖对象
 * @returns {Object} 音乐源操作函数集合
 */
export function createProviderOperations(deps) {
  const {
    playbackState,
    providerManager,
    cacheManager,
    weSingService,
    savePlaybackState,
    renderPlayback,
    getPlaybackAudio,
    invalidatePlaybackRequests,
    toast,
    showError,
    U,
  } = deps;
  const stateActions =
    deps.stateActions ||
    createPlaybackStateActions(playbackState, {
      save: savePlaybackState,
      render: renderPlayback,
    });

  let playbackAuthState = null;
  let playbackProviderHealth = null;
  let playbackProviderRefreshId = 0;

  /**
   * 刷新选中音乐源的状态（认证 + 健康检查）
   */
  async function refreshSelectedMusicProviderState() {
    const platform = playbackState.selectedSource;
    const refreshId = ++playbackProviderRefreshId;
    await weSingService.setSelected(platform === 'wesing');
    if (refreshId !== playbackProviderRefreshId || playbackState.selectedSource !== platform) return;
    if (platform === 'wesing') {
      playbackAuthState = weSingService.getAuthState();
      playbackProviderHealth = weSingService.getProviderHealth();
      renderPlayback();
      return;
    }
    const [authResult, healthResult] = await Promise.allSettled([
      providerManager.refreshAuthState({ platform, notify: false }),
      providerManager.checkProviderHealth({
        platform,
        silent: true,
        notify: false,
      }),
    ]);

    if (refreshId !== playbackProviderRefreshId || playbackState.selectedSource !== platform) return;
    playbackAuthState = authResult.status === 'fulfilled' ? authResult.value : providerManager.getAuthState(platform);
    playbackProviderHealth = providerManager.getProviderHealth(platform);
    if (!playbackProviderHealth && healthResult.status === 'rejected') {
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: healthResult.reason?.message || String(healthResult.reason),
      };
    }
    renderPlayback();
  }

  /**
   * 仅刷新选中音乐源的认证状态
   */
  async function refreshSelectedMusicAuthState() {
    const platform = playbackState.selectedSource;
    if (platform === 'wesing') {
      playbackAuthState = weSingService.getAuthState();
      renderPlayback();
      return playbackAuthState;
    }
    const authState = await providerManager.refreshAuthState({
      platform,
      notify: false,
    });
    if (playbackState.selectedSource === platform) {
      playbackAuthState = authState;
      renderPlayback();
    }
    return authState;
  }

  /**
   * 检查选中音乐源的健康状态
   */
  async function checkSelectedMusicProviderHealth(options = {}) {
    const platform = playbackState.selectedSource;
    if (platform === 'wesing') {
      await weSingService.refresh({ notify: !options.silent });
      playbackAuthState = weSingService.getAuthState();
      playbackProviderHealth = weSingService.getProviderHealth();
      renderPlayback();
      return playbackProviderHealth;
    }
    try {
      const healthState = await providerManager.checkProviderHealth({
        platform,
        silent: true,
        notify: false,
      });
      if (playbackState.selectedSource !== platform) return healthState;
      playbackProviderHealth = healthState;
      if (!options.silent) showHealthResult(platform, playbackProviderHealth);
    } catch (error) {
      if (playbackState.selectedSource !== platform) return providerManager.getProviderHealth(platform);
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: error.message || String(error),
      };
      if (!options.silent) showHealthResult(platform, playbackProviderHealth);
    }
    renderPlayback();
    return playbackProviderHealth;
  }

  function showHealthResult(platform, state) {
    if (typeof U.showStackedToast !== 'function') {
      toast(state.message || '音乐平台连接检查完成', { type: state.ok ? 'success' : 'warning' });
      return;
    }
    U.showStackedToast({
      key: `playback-health:${platform}`,
      update: true,
      type: state.ok ? 'success' : 'warning',
      title: state.ok ? '连接检查通过' : '音乐平台连接异常',
      message: state.message || '音乐平台连接检查完成',
      className: state.ok ? 'playback-health-toast-good' : 'playback-health-toast-warn',
      duration: state.ok ? 3800 : 6000,
    });
  }

  /**
   * 登录选中的音乐源
   */
  async function loginSelectedMusicProvider(platform = playbackState.selectedSource) {
    if (!window.musicAPI || typeof window.musicAPI.login !== 'function') {
      toast('扫码登录需要在桌面版里使用');
      return;
    }

    const button = document.getElementById('playbackLoginBtn');
    if (button) button.disabled = true;
    try {
      await window.musicAPI.login(platform);
      cacheManager?.clearByPrefix(`${platform}:`);
      let authState = null;
      try {
        authState =
          platform === 'wesing'
            ? weSingService.getAuthState()
            : await providerManager.refreshAuthState({ platform, notify: false });
      } catch (_) {
        // A closed login window does not prove authentication succeeded.
        authState = null;
      }
      if (playbackState.selectedSource === platform) {
        playbackAuthState = authState;
        renderPlayback();
        await checkSelectedMusicProviderHealth({ silent: true });
      }
      const sourceName = PlaybackUtils.getSourceName(platform);
      const loggedIn = authState?.loggedIn === true;
      U.showStackedToast({
        key: `music-login-result:${platform}`,
        update: true,
        type: loggedIn ? 'success' : 'warning',
        title: loggedIn
          ? `${sourceName}已登录`
          : authState
            ? `尚未完成${sourceName}登录`
            : `暂时无法确认${sourceName}登录状态`,
        message: loggedIn
          ? '现在可以使用该平台账号'
          : authState
            ? '登录窗口已关闭，可重新打开完成登录'
            : '请稍后刷新该平台的登录状态',
        className: loggedIn ? 'music-cookie-refreshed-toast' : 'playback-health-toast-warn',
        duration: loggedIn ? 3600 : 6000,
      });
    } catch (error) {
      showError(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * 显示登录提示
   */
  function showPlaybackLoginPrompt() {
    const platform = playbackState.selectedSource;
    const sourceName = PlaybackUtils.getSourceName(platform);
    if (typeof U.showStackedToast !== 'function') {
      toast(`请先登录${sourceName}`);
      return;
    }

    U.showStackedToast({
      key: `playback-login-required:${platform}`,
      title: `请先登录${sourceName}`,
      message: '登录后即可播放在线音乐',
      className: 'playback-login-toast',
      duration: 5200,
      actionLabel: `登录${sourceName}`,
      onClick: () => loginSelectedMusicProvider(platform),
    });
  }

  /**
   * 退出登录选中的音乐源
   */
  async function logoutSelectedMusicProvider() {
    if (!window.musicAPI || typeof window.musicAPI.logout !== 'function') {
      toast('退出音乐账号需要在桌面版里使用');
      return;
    }
    const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);

    const confirmed = await window.AdminApp.utils.logoutConfirm({
      title: '退出登录',
      platform: sourceName,
      message: '退出后将无法访问该平台的会员歌曲和个人歌单。',
      icon: '→',
      confirmLabel: '确认退出',
    });
    if (!confirmed) return;

    try {
      const platform = playbackState.selectedSource;
      await window.musicAPI.logout(playbackState.selectedSource);
      playbackAuthState = null;
      clearPlaybackPlatformAfterLogout(platform);
      await refreshSelectedMusicProviderState();
      toast(`${sourceName}已退出登录`);
    } catch (error) {
      showError(error);
      await refreshSelectedMusicProviderState().catch(() => {});
    }
  }

  /**
   * 退出登录后清理指定平台的数据
   */
  function clearPlaybackPlatformAfterLogout(platform) {
    const source = platform === 'netease' ? 'netease' : 'qq';
    invalidatePlaybackRequests(source);
    cacheManager?.clearByPrefix(`${source}:`);
    stateActions.forgetProviderStreams(source);

    if (playbackState.current && playbackState.current.source === source) {
      const audio = getPlaybackAudio();
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      stateActions.clearCurrent();
      toast('当前播放歌曲所属账号已退出，请重新选择音源');
    }
    savePlaybackState();
  }

  /**
   * 获取当前的认证状态（供外部读取）
   */
  function getAuthState() {
    return playbackAuthState;
  }

  /**
   * 获取当前的健康状态（供外部读取）
   */
  function getProviderHealth() {
    return playbackProviderHealth;
  }

  return {
    refreshSelectedMusicProviderState,
    refreshSelectedMusicAuthState,
    checkSelectedMusicProviderHealth,
    loginSelectedMusicProvider,
    showPlaybackLoginPrompt,
    logoutSelectedMusicProvider,
    getAuthState,
    getProviderHealth,
  };
}
