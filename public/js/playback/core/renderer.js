// 编写人：Aurora
// 渲染协调模块
'use strict';

import * as PlaybackUtils from '../utils.js';
import * as PlaybackComponents from '../ui/components.js';

export function createRenderer(deps) {
  const {
    uiRenderer,
    playbackState,
    getPlaybackAudio,
    searchService,
    homeService,
    escapeHtml
  } = deps;

  function renderPlayback(playbackAuthState, playbackProviderHealth) {
    console.log('[Playback] renderPlayback called, selectedSource:', playbackState.selectedSource);
    const audio = getPlaybackAudio();

    // 使用 UI 渲染器渲染所有界面
    uiRenderer.renderAll(playbackState, audio);

    // 渲染音乐源状态
    console.log('[Playback] Calling renderProviderState with:', playbackState.selectedSource);
    uiRenderer.renderProviderState(
      playbackAuthState,
      playbackProviderHealth,
      playbackState.selectedSource
    );

    // 更新"添加到歌单"按钮状态
    const addToPlaylistBtn = document.getElementById('playbackAddToPlaylistBtn');
    if (addToPlaylistBtn) {
      const track = playbackState.current;
      const canAdd = canAddTrackToPlaylist(track);
      addToPlaylistBtn.disabled = !canAdd;
      addToPlaylistBtn.title = canAdd ? `添加到${track.source === 'netease' ? '网易云音乐' : 'QQ 音乐'}歌单` : '当前歌曲无法添加到歌单';
    }

    // 渲染搜索结果和待确认弹窗
    renderPlaybackSearchResults();
    renderPendingConfirmPopup();

    // 同步进度条显示
    renderPlaybackProgress();
  }

  function canAddTrackToPlaylist(track) {
    if (!track) return false;
    if (track.source === 'qq') return Number(track.sourceSongId) > 0;
    if (track.source === 'netease') return /^\d+$/.test(String(track.sourceTrackId || '').replace(/^netease:/, ''));
    return false;
  }

  function renderPlaybackSearchResults() {
    const resultNode = document.getElementById('playbackSearchResults');
    if (!resultNode) return;

    const searchResults = searchService.getResults();
    if (!searchResults.length) {
      resultNode.innerHTML = playbackState.selectedSource === 'netease'
        ? '输入关键词后可搜索网易云音乐。'
        : '输入关键词后可搜索 QQ 音乐。';
      return;
    }

    resultNode.innerHTML = searchResults.map((track, index) => `
      <div class="queue-row playback-search-row">
        <div class="playback-row-main">
          ${PlaybackUtils.renderArtwork(track)}
          <div>
            <div class="song">${escapeHtml(track.title || '')}</div>
            <div class="meta">${escapeHtml(PlaybackUtils.formatTrackMeta(track))}</div>
          </div>
        </div>
        <div class="queue-actions">
          <button type="button" data-playback-search-action="normal" data-playback-search-index="${index}" title="添加到播放队列末尾">入队</button>
          <button type="button" data-playback-search-action="requested" data-playback-search-index="${index}" title="插入到当前播放歌曲之后">插队</button>
          <button type="button" data-playback-search-action="play" data-playback-search-index="${index}" title="立即播放这首歌">播放</button>
          ${canAddTrackToPlaylist(track)
            ? `<button type="button" data-playback-search-action="add-to-playlist" data-playback-search-index="${index}" title="添加到音乐歌单">歌单</button>`
            : ''}
        </div>
      </div>
    `).join('');
  }

  function renderPendingConfirmPopup() {
    const popup = document.getElementById('pendingConfirmPopup');
    if (!popup) return;

    const pending = playbackState.pendingRequests[0];
    if (!pending) {
      popup.classList.remove('visible');
      return;
    }

    const track = pending.track || {};
    const songName = document.getElementById('pendingConfirmSongName');
    const matchInfo = document.getElementById('pendingConfirmMatchInfo');
    const requester = document.getElementById('pendingConfirmRequester');
    const count = document.getElementById('pendingConfirmCount');

    if (songName) songName.textContent = pending.songName || track.title || '';
    if (matchInfo) {
      const reasons = Array.isArray(pending.reasons) ? pending.reasons.join('；') : '';
      matchInfo.textContent = `匹配：${track.title || ''} · ${PlaybackUtils.formatTrackMeta(track)} · ${pending.score || 0} 分${reasons ? ' · ' + reasons : ''}`;
    }
    if (requester) requester.textContent = `点歌人：${pending.requesterName || '观众'}`;
    if (count) count.textContent = playbackState.pendingRequests.length > 1 ? `+${playbackState.pendingRequests.length - 1}` : '';

    popup.classList.add('visible');
  }

  function renderPlaybackProgress() {
    const audio = getPlaybackAudio();
    const trackDurationMs = playbackState.current ? playbackState.current.durationMs : 0;
    uiRenderer.renderProgress(audio, playbackState.restoredTime, trackDurationMs);
    uiRenderer.updateMediaSessionPosition(audio);
  }

  function updatePlaybackMediaSession(togglePlayback, playbackPrevious, playbackNext) {
    const audio = getPlaybackAudio();
    uiRenderer.updateMediaSession(playbackState.current, audio, {
      onTogglePlayback: togglePlayback,
      onPrevious: playbackPrevious,
      onNext: () => playbackNext(false)
    });
  }

  function renderFullscreenPlayer() {
    const audio = getPlaybackAudio();
    uiRenderer.getFullscreenPlayer().render(playbackState.current, audio);
  }

  function renderPlaybackHomeResults(action = '', title = '') {
    const homeState = homeService.getHomeState();
    uiRenderer.getDrawer().renderContent(
      homeState.items,
      homeState.itemType,
      action,
      title,
      homeState.page
    );
  }

  function renderPlaybackMatchResults(data) {
    const resultNode = document.getElementById('playbackMatchResults');
    if (!resultNode) return;
    const results = data && Array.isArray(data.results) ? data.results.slice(0, 5) : [];
    if (!results.length) {
      resultNode.innerHTML = '没有找到候选歌曲。';
      return;
    }
    resultNode.innerHTML = results.map((item) => {
      const track = item.track || {};
      const reasons = Array.isArray(item.reasons) ? item.reasons.join('；') : '';
      return `
        <div class="match-result-row${item.autoAccept ? ' accepted' : ''}">
          <strong>${escapeHtml(track.title || '')}</strong>
          <span>${escapeHtml((track.artists || []).join(' / ') || '未知歌手')} · ${Number(item.score || 0)} 分 · ${item.autoAccept ? '可自动匹配' : '待确认'}</span>
          <small>${escapeHtml(reasons || '无命中原因')}</small>
        </div>
      `;
    }).join('');
  }

  return {
    renderPlayback,
    renderPlaybackSearchResults,
    renderPendingConfirmPopup,
    renderPlaybackProgress,
    updatePlaybackMediaSession,
    renderFullscreenPlayer,
    renderPlaybackHomeResults,
    renderPlaybackMatchResults
  };
}
