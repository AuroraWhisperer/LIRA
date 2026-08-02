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

let lyricSettings = {
  fontFamily: 'Microsoft YaHei',
  fontWeight: '700',
  textColor: '#ffffff',
  strokeColor: '#000000',
  fontSize: '36',
  strokeWidth: '2',
  opacity: '1',
  bgOpacity: '0',
  scale: '1',
  lineHeight: '1.3',
  shadowIntensity: '0.5',
  translationScale: '0.58'
};

let currentScale = 1;

document.addEventListener('DOMContentLoaded', () => {
  renderLyricState();
  loadSettings();
  setupWheelZoom();

  if (window.musicAPI && typeof window.musicAPI.onLyricState === 'function') {
    window.musicAPI.onLyricState((state) => {
      lyricState = {
        ...lyricState,
        ...(state || {})
      };
      renderLyricState();
    });
  }

  if (window.musicAPI && typeof window.musicAPI.onSettingsUpdate === 'function') {
    window.musicAPI.onSettingsUpdate((settings) => {
      if (settings) {
        updateSettings(settings);
      }
    });
  }
});

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.data) {
        updateSettings(data.data);
      }
    }
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }
}

function updateSettings(settings) {
  if (settings.desktopLyricFontFamily) lyricSettings.fontFamily = settings.desktopLyricFontFamily;
  if (settings.desktopLyricFontWeight) lyricSettings.fontWeight = settings.desktopLyricFontWeight;
  if (settings.desktopLyricTextColor) lyricSettings.textColor = settings.desktopLyricTextColor;
  if (settings.desktopLyricStrokeColor) lyricSettings.strokeColor = settings.desktopLyricStrokeColor;
  if (settings.desktopLyricFontSize) lyricSettings.fontSize = settings.desktopLyricFontSize;
  if (settings.desktopLyricStrokeWidth) lyricSettings.strokeWidth = settings.desktopLyricStrokeWidth;
  if (settings.desktopLyricOpacity) lyricSettings.opacity = settings.desktopLyricOpacity;
  if (settings.desktopLyricBgOpacity) lyricSettings.bgOpacity = settings.desktopLyricBgOpacity;
  if (settings.desktopLyricScale) {
    lyricSettings.scale = settings.desktopLyricScale;
    currentScale = parseFloat(settings.desktopLyricScale) || 1;
  }
  if (settings.desktopLyricLineHeight) lyricSettings.lineHeight = settings.desktopLyricLineHeight;
  if (settings.desktopLyricShadowIntensity) lyricSettings.shadowIntensity = settings.desktopLyricShadowIntensity;
  if (settings.desktopLyricTranslationScale) lyricSettings.translationScale = settings.desktopLyricTranslationScale;

  applyStyles();
}

function applyStyles() {
  const surface = document.querySelector('.lyric-window-surface');
  const line = document.getElementById('lyricLine');
  const translation = document.getElementById('lyricTranslation');

  if (!surface || !line || !translation) return;

  const fontSize = parseFloat(lyricSettings.fontSize) || 36;
  const strokeWidth = parseFloat(lyricSettings.strokeWidth) || 2;
  const opacity = parseFloat(lyricSettings.opacity) || 1;
  const bgOpacity = parseFloat(lyricSettings.bgOpacity) || 0;
  const lineHeight = parseFloat(lyricSettings.lineHeight) || 1.3;
  const shadowIntensity = parseFloat(lyricSettings.shadowIntensity) || 0.5;
  const translationScale = parseFloat(lyricSettings.translationScale) || 0.58;

  // 应用缩放
  surface.style.transform = `scale(${currentScale})`;
  surface.style.transformOrigin = 'center center';

  // 应用背景透明度
  if (bgOpacity > 0) {
    surface.style.background = `rgba(0, 0, 0, ${bgOpacity})`;
    surface.style.backdropFilter = `blur(${bgOpacity * 10}px)`;
  } else {
    surface.style.background = 'transparent';
    surface.style.backdropFilter = 'none';
  }

  // 应用主歌词样式
  line.style.fontFamily = lyricSettings.fontFamily;
  line.style.fontWeight = lyricSettings.fontWeight;
  line.style.color = lyricSettings.textColor;
  line.style.fontSize = `${fontSize}px`;
  line.style.lineHeight = String(lineHeight);
  line.style.opacity = String(opacity);

  // 构建文字阴影
  const shadowBlur = shadowIntensity * 8;
  const shadowSpread = shadowIntensity * 16;
  let textShadow = '';

  if (strokeWidth > 0) {
    // 描边效果
    const steps = 8;
    const shadows = [];
    for (let i = 0; i < steps; i++) {
      const angle = (Math.PI * 2 * i) / steps;
      const x = Math.cos(angle) * strokeWidth;
      const y = Math.sin(angle) * strokeWidth;
      shadows.push(`${x}px ${y}px 0 ${lyricSettings.strokeColor}`);
    }
    textShadow = shadows.join(', ');
  }

  if (shadowIntensity > 0) {
    const glowShadow = `0 0 ${shadowBlur}px rgba(0, 0, 0, ${shadowIntensity}), 0 0 ${shadowSpread}px rgba(0, 0, 0, ${shadowIntensity * 0.5})`;
    textShadow = textShadow ? `${textShadow}, ${glowShadow}` : glowShadow;
  }

  line.style.textShadow = textShadow;

  // 应用翻译样式
  translation.style.fontFamily = lyricSettings.fontFamily;
  translation.style.fontWeight = lyricSettings.fontWeight;
  translation.style.color = lyricSettings.textColor;
  translation.style.fontSize = `${fontSize * translationScale}px`;
  translation.style.lineHeight = String(lineHeight);
  translation.style.opacity = String(opacity * 0.78);
  translation.style.textShadow = textShadow;
}

function setupWheelZoom() {
  const surface = document.querySelector('.lyric-window-surface');
  if (!surface) return;

  surface.addEventListener('wheel', (event) => {
    // 只在未锁定且按住 Ctrl 键时允许缩放
    if (lyricState.locked) return;
    if (!event.ctrlKey) return;

    event.preventDefault();

    // 滚轮向上放大，向下缩小
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    currentScale = Math.max(0.5, Math.min(2, currentScale + delta));

    surface.style.transform = `scale(${currentScale})`;
    surface.style.transformOrigin = 'center center';
  }, { passive: false });
}

function renderLyricState() {
  const line = document.getElementById('lyricLine');
  const translation = document.getElementById('lyricTranslation');

  const fallbackLine = '暂无歌词';
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
