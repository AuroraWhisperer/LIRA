import { canAddTrackToPlaylist } from '../utils.js';

export function renderTrackMenu(track, index, action = '') {
  const menuId = `playback-home-track-menu-${index}`;
  const canRemove = action === 'liked' || action === 'playlist-tracks';

  return `
    <div class="track-menu-wrapper">
      <button type="button" class="track-menu-btn" data-playback-home-track-menu-index="${index}" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}">
        <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75"/>
          <circle cx="12" cy="12" r="1.75"/>
          <circle cx="19" cy="12" r="1.75"/>
        </svg>
      </button>
      <div class="track-menu" id="${menuId}" data-playback-home-track-menu-for="${index}" role="menu" aria-label="歌曲操作" hidden>
        <button type="button" role="menuitem" data-playback-home-track-action="normal" data-playback-home-track-index="${index}">入队</button>
        ${action === 'radio'
          ? `<button type="button" role="menuitem" data-playback-home-track-action="radio" data-playback-home-track-index="${index}" title="切换到电台队列并播放">电台</button>`
          : `<button type="button" role="menuitem" data-playback-home-track-action="requested" data-playback-home-track-index="${index}">插队</button>`}
        <button type="button" role="menuitem" data-playback-home-track-action="play" data-playback-home-track-index="${index}" title="从这首开始播放整个列表，替换当前播放队列">播放</button>
        ${canAddTrackToPlaylist(track) && !canRemove
          ? `<button type="button" role="menuitem" data-playback-home-track-action="add-to-playlist" data-playback-home-track-index="${index}">添加到歌单</button>`
          : ''}
        ${canRemove
          ? `<button type="button" role="menuitem" data-playback-home-track-action="remove" data-playback-home-track-index="${index}" class="danger">删除</button>`
          : ''}
      </div>
    </div>
  `;
}
