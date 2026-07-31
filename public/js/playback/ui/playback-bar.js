// 编写人：Aurora
// 播放助手播放条组件
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as UIComponents from './components.js';

/**
 * 播放条管理器
 */
export class PlaybackBar {
  constructor() {
    this.coverEl = null;
    this.titleEl = null;
    this.artistEl = null;
    this.playBtn = null;
    this.modeBtn = null;
    this.modeLabelEl = null;
    this.volumeSlider = null;
    this.volumeIcon = null;
    this.lyricBtn = null;
    this.lyricLockBtn = null;
  }

  /**
   * 初始化播放条
   */
  init() {
    this.coverEl = document.getElementById('playbackCover');
    this.titleEl = document.getElementById('playbackTrackTitle');
    this.artistEl = document.getElementById('playbackTrackArtist');
    this.playBtn = document.getElementById('playbackPlayPause');
    this.modeBtn = document.getElementById('playbackModeBtn');
    this.modeLabelEl = document.getElementById('playbackModeLabel');
    this.volumeSlider = document.getElementById('playbackVolume');
    this.volumeIcon = document.getElementById('playbackVolumeIcon');
    this.lyricBtn = document.getElementById('playbackLyricBtn');
    this.lyricLockBtn = document.getElementById('playbackLyricLockBtn');
  }

  /**
   * 渲染播放条
   * @param {Object} state - 播放状态
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {Object} lyricState - 歌词窗口状态
   */
  render(state, audio, lyricState = {}) {
    const track = state.current;

    // 渲染轨道信息
    this.renderTrackInfo(track);

    // 渲染播放控制
    this.renderPlayButton(audio);

    // 渲染播放模式
    this.renderMode(state.mode);

    // 渲染音量
    this.renderVolume(state.volume);

    // 渲染歌词按钮
    this.renderLyricButtons(lyricState);
  }

  /**
   * 渲染轨道信息
   * @param {Object} track - 轨道对象
   */
  renderTrackInfo(track) {
    // 封面
    if (this.coverEl) {
      UIComponents.renderCurrentCover(this.coverEl, track);
    }

    // 标题
    if (this.titleEl) {
      this.titleEl.textContent = track ? track.title : '未选择歌曲';
    }

    // 歌手
    if (this.artistEl) {
      const isLocal = track ? PlaybackUtils.isLocalTrack(track) : false;
      const needsFile = isLocal && track && !track.objectUrl;
      const fileMissing = isLocal && track && track.fileMissing;
      const suffix = fileMissing ? ' · 文件已移动，请重新选择' : (needsFile ? ' · 需重新选择文件' : '');

      this.artistEl.textContent = track
        ? `${(track.artists || []).join(' / ') || '未知歌手'}${suffix}`
        : '从本地测试音频开始';
    }
  }

  /**
   * 渲染播放按钮
   * @param {HTMLAudioElement} audio - 音频元素
   */
  renderPlayButton(audio) {
    if (!this.playBtn) return;

    const isPlaying = audio && !audio.paused;
    this.playBtn.classList.toggle('playing', isPlaying);
    this.playBtn.title = isPlaying ? '暂停' : '播放';
  }

  /**
   * 渲染播放模式
   * @param {string} mode - 播放模式
   */
  renderMode(mode) {
    // 模式标签
    if (this.modeLabelEl) {
      this.modeLabelEl.textContent = PlaybackUtils.getModeLabel(mode);
    }

    // 模式按钮
    if (this.modeBtn) {
      this.modeBtn.dataset.mode = mode;
      this.modeBtn.title = PlaybackUtils.getModeHint(mode);
    }
  }

  /**
   * 渲染音量
   * @param {number} volume - 音量值 (0-1)
   */
  renderVolume(volume) {
    if (this.volumeSlider) {
      this.volumeSlider.value = String(volume);
    }

    UIComponents.updateVolumeUI(volume);
  }

  /**
   * 渲染歌词按钮
   * @param {Object} lyricState - 歌词状态
   * @param {boolean} lyricState.open - 歌词窗口是否打开
   * @param {boolean} lyricState.locked - 歌词窗口是否锁定
   */
  renderLyricButtons(lyricState = {}) {
    // 歌词按钮
    if (this.lyricBtn) {
      this.lyricBtn.classList.toggle('active', lyricState.open);
      this.lyricBtn.disabled = !(window.musicAPI && typeof window.musicAPI.openLyricWindow === 'function');
    }

    // 歌词锁定按钮
    if (this.lyricLockBtn) {
      this.lyricLockBtn.classList.toggle('locked', lyricState.locked);
      this.lyricLockBtn.disabled = !lyricState.open;
    }
  }

