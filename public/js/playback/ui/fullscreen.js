// 编写人：Aurora
// 播放助手全屏播放器组件
'use strict';

import * as PlaybackUtils from '../utils.js';

const TONEARM_SVG = `
  <svg viewBox="0 0 240 440" data-player-tonearm="curved" aria-hidden="true">
    <defs>
      <linearGradient id="playerFsMetal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7c8389"/>
        <stop offset="0.28" stop-color="#f8fafb"/>
        <stop offset="0.52" stop-color="#aeb5ba"/>
        <stop offset="0.78" stop-color="#fff"/>
        <stop offset="1" stop-color="#6e7479"/>
      </linearGradient>
      <filter id="playerFsArmShadow" x="-40%" y="-20%" width="180%" height="160%">
        <feDropShadow dx="7" dy="9" stdDeviation="7" flood-color="#20242a" flood-opacity=".22"/>
      </filter>
    </defs>
    <g filter="url(#playerFsArmShadow)">
      <rect x="130" y="0" width="42" height="62" rx="5" fill="url(#playerFsMetal)"/>
      <rect x="124" y="10" width="54" height="12" rx="3" fill="url(#playerFsMetal)"/>
      <rect x="124" y="36" width="54" height="12" rx="3" fill="url(#playerFsMetal)"/>
      <rect x="145" y="56" width="12" height="38" rx="5" fill="url(#playerFsMetal)"/>
      <circle cx="151" cy="105" r="42" fill="#eef0f1" fill-opacity=".72"/>
      <circle cx="151" cy="105" r="27" fill="url(#playerFsMetal)"/>
      <circle cx="151" cy="105" r="18" fill="#f5f6f6"/>
      <circle cx="151" cy="105" r="17" fill="none" stroke="#c8cccf" stroke-width="2"/>
      <path d="M151 126 C151 230 158 294 128 348 C116 369 101 387 83 401" fill="none" stroke="#737a80" stroke-width="13" stroke-linecap="round"/>
      <path d="M148 126 C148 230 154 291 124 344 C112 365 98 382 80 396" fill="none" stroke="url(#playerFsMetal)" stroke-width="8" stroke-linecap="round"/>
      <g transform="translate(80 398) rotate(42)">
        <rect x="-23" y="-16" width="48" height="34" rx="13" fill="#f6f7f7"/>
        <circle cx="0" cy="1" r="8" fill="#d8dcde"/>
        <path d="M19 11 L48 27" stroke="#81878c" stroke-width="4" stroke-linecap="round"/>
        <path d="M47 27 L58 36" stroke="#373d42" stroke-width="2" stroke-linecap="round"/>
      </g>
    </g>
  </svg>`;

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
    this.lyricTogglesEl = null;
    this.lyricToggleTransBtn = null;
    this.lyricToggleRomaBtn = null;
    this.lyricsInitialized = false;
    this.lastActiveLyricIndex = -1;
    this.lyricMode = 'none'; // 'none' | 'trans' | 'roma'
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
    if (this.tonearmEl && !String(this.tonearmEl.innerHTML || '').includes('data-player-tonearm="curved"')) {
      this.tonearmEl.innerHTML = TONEARM_SVG;
    }
    this.lyricsContainer = document.getElementById('playerFsLyrics');
    this.lyricsWrap = document.getElementById('playerFsLyricsWrap');
    this.lyricTogglesEl = document.getElementById('playerFsLyricToggles');
    this.lyricToggleTransBtn = document.getElementById('fsLyricToggleTrans');
    this.lyricToggleRomaBtn = document.getElementById('fsLyricToggleRoma');

    if (this.lyricToggleTransBtn) {
      this.lyricToggleTransBtn.addEventListener('click', () => this._toggleLyricMode('trans'));
    }
    if (this.lyricToggleRomaBtn) {
      this.lyricToggleRomaBtn.addEventListener('click', () => this._toggleLyricMode('roma'));
    }
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

    // 更新歌词切换按钮可见性
    this._updateLyricToggles(track);
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
      this.vinylDiscEl.classList.add('spinning');
      if (isPlaying) {
        this.vinylDiscEl.classList.remove('paused');
      } else {
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

    // 保存歌词行引用，供 _toggleLyricMode 重渲染使用
    this._lastLyricLines = lines;

    if (!lines.length) {
      this.lyricsContainer.innerHTML = '<div class="player-fs-lyrics-empty">暂无歌词</div>';
      this.lastActiveLyricIndex = -1;
      return;
    }

    const currentMs = audio && Number.isFinite(audio.currentTime) ? audio.currentTime * 1000 : 0;

    // 找到当前行索引
    const currentIndex = this.findCurrentLyricIndex(lines, currentMs);

    // 重新渲染（仅在歌词变化时）
    const existingCount = this.lyricsContainer.querySelectorAll('.player-fs-lyric-line').length;
    if (existingCount !== lines.length) {
      console.log('[fullscreen] renderLyrics: re-rendering lyrics, count:', lines.length);
      this.renderLyricLines(lines);
      this.lastActiveLyricIndex = -1; // 歌词列表变化，重置索引以触发初始滚动
    }

    // 更新当前行高亮
    this.updateLyricHighlight(currentIndex);

    // 只有在当前歌词索引发生变化时才滚动（无论播放还是暂停）
    // 播放时会持续跟随，暂停时只在手动拖动进度条时滚动一次
    if (currentIndex !== this.lastActiveLyricIndex && currentIndex >= 0) {
      console.log('[fullscreen] renderLyrics: lyric index changed:', {
        lastIndex: this.lastActiveLyricIndex,
        currentIndex,
        currentMs,
        lineText: lines[currentIndex]?.text
      });
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

    const showTrans = this.lyricMode === 'trans';
    const showRoma = this.lyricMode === 'roma';

    this.lyricsContainer.innerHTML = lines.map((line, i) => `
      <div class="player-fs-lyric-line" data-lyric-index="${i}" data-lyric-start-ms="${line.startMs || 0}">
        <button class="lyric-seek-btn" type="button" aria-label="从此处播放" title="从此处播放">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <div class="lyric-content">
          <span class="lyric-text">${escapeHtml(line.text || '')}</span>
          ${showTrans && line.translation ? `<span class="lyric-trans">${escapeHtml(line.translation)}</span>` : ''}
          ${showRoma && line.roma ? `<span class="lyric-trans">${escapeHtml(line.roma)}</span>` : ''}
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
    if (!this.lyricsContainer) {
      console.warn('[fullscreen] scrollToActiveLyric: lyricsContainer not found');
      return;
    }

    const activeLine = this.lyricsContainer.querySelector('.player-fs-lyric-line.active');
    if (!activeLine) {
      console.warn('[fullscreen] scrollToActiveLyric: no active line found');
      return;
    }

    // 获取歌词容器（这是实际可滚动的元素）
    const scrollContainer = this.lyricsContainer;
    const lineTop = activeLine.offsetTop;
    const lineHeight = activeLine.clientHeight;
    const containerHeight = scrollContainer.clientHeight;

    // 将当前歌词定位在屏幕上方 1/3 位置（中间偏上）
    const targetScroll = lineTop - containerHeight / 3 + lineHeight / 2;

    console.log('[fullscreen] scrollToActiveLyric:', {
      lineTop,
      lineHeight,
      containerHeight,
      targetScroll,
      currentScroll: scrollContainer.scrollTop
    });

    // 直接设置 scrollTop
    scrollContainer.scrollTop = Math.max(0, targetScroll);
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
   * 切换歌词显示模式
   * @param {string} mode - 'trans' | 'roma'
   */
  _toggleLyricMode(mode) {
    // 禁用态不响应点击
    const btn = mode === 'trans' ? this.lyricToggleTransBtn : this.lyricToggleRomaBtn;
    if (btn && btn.classList.contains('disabled')) return;

    if (this.lyricMode === mode) {
      // 再次点击同一按钮 → 关闭
      this.lyricMode = 'none';
    } else {
      this.lyricMode = mode;
    }
    this._updateLyricToggleButtons();

    // 重新渲染歌词以反映新模式
    if (this.lyricsContainer) {
      const lines = this._lastLyricLines;
      if (lines && lines.length > 0) {
        this.renderLyricLines(lines);
      }
    }
  }

  /**
   * 更新歌词切换按钮的可见性和激活状态
   * @param {Object} track - 轨道对象
   */
  _updateLyricToggles(track) {
    if (!this.lyricTogglesEl) return;

    const lines = track && track.lyrics && Array.isArray(track.lyrics.lines)
      ? track.lyrics.lines
      : [];

    const hasTranslation = lines.some((line) => line.translation);
    const hasRoma = lines.some((line) => line.roma);

    // 有歌词就显示按钮区域，无数据时按钮呈半禁用态
    const hasLyrics = lines.length > 0;
    this.lyricTogglesEl.style.display = hasLyrics ? 'flex' : 'none';

    if (this.lyricToggleTransBtn) {
      this.lyricToggleTransBtn.style.display = '';
      this.lyricToggleTransBtn.classList.toggle('disabled', !hasTranslation);
      if (!hasTranslation) {
        this.lyricToggleTransBtn.title = '当前歌曲无翻译数据';
      } else {
        this.lyricToggleTransBtn.title = '在原文基础上叠加中文翻译';
      }
    }
    if (this.lyricToggleRomaBtn) {
      this.lyricToggleRomaBtn.style.display = '';
      this.lyricToggleRomaBtn.classList.toggle('disabled', !hasRoma);
      if (!hasRoma) {
        this.lyricToggleRomaBtn.title = '当前歌曲无罗马音数据';
      } else {
        this.lyricToggleRomaBtn.title = '在原文基础上叠加罗马音音译（日/韩等外文歌曲）';
      }
    }

    // 重置模式（切歌时）
    this.lyricMode = 'none';
    this._updateLyricToggleButtons();
  }

  /**
   * 同步按钮激活样式
   */
  _updateLyricToggleButtons() {
    if (this.lyricToggleTransBtn) {
      this.lyricToggleTransBtn.classList.toggle('active', this.lyricMode === 'trans');
    }
    if (this.lyricToggleRomaBtn) {
      this.lyricToggleRomaBtn.classList.toggle('active', this.lyricMode === 'roma');
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
