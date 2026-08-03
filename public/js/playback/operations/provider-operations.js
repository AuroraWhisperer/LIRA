// 编写人：Aurora
// 音乐源（Provider）操作模块
'use strict';

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
    savePlaybackState,
    renderPlayback,
    getPlaybackAudio,
    toast,
    showError,
    U
  } = deps;

  let playbackAuthState = null;
  let playbackProviderHealth = null;
  let playbackProviderRefreshId = 0;

  /**
   * 刷新选中音乐源的状态（认证 + 健康检查）
   */
  async function refreshSelectedMusicProviderState() {
    const platform = playbackState.selectedSource;
    const refreshId = ++playbackProviderRefreshId;
    const [authResult, healthResult] = await Promise.allSettled([
      providerManager.refreshAuthState({ platform, notify: false }),
      providerManager.checkProviderHealth({ platform, silent: true, notify: false })
    ]);

    if (refreshId !== playbackProviderRefreshId || playbackState.selectedSource !== platform) return;
    playbackAuthState = authResult.status === 'fulfilled'
      ? authResult.value
      : providerManager.getAuthState(platform);
    playbackProviderHealth = providerManager.getProviderHealth(platform);
    if (!playbackProviderHealth && healthResult.status === 'rejected') {
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: healthResult.reason?.message || String(healthResult.reason)
      };
    }
    renderPlayback();
  }

  /**
   * 仅刷新选中音乐源的认证状态
   */
  async function refreshSelectedMusicAuthState() {
    const platform = playbackState.selectedSource;
    const authState = await providerManager.refreshAuthState({ platform, notify: false });
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
    try {
      const healthState = await providerManager.checkProviderHealth({
        platform,
        silent: true,
        notify: false
      });
      if (playbackState.selectedSource !== platform) return healthState;
      playbackProviderHealth = healthState;
      if (!options.silent) {
        const healthOk = playbackProviderHealth && playbackProviderHealth.ok;
        if (typeof U.showStackedToast === 'function') {
          U.showStackedToast({
            key: `playback-health:${platform}`,
            title: healthOk ? '接口检查通过' : '接口状态异常',
            message: playbackProviderHealth.message || '音乐接口检查完成',
            className: healthOk ? 'playback-health-toast-good' : 'playback-health-toast-warn',
            duration: 3800
          });
        } else {
          toast(playbackProviderHealth.message || '音乐接口检查完成');
        }
      }
    } catch (error) {
      if (playbackState.selectedSource !== platform) return providerManager.getProviderHealth(platform);
      playbackProviderHealth = {
        source: platform,
        ok: false,
        status: 'error',
        message: error.message || String(error)
      };
      if (!options.silent) showError(error);
    }
    renderPlayback();
    return playbackProviderHealth;
  }

  /**
   * 登录选中的音乐源
   */
  async function loginSelectedMusicProvider() {
    if (!window.musicAPI || typeof window.musicAPI.login !== 'function') {
      toast('扫码登录需要在桌面版里使用');
      return;
    }

    const button = document.getElementById('playbackLoginBtn');
    if (button) button.disabled = true;
    try {
      const platform = playbackState.selectedSource;
      await window.musicAPI.login(platform);
      cacheManager?.clearByPrefix(`${platform}:`);
      await refreshSelectedMusicProviderState();
      U.showStackedToast({
        key: 'music-cookie-refreshed',
        title: 'Cookie 已刷新',
        message: 'QQ音乐登录窗口已关闭',
        className: 'music-cookie-refreshed-toast',
        duration: 3600
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
    const sourceName = PlaybackUtils.getSourceName(playbackState.selectedSource);
    if (typeof U.showStackedToast !== 'function') {
      toast(`请先登录${sourceName}`);
      return;
    }

    U.showStackedToast({
      key: `playback-login-required:${playbackState.selectedSource}`,
      title: `请先登录${sourceName}`,
      message: '登录后即可播放在线音乐',
      className: 'playback-login-toast',
      duration: 5200,
      onClick: loginSelectedMusicProvider
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
      confirmLabel: '确认退出'
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
    cacheManager?.clearByPrefix(`${source}:`);
    const clearTrack = (track) => {
      if (!track || track.source !== source) return;
      delete track.playUrl;
      delete track.playUrlExpireAt;
    };
    [
      playbackState.current,
      ...playbackState.requestedQueue,
      ...playbackState.normalQueue,
      ...playbackState.normalQueueTracks,
      ...playbackState.radioQueue,
      ...playbackState.history
    ].forEach(clearTrack);

    if (playbackState.current && playbackState.current.source === source) {
      const audio = getPlaybackAudio();
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      playbackState.current = null;
      playbackState.currentOrigin = '';
      playbackState.restoredTime = 0;
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
    getProviderHealth
  };
}
