'use strict';

import { showError } from '../shared/utils.js';
import { notifyMediaPlayFailure } from '../shared/media-playback-feedback.js';
import { activateModalFocus } from '../shared/modal-focus.js';
import { preparePlaybackOutput } from '../playback/features/output-device.js';

export class PlayerWorkspace {
  /**
   * 初始化工作区控制
   */
  initWorkspaceControls({ getCloseQueuePopup = () => undefined } = {}) {
    this.getCloseQueuePopup = getCloseQueuePopup;
    // 全屏播放器
    const playerPanel = document.querySelector('.playback-player-panel');
    const fsEl = document.getElementById('playerFullscreen');
    const fsCloseBtn = document.getElementById('playerFsClose');
    const playerDockToggle = document.getElementById('playerDockToggle');

    document.getElementById('playerAppearanceOpenBtn')?.addEventListener('click', () => {
      this.setPlayerDockCollapsed(false);
      this.openFullscreenPlayer();
    });

    // 点击播放器面板（排除按钮和输入框）切换全屏
    playerPanel?.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, .playback-seek-wrap')) return;
      if (fsEl?.classList.contains('open')) {
        this.closeFullscreenPlayer();
      } else {
        this.openFullscreenPlayer();
      }
    });

    // 收起按钮 - 关闭全屏播放器
    fsCloseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeFullscreenPlayer();
    });

    // ESC键关闭全屏播放器，空格键播放/暂停
    playerDockToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = !document.body.classList.contains('player-dock-collapsed');
      this.setPlayerDockCollapsed(collapsed);
      try { window.localStorage?.setItem('lira-player-dock-collapsed', String(collapsed)); }
      catch (error) { console.warn('[player dock] Could not remember layout:', error); }
    });

    let playerCollapsed = true;
    try { playerCollapsed = window.localStorage?.getItem('lira-player-dock-collapsed') !== 'false'; }
    catch (error) { console.warn('[player dock] Could not restore layout:', error); }
    this.setPlayerDockCollapsed(playerCollapsed);

    const handleFullscreenKeydown = (e) => {
      if (!fsEl?.classList.contains('open') || fsEl.closest('[inert]') || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeFullscreenPlayer();
        return;
      }
      // 空格键控制播放/暂停（在全屏播放器打开时）
      if (e.key === ' ' && !e.target.closest(
        'button, input, select, textarea, a, summary, [role="button"], [contenteditable="true"]',
      )) {
        e.preventDefault();
        const audio = document.getElementById('music-player');
        if (audio) {
          if (audio.paused) {
            const source = audio.src;
            preparePlaybackOutput(audio).then(() => {
              if (audio.src === source && audio.paused) return audio.play();
            }, showError).catch((error) => {
              notifyMediaPlayFailure(error, audio);
            });
          } else {
            audio.pause();
          }
        }
      }
    };
    fsEl?.addEventListener('keydown', handleFullscreenKeydown);
    playerPanel?.addEventListener('keydown', handleFullscreenKeydown);
  }

  /**
   * 打开全屏播放器
   */
  openFullscreenPlayer() {
    const fsEl = document.getElementById('playerFullscreen');
    if (!fsEl || fsEl.classList.contains('open')) return;
    fsEl.classList.add('open');
    fsEl.inert = false;
    fsEl.removeAttribute('aria-hidden');
    document.body.classList.add('player-fs-open');
    this.releaseFullscreenFocus = activateModalFocus(fsEl, {
      initialFocus: document.getElementById('playerFsClose'),
      returnFocus: document.activeElement === document.body ? null : document.activeElement,
      fallbackFocus: document.getElementById('playerDockToggle'),
      additionalRoots: [
        document.querySelector('.playback-player-panel'),
        document.getElementById('queuePopup'),
        document.getElementById('pendingConfirmPopup'),
      ],
      backdrop: document.getElementById('queuePopupBackdrop'),
    });
  }

  /**
   * 关闭全屏播放器
   */
  closeFullscreenPlayer() {
    const fsEl = document.getElementById('playerFullscreen');
    if (!fsEl) return;
    fsEl.classList.remove('open');
    fsEl.inert = true;
    fsEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('player-fs-open');
    this.releaseFullscreenFocus?.();
    this.releaseFullscreenFocus = null;
  }

  setPlayerDockCollapsed(collapsed) {
    const playerPanel = document.querySelector('.playback-player-panel');
    const playerBody = document.getElementById('playbackPlayerBody');
    const playerDockToggle = document.getElementById('playerDockToggle');
    const label = collapsed ? '展开播放器' : '收起播放器';

    if (collapsed) this.closeDockDependentPlaybackUi();
    if (collapsed && playerBody?.contains(document.activeElement)) playerDockToggle?.focus();
    document.body.classList.toggle('player-dock-collapsed', collapsed);
    playerPanel?.classList.toggle('is-collapsed', collapsed);
    playerBody?.setAttribute('aria-hidden', String(collapsed));
    if (playerBody) playerBody.inert = collapsed;

    if (playerDockToggle) {
      playerDockToggle.title = label;
      playerDockToggle.setAttribute('aria-label', label);
      playerDockToggle.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  closeDockDependentPlaybackUi() {
    this.closeFullscreenPlayer();

    const closeQueuePopup = this.getCloseQueuePopup?.();
    if (typeof closeQueuePopup === 'function') {
      closeQueuePopup();
    } else {
      document.getElementById('queuePopup')?.classList.remove('open');
      document.getElementById('queuePopupBackdrop')?.classList.remove('open');
      document.getElementById('playbackQueueBtn')?.classList.remove('active');
    }

    const volumePanel = document.getElementById('playbackVolumePanel');
    const volumeButton = document.getElementById('playbackVolumeIcon');
    volumeButton?.closest('.playback-volume-wrap')?.classList.remove('open');
    volumeButton?.setAttribute('aria-expanded', 'false');
    volumePanel?.setAttribute('aria-hidden', 'true');
  }
}

export const playerWorkspace = new PlayerWorkspace();
