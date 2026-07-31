// 编写人：Aurora
// 播放助手全屏播放器组件
'use strict';

import * as PlaybackUtils from '../utils.js';

/**
 * 全屏播放器管理器
 */
export class FullscreenPlayer {
  constructor() {
    this.fsEl = null;
    this.titleEl = null;
    this.artistEl = null;
    this.artEl = null;
    this.bgEl = null;
    this.vinylDiscEl = null;
    this.tonearmEl = null;
    this.lyricsContainer = null;
    this.lyricsWrap = null;
    this.lyricsInitialized = false;
    this.lastActiveLyricIndex = -1; // 跟踪上一次的活动歌词索引
  }

  /**
   * 初始化全屏播放器
   */
  init() {
    this.fsEl = document.getElementById('playerFullscreen');
    this.titleEl = document.getElementById('playerFsTitle');
    this.artistEl = document.getElementById('playerFsArtist');
    this.artEl = document.getElementById('playerFsArt');
    this.bgEl = document.getElementById('playerFsBg');
    this.vinylDiscEl = document.getElementById('playerFsVinylDisc');
    this.tonearmEl = document.getElementById('playerFsTonearm');
    this.lyricsContainer = document.getElementById('playerFsLyrics');
    this.lyricsWrap = document.getElementById('playerFsLyricsWrap');
  }

  /**
   * 渲染全屏播放器
   * @param {Object} track - 当前轨道
   * @param {HTMLAudioElement} audio - 音频元素
   */
  render(track, audio) {
    if (!this.fsEl || !this.fsEl.classList.contains('open')) return;

    const isPlaying = audio && !audio.paused;

    // 更新标题和歌手
    this.renderTrackInfo(track);

    // 更新封面和背景
    this.renderArtwork(track);

    // 更新背景主题
    this.applyBackgroundTheme(track);

    // 唱片和唱针动画
    this.updateVinylAnimation(isPlaying);

    // 渲染歌词
    this.renderLyrics(track, audio);
  }

  /**
   * 渲染轨道信息
   * @param {Object} track - 轨道对象
   */
  renderTrackInfo(track) {
    if (this.titleEl) {
      this.titleEl.textContent = track ? track.title : '未选择歌曲';
    }

    if (this.artistEl) {
      this.artistEl.textContent = track
        ? (track.artists || []).join(' / ') || '未知歌手'
        : '—';
    }
  }

  /**
   * 渲染封面艺术
   * @param {Object} track - 轨道对象
   */
  renderArtwork(track) {
    if (!this.artEl) return;

    const escapeAttr = window.AdminApp?.utils?.escapeAttr || ((s) => String(s || ''));
    const coverUrl = track && track.coverUrl ? track.coverUrl : '';

    this.artEl.classList.toggle('has-image', Boolean(coverUrl));

    if (coverUrl) {
      const existing = this.artEl.querySelector('img');
      if (!existing || existing.src !== coverUrl) {
        this.artEl.innerHTML = `<img src="${escapeAttr(coverUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">`;
      }
    } else {
      this.artEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    }
  }

  /**
   * 应用背景主题
   * @param {Object} track - 轨道对象
   */
  applyBackgroundTheme(track) {
    if (!this.bgEl) return;

    const theme = `theme-${PlaybackUtils.pickBackgroundTheme(track, 30)}`;

    if (this.bgEl.dataset.bgTheme === theme) return;

    if (this.bgEl.dataset.bgTheme) {
      this.bgEl.classList.remove(this.bgEl.dataset.bgTheme);
    }

    this.bgEl.classList.add(theme);
    this.bgEl.dataset.bgTheme = theme;
  }

  /**
   * 更新唱片和唱针动画
   * @param {boolean} isPlaying - 是否正在播放
   */
  updateVinylAnimation(isPlaying) {
    // 唱片旋转动画：播放时旋转，暂停时保持当前角度
    if (this.vinylDiscEl) {
      if (isPlaying) {
        this.vinylDiscEl.classList.add('spinning');
        this.vinylDiscEl.classList.remove('paused');
      } else {
        // 暂停时移除spinning但不重置transform，保持当前角度
        this.vinylDiscEl.classList.remove('spinning');
        this.vinylDiscEl.classList.add('paused');
      }
    }

    // 唱针状态：播放时落下，暂停时抬起
    if (this.tonearmEl) {
      this.tonearmEl.classList.toggle('playing', isPlaying);
    }
  }

