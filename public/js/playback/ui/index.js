// 编写人：Aurora
// 播放助手 UI 渲染协调器
'use strict';

import * as UIComponents from './components.js';
import { PlaybackBar } from './playback-bar.js';
import { QueuePopup } from './queue-popup.js';
import { Drawer } from './drawer.js';
import { FullscreenPlayer } from './fullscreen.js';

/**
 * UI 渲染协调器
 */
export class UIRenderer {
  constructor() {
    this.playbackBar = new PlaybackBar();
    this.queuePopup = new QueuePopup();
    this.drawer = new Drawer();
    this.fullscreenPlayer = new FullscreenPlayer();
  }

  /**
   * 初始化所有 UI 组件
   */
  init() {
    this.playbackBar.init();
    this.queuePopup.init();
    this.drawer.init();
    this.fullscreenPlayer.init();
  }

  /**
   * 渲染所有 UI
   * @param {Object} state - 播放状态
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {Object} extraState - 额外状态
   */
  renderAll(state, audio, extraState = {}) {
    this.playbackBar.render(state, audio, extraState.lyric);
    this.queuePopup.render(state);
    this.fullscreenPlayer.render(state.current, audio);
  }

  /**
   * 渲染进度
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {number} restoredTime - 恢复的时间
   */
  renderProgress(audio, restoredTime = 0, durationMs = 0) {
    UIComponents.renderProgress(audio, restoredTime, durationMs);
  }

  /**
   * 更新 Media Session
   * @param {Object} track - 当前轨道
   * @param {HTMLAudioElement} audio - 音频元素
   * @param {Object} handlers - 事件处理器
   */
  updateMediaSession(track, audio, handlers) {
    UIComponents.updateMediaSession(track, audio, handlers);
  }

  /**
   * 更新 Media Session 位置
   * @param {HTMLAudioElement} audio - 音频元素
   */
  updateMediaSessionPosition(audio) {
    UIComponents.updateMediaSessionPosition(audio);
  }

  /**
   * 渲染音乐源状态
   * @param {Object} authState - 认证状态
   * @param {Object} healthState - 健康状态
   * @param {string} selectedSource - 选中的音乐源
   */
  renderProviderState(authState, healthState, selectedSource) {
    this.playbackBar.renderProviderState(authState, healthState, selectedSource);
  }

  /**
   * 获取队列弹窗实例
   * @returns {QueuePopup}
   */
  getQueuePopup() {
    return this.queuePopup;
  }

  /**
   * 获取抽屉实例
   * @returns {Drawer}
   */
  getDrawer() {
    return this.drawer;
  }

  /**
   * 获取全屏播放器实例
   * @returns {FullscreenPlayer}
   */
  getFullscreenPlayer() {
    return this.fullscreenPlayer;
  }

  /**
   * 获取播放条实例
   * @returns {PlaybackBar}
   */
  getPlaybackBar() {
    return this.playbackBar;
  }
}