  /**
   * 渲染音乐源状态
   * @param {Object} authState - 认证状态
   * @param {Object} healthState - 健康状态
   * @param {string} selectedSource - 选中的音乐源
   */
  renderProviderState(authState, healthState, selectedSource) {
    console.log('[PlaybackBar] renderProviderState called with selectedSource:', selectedSource);

    const sourceName = PlaybackUtils.getSourceName(selectedSource);
    const loggedIn = Boolean(authState && authState.loggedIn);

    // 更新音乐源标签
    document.querySelectorAll('.source-tab').forEach((button) => {
      const shouldBeActive = button.dataset.source === selectedSource;
      button.classList.toggle('active', shouldBeActive);
      console.log(`[PlaybackBar] Tab ${button.dataset.source}: active=${shouldBeActive}`);
    });

    // 更新状态显示
    const sourceStatus = document.getElementById('playbackSourceStatus');
    if (sourceStatus) {
      sourceStatus.textContent = loggedIn ? `${sourceName}已检测到登录` : `${sourceName}待登录`;
      sourceStatus.classList.toggle('good', loggedIn);
      sourceStatus.classList.toggle('warn', !loggedIn);
    }

    // 更新登录/登出按钮（确保互斥显示）
    const loginBtn = document.getElementById('playbackLoginBtn');
    const logoutBtn = document.getElementById('playbackLogoutBtn');
    if (loginBtn && logoutBtn) {
      // 始终更新登录按钮文本，确保切换音乐源时文本正确
      loginBtn.textContent = `登录${sourceName}`;

      // 确保只显示一个按钮
      if (loggedIn) {
        loginBtn.style.display = 'none';
        loginBtn.disabled = true;
        logoutBtn.style.display = '';
        logoutBtn.disabled = false;
      } else {
        loginBtn.style.display = '';
        loginBtn.disabled = false;
        logoutBtn.style.display = 'none';
        logoutBtn.disabled = true;
      }
    }

    // 更新用户名显示
    const userName = document.getElementById('playbackUserName');
    if (userName) {
      userName.textContent = loggedIn ? `${sourceName} Cookie 已就绪` : '未连接音乐账户';
    }

    // 更新 VIP 状态
    const vipState = document.getElementById('playbackVipState');
    if (vipState) {
      if (authState && authState.desktopUnavailable) {
        vipState.textContent = '扫码登录验证需要在桌面版里使用';
      } else if (authState && authState.error) {
        vipState.textContent = authState.error;
      } else if (loggedIn) {
        const keys = Array.isArray(authState.keyCookieNames) ? authState.keyCookieNames.join('、') : '';
        vipState.textContent = `Cookie ${authState.cookieCount || 0} 个，关键字段：${keys || '待确认'}，加密快照：${authState.encryptedSnapshotExists ? '已保存' : '未保存'}`;
      } else {
        vipState.textContent = '账号歌单和推荐将在 Provider 接入后显示';
      }
    }

    // 更新 Provider 健康状态
    const providerHealth = document.getElementById('playbackProviderHealth');
    if (providerHealth) {
      if (healthState) {
        const message = healthState.message || `Provider 状态：${healthState.status || '未知'}`;
        const details = healthState.details ? ` (${healthState.details})` : '';
        providerHealth.textContent = message + details;

        // 根据状态设置样式
        providerHealth.classList.remove('error', 'success', 'warning');
        if (healthState.ok) {
          providerHealth.classList.add('success');
        } else if (healthState.status === 'error') {
          providerHealth.classList.add('error');
        } else {
          providerHealth.classList.add('warning');
        }
      } else {
        providerHealth.textContent = '等待检查音乐 Provider 状态';
        providerHealth.classList.remove('error', 'success', 'warning');
      }
    }

    // 更新搜索框的音乐源显示
    const searchSource = document.getElementById('playbackSearchSource');
    if (searchSource) searchSource.value = sourceName;
  }
}