  /**
   * 渲染歌词
   * @param {Object} track - 轨道对象
   * @param {HTMLAudioElement} audio - 音频元素
   */
  renderLyrics(track, audio) {
    if (!this.lyricsContainer) return;

    const lines = track && track.lyrics && Array.isArray(track.lyrics.lines)
      ? track.lyrics.lines
      : [];

    if (!lines.length) {
      this.lyricsContainer.innerHTML = '<div class="player-fs-lyrics-empty">暂无歌词</div>';
      this.lastActiveLyricIndex = -1; // 重置索引
      return;
    }

    const currentMs = audio && Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;

    // 找到当前行索引
    const currentIndex = this.findCurrentLyricIndex(lines, currentMs);

    // 重新渲染（仅在歌词变化时）
    const existingCount = this.lyricsContainer.querySelectorAll('.player-fs-lyric-line').length;
    if (existingCount !== lines.length) {
      this.renderLyricLines(lines);
      this.lastActiveLyricIndex = -1; // 歌词列表变化，重置索引以触发初始滚动
    }

    // 更新当前行高亮
    this.updateLyricHighlight(currentIndex);

    // 只有在当前歌词索引发生变化时才滚动（无论播放还是暂停）
    // 播放时会持续跟随，暂停时只在手动拖动进度条时滚动一次
    if (currentIndex !== this.lastActiveLyricIndex && currentIndex >= 0) {
      this.scrollToActiveLyric();
      this.lastActiveLyricIndex = currentIndex;
    }
  }

  /**
   * 查找当前歌词行索引
   * @param {Array} lines - 歌词行数组
   * @param {number} currentMs - 当前播放时间（毫秒）
   * @returns {number} 当前行索引
   */
  findCurrentLyricIndex(lines, currentMs) {
    let currentIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startMs <= currentMs) {
        currentIndex = i;
        break;
      }
    }
    return currentIndex;
  }

  /**
   * 渲染歌词行
   * @param {Array} lines - 歌词行数组
   */
  renderLyricLines(lines) {
    if (!this.lyricsContainer) return;

    const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

    this.lyricsContainer.innerHTML = lines.map((line, i) => `
      <div class="player-fs-lyric-line" data-lyric-index="${i}" data-lyric-start-ms="${line.startMs || 0}">
        <button class="lyric-seek-btn" type="button" aria-label="从此处播放" title="从此处播放">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <div class="lyric-content">
          <span class="lyric-text">${escapeHtml(line.text || '')}</span>
          ${line.translation ? `<span class="lyric-trans">${escapeHtml(line.translation)}</span>` : ''}
        </div>
      </div>
    `).join('');

    // 绑定点击事件（仅一次）
    if (!this.lyricsInitialized) {
      this.lyricsContainer.addEventListener('click', (event) => this.handleLyricClick(event));
      this.lyricsInitialized = true;
    }
  }

  /**
   * 更新歌词高亮
   * @param {number} currentIndex - 当前行索引
   */
  updateLyricHighlight(currentIndex) {
    if (!this.lyricsContainer) return;

    this.lyricsContainer.querySelectorAll('.player-fs-lyric-line').forEach((el, i) => {
      el.classList.toggle('active', i === currentIndex);
    });
  }

  /**
   * 滚动到当前歌词行
   */
  scrollToActiveLyric() {
    if (!this.lyricsContainer || !this.lyricsWrap) return;

    const activeLine = this.lyricsContainer.querySelector('.player-fs-lyric-line.active');
    if (!activeLine) return;

    const lineTop = activeLine.offsetTop;
    const wrapHeight = this.lyricsWrap.clientHeight;
    const targetScroll = lineTop - wrapHeight / 2 + activeLine.clientHeight / 2;

    this.lyricsWrap.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }

  /**
   * 处理歌词点击事件
   * @param {Event} event - 点击事件
   */
  handleLyricClick(event) {
    const lineEl = event.target.closest('.player-fs-lyric-line');
    if (!lineEl) return;

    const startMs = Number(lineEl.dataset.lyricStartMs);
    if (!Number.isFinite(startMs) || startMs < 0) return;

    const audio = document.getElementById('music-player');
    if (!audio) return;

    audio.currentTime = startMs / 1000;

    if (audio.paused) {
      audio.play().catch((error) => {
        console.warn('[playback] play after seek failed:', error);
      });
    }

    // 触发进度更新和状态保存（需要通过回调）
    if (this.onSeek) {
      this.onSeek();
    }
  }

  /**
   * 设置 seek 回调
   * @param {Function} callback - 回调函数
   */
  setSeekCallback(callback) {
    this.onSeek = callback;
  }
}
