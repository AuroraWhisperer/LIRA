'use strict';

let lyricState = {
  trackTitle: '',
  artists: [],
  lineText: '',
  translation: '',
  words: [],
  currentMs: 0,
  progress: 0,
  playing: false,
  locked: false
};

document.addEventListener('DOMContentLoaded', () => {
  renderLyricState();
  if (window.musicAPI && typeof window.musicAPI.onLyricState === 'function') {
    window.musicAPI.onLyricState((state) => {
      lyricState = {
        ...lyricState,
        ...(state || {})
      };
      renderLyricState();
    });
  }
});

function renderLyricState() {
  const line = document.getElementById('lyricLine');
  const translation = document.getElementById('lyricTranslation');
  const meta = document.getElementById('lyricMeta');
  const progress = document.getElementById('lyricProgress');

  const fallbackLine = lyricState.trackTitle || '暂无歌词';
  if (line) {
    if (Array.isArray(lyricState.words) && lyricState.words.length > 0) {
      line.innerHTML = lyricState.words.map((word) => {
        const active = Number(word.endMs || word.startMs || 0) <= Number(lyricState.currentMs || 0);
        return `<span class="${active ? 'is-active' : ''}">${escapeHtml(word.text || '')}</span>`;
      }).join('');
    } else {
      line.textContent = lyricState.lineText || fallbackLine;
    }
  }
  if (translation) {
    translation.textContent = lyricState.translation || '';
    translation.hidden = !lyricState.translation;
  }
  if (meta) {
    const artists = Array.isArray(lyricState.artists) ? lyricState.artists.filter(Boolean).join(' / ') : '';
    meta.textContent = artists
      ? `${lyricState.trackTitle || '当前歌曲'} - ${artists}`
      : lyricState.trackTitle || '播放助手';
  }
  if (progress) {
    const percent = Math.max(0, Math.min(100, Number(lyricState.progress || 0) * 100));
    progress.style.width = `${percent}%`;
  }

  document.body.classList.toggle('is-playing', lyricState.playing === true);
  document.body.classList.toggle('is-locked', lyricState.locked === true);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
