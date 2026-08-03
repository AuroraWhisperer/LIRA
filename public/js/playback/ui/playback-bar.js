// 编写人：Aurora
// 播放助手播放条组件
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as UIComponents from './components.js';

const MARQUEE_PAUSE_MS = 1000;
const MARQUEE_SPEED_PX_PER_SECOND = 35;
const MARQUEE_MIN_TRAVEL_MS = 1500;

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
    this.marqueeAnimations = new WeakMap();
    this.marqueeResizeObserver = null;
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

    const marqueeElements = [this.titleEl, this.artistEl].filter(Boolean);
    if (typeof ResizeObserver === 'function') {
      this.marqueeResizeObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => this.updateMarquee(entry.target));
      });
      marqueeElements.forEach((element) => this.marqueeResizeObserver.observe(element));
    }
    marqueeElements.forEach((element) => this.updateMarquee(element));
  }

  /**
   * 渲染播放条
   * @param {Object} state - 播放状态
   * @param {HTMLAudioElement} audio - 音频元素
   */
  render(state, audio) {
    const track = state.current;

    // 渲染轨道信息
    this.renderTrackInfo(track);

    // 渲染播放控制
    this.renderPlayButton(audio);

    // 渲染播放模式
    this.renderMode(state.mode);

    // 渲染音量
    this.renderVolume(state.volume);
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
      const hasTrack = Boolean(track);
      this.setMarqueeText(this.titleEl, hasTrack ? track.title : '♫  选择一首歌曲开始播放');
      this.titleEl.classList.toggle('no-track', !hasTrack);
    }

    // 歌手
    if (this.artistEl) {
      const isLocal = track ? PlaybackUtils.isLocalTrack(track) : false;
      const needsFile = isLocal && track && !track.objectUrl;
      const fileMissing = isLocal && track && track.fileMissing;
      const suffix = fileMissing ? ' · 文件已移动，请重新选择' : (needsFile ? ' · 需重新选择文件' : '');

      this.setMarqueeText(this.artistEl, track
        ? `${(track.artists || []).join(' / ') || '未知歌手'}${suffix}`
        : '搜索歌曲、打开歌单或电台，即可开始播放');
      this.artistEl.classList.toggle('no-track', !track);
    }
  }

  setMarqueeText(element, text) {
    if (typeof element.querySelector !== 'function') {
      element.textContent = text;
      return;
    }
    const textElement = element.querySelector('.playback-marquee-text');
    if (!textElement || textElement.textContent === text) return;
    textElement.textContent = text;
    this.updateMarquee(element);
  }

  updateMarquee(element) {
    if (typeof element.querySelector !== 'function') return;
    const textElement = element.querySelector('.playback-marquee-text');
    if (!textElement) return;

    const currentAnimation = this.marqueeAnimations.get(element);
    if (currentAnimation) {
      currentAnimation.cancel();
      this.marqueeAnimations.delete(element);
    }
    element.classList.remove('is-scrolling');

    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = Math.ceil(textElement.scrollWidth - element.clientWidth);
    if (reduceMotion || element.clientWidth <= 0 || distance <= 1 || typeof textElement.animate !== 'function') {
      return;
    }

    const travelDuration = Math.max(
      MARQUEE_MIN_TRAVEL_MS,
      distance / MARQUEE_SPEED_PX_PER_SECOND * 1000
    );
    const totalDuration = travelDuration * 2 + MARQUEE_PAUSE_MS * 2;
    const rightTransform = `translateX(-${distance}px)`;
    const animation = textElement.animate([
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: MARQUEE_PAUSE_MS / totalDuration },
      { transform: rightTransform, offset: (MARQUEE_PAUSE_MS + travelDuration) / totalDuration },
      { transform: rightTransform, offset: (MARQUEE_PAUSE_MS * 2 + travelDuration) / totalDuration },
      { transform: 'translateX(0)', offset: 1 }
    ], {
      duration: totalDuration,
      iterations: Infinity,
      easing: 'linear'
    });

    element.classList.add('is-scrolling');
    this.marqueeAnimations.set(element, animation);
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
