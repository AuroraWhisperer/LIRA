'use strict';

const DEFAULTS = Object.freeze({
  enabled: false,
  title: '唱一首，在一首，给你的歌',
  subtitle: '开播准备中',
  name: '',
  footer: '欢迎来到直播间',
  quality: 'normal',
  trackMotion: 'heart',
  showNotes: true,
  showEq: true,
  audio: 'browser',
  volume: 0.35,
  audioUrl: '',
  audioName: '',
  characterUrl: '',
  debug: false,
});

const MAX_LENGTHS = Object.freeze({
  title: 20,
  subtitle: 40,
  name: 32,
  footer: 48,
});
const QUALITY_LIMITS = Object.freeze({
  high: Object.freeze({ notes: 6, particles: 24, eq: 16 }),
  normal: Object.freeze({ notes: 4, particles: 12, eq: 10 }),
  low: Object.freeze({ notes: 0, particles: 0, eq: 0 }),
});
const TRACK_MOTION_VALUES = new Set(['heart', 'barber', 'progress']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/gu;
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬', '♪', '♫'];
const NOTE_DURATIONS = [7, 9, 11, 13];

function cleanText(value, maxLength) {
  return Array.from(
    String(value ?? '')
      .replace(CONTROL_CHARS, '')
      .trim(),
  )
    .slice(0, maxLength)
    .join('');
}

function parseBoolean(value, fallback) {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function parseVolume(value, fallback = DEFAULTS.volume) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function normalizeFooter(value) {
  const footer = cleanText(value, MAX_LENGTHS.footer);
  return footer && footer !== 'SINGING LIVE' ? footer : DEFAULTS.footer;
}

function normalizeTrackMotion(value) {
  const candidate = String(value ?? '').trim();
  return TRACK_MOTION_VALUES.has(candidate) ? candidate : DEFAULTS.trackMotion;
}

function parseConfig(
  search = typeof location === 'undefined' ? '' : location.search,
) {
  const params = new URLSearchParams(search);
  const quality = params.get('quality');
  const audio = params.get('audio');
  const title = cleanText(params.get('title'), MAX_LENGTHS.title);
  const subtitle = cleanText(params.get('subtitle'), MAX_LENGTHS.subtitle);
  const name = cleanText(params.get('name'), MAX_LENGTHS.name);
  return {
    enabled: parseBoolean(params.get('enabled'), DEFAULTS.enabled),
    title: title || DEFAULTS.title,
    subtitle: subtitle || DEFAULTS.subtitle,
    name,
    footer: normalizeFooter(params.get('footer')),
    quality: Object.hasOwn(QUALITY_LIMITS, quality)
      ? quality
      : DEFAULTS.quality,
    trackMotion: normalizeTrackMotion(params.get('trackMotion')),
    showNotes: parseBoolean(params.get('showNotes'), DEFAULTS.showNotes),
    showEq: parseBoolean(params.get('showEq'), DEFAULTS.showEq),
    audio: audio === 'browser' || audio === 'none' ? audio : DEFAULTS.audio,
    volume: parseVolume(params.get('volume'), DEFAULTS.volume),
    audioUrl: DEFAULTS.audioUrl,
    audioName: DEFAULTS.audioName,
    debug: parseBoolean(params.get('debug'), DEFAULTS.debug),
  };
}

function titleSizeForLength(length) {
  const safeLength = Math.max(1, Number(length) || 1);
  return Math.max(0.92, Math.min(5.4, 39 / Math.max(safeLength, 7)));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function createNodes(config) {
  const notes = document.getElementById('openingNotes');
  const particles = document.getElementById('openingParticles');
  const eq = document.getElementById('openingEq');
  notes?.replaceChildren();
  particles?.replaceChildren();
  eq?.replaceChildren();
  const limits = QUALITY_LIMITS[config.quality];

  for (let index = 0; index < limits.notes; index += 1) {
    const note = document.createElement('span');
    note.textContent = NOTE_GLYPHS[index % NOTE_GLYPHS.length];
    note.style.setProperty('--note-x', `${16 + ((index * 17) % 72)}%`);
    note.style.setProperty('--note-y', `${18 + ((index * 23) % 57)}%`);
    note.style.setProperty('--note-delay', `${-(index * 1.1)}s`);
    note.style.setProperty(
      '--note-duration',
      `${NOTE_DURATIONS[index % NOTE_DURATIONS.length]}s`,
    );
    note.style.setProperty('--note-drift', `${index % 2 ? -0.83 : 0.83}cqw`);
    note.style.setProperty('--note-rotation', `${index % 2 ? -8 : 8}deg`);
    notes?.append(note);
  }

  for (let index = 0; index < limits.particles; index += 1) {
    const particle = document.createElement('span');
    particle.style.setProperty('--particle-x', `${8 + ((index * 29) % 84)}%`);
    particle.style.setProperty('--particle-y', `${12 + ((index * 31) % 72)}%`);
    particle.style.setProperty(
      '--particle-size',
      `${0.1 + (index % 3) * 0.05}cqw`,
    );
    particle.style.setProperty('--particle-delay', `${-(index % 9)}s`);
    particle.style.setProperty('--particle-duration', `${6 + (index % 5)}s`);
    particles?.append(particle);
  }

  for (let index = 0; index < limits.eq; index += 1) {
    const bar = document.createElement('span');
    bar.style.setProperty('--eq-height', `${0.2 + ((index * 13) % 7) / 10}`);
    bar.style.setProperty('--eq-duration', `${2.4 + (index % 5) * 0.34}s`);
    bar.style.setProperty('--eq-delay', `${-(index * 0.22)}s`);
    eq?.append(bar);
  }
}

function startRuntime(config) {
  const stage = document.getElementById('openingStage');
  const audio = document.getElementById('openingAudio');
  const debug = document.getElementById('openingDebug');
  const trackSvg = document.getElementById('openingTrackSvg');
  if (!stage) return;

  let particleTimer = null;
  let lastPhase = 0;

  const clearSchedulers = () => {
    if (particleTimer) clearTimeout(particleTimer);
    particleTimer = null;
  };
  const scheduleParticles = () => {
    if (config.quality === 'low' || document.hidden || !stage.isConnected)
      return;
    stage.style.setProperty('--particle-phase', `${(lastPhase += 1)}`);
    particleTimer = setTimeout(scheduleParticles, 2400 + Math.random() * 2200);
  };
  const pause = () => {
    clearSchedulers();
    stage.classList.add('is-paused');
    trackSvg?.pauseAnimations?.();
    lastPhase = performance.now();
  };
  const resume = () => {
    if (stage.classList.contains('is-disabled')) return;
    stage.classList.remove('is-paused');
    if (!stage.classList.contains('is-reduced-motion')) {
      trackSvg?.unpauseAnimations?.();
      scheduleParticles();
    }
  };

  if (config.enabled) {
    stage.classList.remove('is-disabled', 'is-paused');
    trackSvg?.setCurrentTime?.(0);
    scheduleParticles();
  } else {
    stage.classList.add('is-disabled', 'is-paused');
    trackSvg?.pauseAnimations?.();
    clearSchedulers();
  }

  const audioUrl = safeAudioUrl(config.audioUrl);
  if (config.audio === 'browser' && config.enabled && audio && audioUrl) {
    audio.src = audioUrl;
    audio.volume = parseVolume(config.volume);
    audio.load();
    audio.play().catch((error) => {
      console.warn('[opening-overlay] audio playback unavailable', error);
      if (config.debug && debug) {
        debug.hidden = false;
        debug.textContent = '网页音频未自动播放，画面已继续运行';
      }
    });
  } else if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute('src');
    audio.load();
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      event.data?.type !== 'lira:opening-preview-volume'
    )
      return;
    if (audio) audio.volume = parseVolume(event.data.volume, audio.volume);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  const reducedMotion =
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  const updateReducedMotion = () => {
    const shouldReduce = Boolean(reducedMotion?.matches);
    stage.classList.toggle('is-reduced-motion', shouldReduce);
    if (shouldReduce || config.quality === 'low') {
      clearSchedulers();
      trackSvg?.pauseAnimations?.();
    } else if (!document.hidden && config.enabled) {
      trackSvg?.unpauseAnimations?.();
      if (!particleTimer) scheduleParticles();
    }
  };
  updateReducedMotion();
  reducedMotion?.addEventListener?.('change', updateReducedMotion);
}

function safeAudioUrl(value) {
  const candidate = String(value || '');
  if (
    candidate === DEFAULTS.audioUrl ||
    candidate.startsWith('/opening-media/')
  )
    return candidate;
  return DEFAULTS.audioUrl;
}

function safeCharacterUrl(value) {
  const candidate = String(value || '');
  if (
    candidate === DEFAULTS.characterUrl ||
    candidate.startsWith('/opening-character/')
  )
    return candidate;
  return DEFAULTS.characterUrl;
}

function applyOpeningConfig(config) {
  setText('openingTitle', config.title);
  setText('openingSubtitle', config.subtitle);
  setText('openingName', config.name);
  setText('openingFooter', config.footer);
  const stage = document.getElementById('openingStage');
  const viewport = document.querySelector('.opening-viewport');
  const nameRow = document.getElementById('openingNameRow');
  const avatar = document.getElementById('openingAvatar');
  const titleLength = Array.from(config.title).length;
  stage?.style.setProperty(
    '--opening-title-size',
    `${titleSizeForLength(titleLength)}cqw`,
  );
  if (stage) stage.dataset.trackMotion = config.trackMotion;
  stage?.classList.add(`quality-${config.quality}`);
  stage?.classList.toggle('show-notes', config.showNotes);
  stage?.classList.toggle('show-eq', config.showEq);
  stage?.classList.toggle('is-disabled', !config.enabled);
  viewport?.classList.toggle('opening-disabled', !config.enabled);
  document.documentElement.classList.toggle(
    'opening-disabled',
    !config.enabled,
  );
  document.body.classList.toggle('opening-disabled', !config.enabled);
  if (nameRow) nameRow.hidden = config.name.length === 0;
  if (avatar) {
    const characterUrl = safeCharacterUrl(config.characterUrl);
    avatar.hidden = !characterUrl;
    if (characterUrl) avatar.src = characterUrl;
    else avatar.removeAttribute('src');
  }
  createNodes(config);
  startRuntime(config);
}

async function loadSavedConfig() {
  try {
    const response = await fetch('/api/opening/config', { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload && payload.ok && payload.data ? payload.data : null;
  } catch (_) {
    return null;
  }
}

function mergeConfig(remote, query) {
  const source = remote && typeof remote === 'object' ? remote : {};
  const params = new URLSearchParams(
    typeof location === 'undefined' ? '' : location.search,
  );
  const merged = { ...DEFAULTS, ...source, ...query };
  if (!params.has('enabled'))
    merged.enabled = Boolean(source.enabled ?? DEFAULTS.enabled);
  if (!params.has('title'))
    merged.title = cleanText(source.title, MAX_LENGTHS.title) || DEFAULTS.title;
  if (!params.has('subtitle'))
    merged.subtitle =
      cleanText(source.subtitle, MAX_LENGTHS.subtitle) || DEFAULTS.subtitle;
  if (!params.has('name'))
    merged.name = cleanText(source.name, MAX_LENGTHS.name);
  if (!params.has('footer')) merged.footer = normalizeFooter(source.footer);
  if (!params.has('quality'))
    merged.quality = Object.hasOwn(QUALITY_LIMITS, source.quality)
      ? source.quality
      : DEFAULTS.quality;
  merged.trackMotion = normalizeTrackMotion(
    params.has('trackMotion') ? query.trackMotion : source.trackMotion,
  );
  if (!params.has('showNotes')) merged.showNotes = source.showNotes !== false;
  if (!params.has('showEq')) merged.showEq = source.showEq !== false;
  if (!params.has('audio'))
    merged.audio = source.audio === 'none' ? 'none' : DEFAULTS.audio;
  if (!params.has('volume')) merged.volume = parseVolume(source.volume);
  merged.audioUrl = safeAudioUrl(source.audioUrl || DEFAULTS.audioUrl);
  merged.audioName = cleanText(source.audioName, 160) || DEFAULTS.audioName;
  merged.characterUrl = safeCharacterUrl(
    source.characterUrl || DEFAULTS.characterUrl,
  );
  return merged;
}

async function initOpeningOverlay() {
  const queryConfig = parseConfig();
  const remoteConfig = await loadSavedConfig();
  applyOpeningConfig(mergeConfig(remoteConfig, queryConfig));
}

if (typeof document !== 'undefined') initOpeningOverlay();

export {
  DEFAULTS,
  MAX_LENGTHS,
  QUALITY_LIMITS,
  TRACK_MOTION_VALUES,
  cleanText,
  normalizeFooter,
  normalizeTrackMotion,
  parseConfig,
  titleSizeForLength,
  parseVolume,
  safeAudioUrl,
  safeCharacterUrl,
  mergeConfig,
};
