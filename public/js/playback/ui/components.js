// 编写人：Aurora
// 播放助手 UI 通用组件模块
'use strict';

import * as PlaybackUtils from '../utils.js';

/**
 * 渲染当前播放封面
 * @param {HTMLElement} coverElement - 封面容器元素
 * @param {Object} track - 轨道对象
 */
export function renderCurrentCover(coverElement, track) {
  if (!coverElement) return;

  const escapeAttr = window.AdminApp?.utils?.escapeAttr || ((s) => String(s || ''));
  const coverUrl = String(track && track.coverUrl || '').trim();

  coverElement.classList.toggle('has-image', Boolean(coverUrl));

  if (coverUrl) {
    coverElement.innerHTML = `<img src="${escapeAttr(coverUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.classList.remove('has-image');this.remove();">`;
  } else {
    coverElement.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
}

/**
 * 更新音量 UI
 * @param {number} volume - 音量值 (0-1)
 */
export function updateVolumeUI(volume) {
  const volSlider = document.getElementById('playbackVolume');
  const volWrap = document.querySelector('.playback-volume-wrap');

  if (volWrap) {
    volWrap.classList.toggle('muted', volume === 0);
  }

  if (volSlider) {
    volSlider.style.setProperty('--vol-pos', Math.round(volume * 100) + '%');
  }
}

/**
 * 渲染进度条
 * @param {HTMLAudioElement} audio - 音频元素
 * @param {number} restoredTime - 恢复的时间位置
 */
export function renderProgress(audio, restoredTime = 0, durationMs = 0) {
  // readyState === 0 (HAVE_NOTHING) 表示没有媒体加载，此时 audio.currentTime 为 0
  // 应使用 restoredTime 来显示上次退出时保存的播放位置
  const hasMedia = audio && audio.readyState >= 1;
  const currentTime = hasMedia && Number.isFinite(audio.currentTime)
    ? audio.currentTime
    : restoredTime;
  const duration = hasMedia && Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : (durationMs > 0 ? durationMs / 1000 : 0);

  const seek = document.getElementById('playbackSeek');
  if (seek) {
    seek.max = String(Math.max(0, duration));
    seek.value = String(Math.max(0, Math.min(currentTime, duration || currentTime)));
    const pct = duration > 0 ? Math.round((currentTime / duration) * 1000) / 10 : 0;
    seek.style.setProperty('--seek-pos', pct + '%');
  }

  const current = document.getElementById('playbackCurrentTime');
  if (current) current.textContent = PlaybackUtils.formatTime(currentTime);

  const total = document.getElementById('playbackDuration');
  if (total) total.textContent = PlaybackUtils.formatTime(duration);
}

/**
 * 更新 Media Session API
 * @param {Object} track - 当前轨道
 * @param {HTMLAudioElement} audio - 音频元素
 * @param {Object} handlers - 操作处理器
 * @param {Function} handlers.onTogglePlayback - 播放/暂停处理器
 * @param {Function} handlers.onPrevious - 上一首处理器
 * @param {Function} handlers.onNext - 下一首处理器
 */
export function updateMediaSession(track, audio, handlers = {}) {
  if (!('mediaSession' in navigator)) return;

  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '',
      artist: Array.isArray(track.artists) ? track.artists.join(' / ') : '',
      album: track.album || '',
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '300x300', type: 'image/jpeg' }] : []
    });

    navigator.mediaSession.playbackState = audio?.paused ? 'paused' : 'playing';

    if (handlers.onTogglePlayback) {
      navigator.mediaSession.setActionHandler('play', handlers.onTogglePlayback);
      navigator.mediaSession.setActionHandler('pause', handlers.onTogglePlayback);
    }

    if (handlers.onPrevious) {
      navigator.mediaSession.setActionHandler('previoustrack', handlers.onPrevious);
    }

    if (handlers.onNext) {
      navigator.mediaSession.setActionHandler('nexttrack', handlers.onNext);
    }

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (!audio || !Number.isFinite(details.seekTime)) return;
      audio.currentTime = Math.max(0, Math.min(audio.duration || details.seekTime, details.seekTime));
    });

    updateMediaSessionPosition(audio);
  } catch (_) {
    // Media Session is best-effort and should never block playback.
  }
}

/**
 * 更新 Media Session 播放位置
 * @param {HTMLAudioElement} audio - 音频元素
 */
export function updateMediaSessionPosition(audio) {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.max(0, Math.min(audio.currentTime || 0, audio.duration))
    });
  } catch (_) {
    // Ignore invalid transient duration/position values.
  }
}

/**
 * 渲染队列行
 * @param {Object} track - 轨道对象
 * @param {string} origin - 队列来源
 * @param {number} index - 队列索引
 * @param {boolean} readonly - 是否只读
 * @param {Object} currentTrack - 当前播放轨道
 * @param {string} currentOrigin - 当前播放来源
 * @returns {string} HTML 字符串
 */
export function renderQueueRow(track, origin, index, readonly, currentTrack, currentOrigin) {
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));
  const escapeAttr = window.AdminApp?.utils?.escapeAttr || ((s) => String(s || ''));

  const isLocal = PlaybackUtils.isLocalTrack(track);
  const needsFile = isLocal && !track.objectUrl;
  const fileMissing = isLocal && track.fileMissing;
  const meta = `${PlaybackUtils.formatTrackMeta(track)}${fileMissing ? ' · 文件已移动，请重新选择' : (needsFile ? ' · 需重新选择文件' : '')}`;
  const isActive = origin === currentOrigin && currentTrack && track.id === currentTrack.id;

  return `
    <div class="queue-row playback-queue-row${isActive ? ' active' : ''}">
      <div class="playback-row-main">
        ${PlaybackUtils.renderArtwork(track)}
        <div>
          <div class="song">${escapeHtml(track.title)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </div>
      </div>
      ${readonly ? '' : `
        <div class="queue-actions">
          <button type="button" data-playback-queue="${escapeAttr(origin)}" data-playback-index="${index}">播放</button>
        </div>
      `}
    </div>
  `;
}

/**
 * 渲染歌单行（带当前播放标记）
 * @param {Object} track - 轨道对象
 * @param {number} index - 歌单索引
 * @param {boolean} isCurrent - 是否为当前播放
 * @param {boolean} isPast - 是否已播放过
 * @returns {string} HTML 字符串
 */
export function renderPlaylistRow(track, index, isCurrent, isPast) {
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

  const isLocal = PlaybackUtils.isLocalTrack(track);
  const needsFile = isLocal && !track.objectUrl;
  const fileMissing = isLocal && track.fileMissing;
  const meta = `${PlaybackUtils.formatTrackMeta(track)}${fileMissing ? ' · 文件已移动，请重新选择' : (needsFile ? ' · 需重新选择文件' : '')}`;
  const stateClass = isCurrent ? ' playlist-current' : (isPast ? ' playlist-past' : '');
  const btnLabel = isCurrent ? '重播' : '播放';

  return `
    <div class="queue-row playback-queue-row${stateClass}">
      <div class="playback-row-main">
        ${PlaybackUtils.renderArtwork(track)}
        <div>
          <div class="song">${isCurrent ? '<span class="playlist-now-icon" aria-hidden="true">▶</span> ' : ''}${escapeHtml(track.title)}</div>
          <div class="meta">${escapeHtml(meta)}</div>
        </div>
      </div>
      <div class="queue-actions">
        <button type="button" data-playback-playlist-jump="${index}">${btnLabel}</button>
      </div>
    </div>
  `;
}

/**
 * 渲染待确认点歌行
 * @param {Object} item - 待确认点歌项
 * @param {number} index - 索引
 * @returns {string} HTML 字符串
 */
export function renderPendingRow(item, index) {
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

  const track = item.track || {};
  const reasons = Array.isArray(item.reasons) ? item.reasons.join('；') : '';

  return `
    <div class="queue-row playback-queue-row pending">
      <div>
        <div class="song">${escapeHtml(item.songName || track.title || '')}</div>
        <div class="meta">${escapeHtml(`候选：${track.title || ''} · ${PlaybackUtils.formatTrackMeta(track)} · ${item.score || 0} 分 · ${reasons || '无命中原因'}`)}</div>
      </div>
      <div class="queue-actions">
        <button type="button" data-playback-pending-action="confirm" data-playback-pending-index="${index}">确认</button>
        <button type="button" data-playback-pending-action="ignore" data-playback-pending-index="${index}">忽略</button>
      </div>
    </div>
  `;
}

/**
 * 渲染推荐/搜索结果的轨道行
 * @param {Object} track - 轨道对象
 * @param {number} index - 索引
 * @param {string} context - 上下文 ('home' 或 'search')
 * @param {string} action - 当前 action（用于判断是否显示电台按钮）
 * @returns {string} HTML 字符串
 */
export function renderHomeTrackRow(track, index, context, action = '') {
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));
  const dataPrefix = context === 'search' ? 'playback-search' : 'playback-home-track';
  const showRadioButton = action === 'radio';

  return `
    <div class="queue-row playback-home-row">
      <div class="playback-row-main">
        ${PlaybackUtils.renderArtwork(track)}
        <div>
          <div class="song">${escapeHtml(track.title || '')}</div>
          <div class="meta">${escapeHtml(PlaybackUtils.formatTrackMeta(track))}</div>
        </div>
      </div>
      <div class="queue-actions">
        <button type="button" data-${dataPrefix}-action="normal" data-${dataPrefix}-index="${index}" title="添加到播放队列末尾">入队</button>
        ${showRadioButton
          ? `<button type="button" data-${dataPrefix}-action="radio" data-${dataPrefix}-index="${index}" title="切换到电台队列并播放">电台</button>`
          : `<button type="button" data-${dataPrefix}-action="requested" data-${dataPrefix}-index="${index}" title="插入到当前播放歌曲之后">插队</button>`
        }
        <button type="button" data-${dataPrefix}-action="play" data-${dataPrefix}-index="${index}" title="立即播放这首歌">播放</button>
      </div>
    </div>
  `;
}

/**
 * 渲染歌单卡片
 * @param {Object} playlist - 歌单对象
 * @param {number} index - 索引
 * @returns {string} HTML 字符串
 */
export function renderPlaylistCard(playlist, index) {
  const escapeHtml = window.AdminApp?.utils?.escapeHtml || ((s) => String(s || ''));

  return `
    <div class="playback-drawer-playlist-card" data-playback-playlist-index="${index}">
      ${PlaybackUtils.renderArtwork(playlist, { fallback: '单' })}
      <div style="flex:1 1 auto;min-width:0;">
        <div class="song" style="font-size:14px;font-weight:700;">${escapeHtml(playlist.title || '')}</div>
        <div class="meta">${escapeHtml(PlaybackUtils.formatPlaylistMeta(playlist))}</div>
      </div>
      <span class="playlist-card-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;display:block;"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>
  `;
}
