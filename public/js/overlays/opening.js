'use strict';

const DEFAULTS = Object.freeze({
  enabled: true,
  title: '今晚唱给你听',
  subtitle: '开播准备中',
  name: '主播名',
  footer: 'SINGING LIVE',
  quality: 'normal',
  showNotes: true,
  showEq: true,
  audio: 'none',
  debug: false
});

const MAX_LENGTHS = Object.freeze({ title: 40, subtitle: 40, name: 32, footer: 48 });
const QUALITY_LIMITS = Object.freeze({
  high: Object.freeze({ notes: 6, particles: 24, eq: 16 }),
  normal: Object.freeze({ notes: 4, particles: 12, eq: 10 }),
  low: Object.freeze({ notes: 0, particles: 0, eq: 0 })
});
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/gu;
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬', '♪', '♫'];
const NOTE_DURATIONS = [7, 9, 11, 13];

function cleanText(value, maxLength) {
  return Array.from(String(value ?? '').replace(CONTROL_CHARS, '').trim())
    .slice(0, maxLength).join('');
}

function parseBoolean(value, fallback) {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

function parseConfig(search = typeof location === 'undefined' ? '' : location.search) {
  const params = new URLSearchParams(search);
  const quality = params.get('quality');
  const audio = params.get('audio');
  const title = cleanText(params.get('title'), MAX_LENGTHS.title);
  const subtitle = cleanText(params.get('subtitle'), MAX_LENGTHS.subtitle);
  const name = cleanText(params.get('name'), MAX_LENGTHS.name);
  const footer = cleanText(params.get('footer'), MAX_LENGTHS.footer);
  return {
    enabled: parseBoolean(params.get('enabled'), DEFAULTS.enabled),
    title: title || DEFAULTS.title,
    subtitle: subtitle || DEFAULTS.subtitle,
    name: name || DEFAULTS.name,
    footer: footer || DEFAULTS.footer,
    quality: Object.hasOwn(QUALITY_LIMITS, quality) ? quality : DEFAULTS.quality,
    showNotes: parseBoolean(params.get('showNotes'), DEFAULTS.showNotes),
    showEq: parseBoolean(params.get('showEq'), DEFAULTS.showEq),
    audio: audio === 'browser' ? 'browser' : DEFAULTS.audio,
    debug: parseBoolean(params.get('debug'), DEFAULTS.debug)
  };
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
    note.style.setProperty('--note-duration', `${NOTE_DURATIONS[index % NOTE_DURATIONS.length]}s`);
    note.style.setProperty('--note-drift', `${index % 2 ? -16 : 16}px`);
    note.style.setProperty('--note-rotation', `${index % 2 ? -8 : 8}deg`);
    notes?.append(note);
  }

  for (let index = 0; index < limits.particles; index += 1) {
    const particle = document.createElement('span');
    particle.style.setProperty('--particle-x', `${8 + ((index * 29) % 84)}%`);
    particle.style.setProperty('--particle-y', `${12 + ((index * 31) % 72)}%`);
    particle.style.setProperty('--particle-size', `${2 + (index % 3)}px`);
    particle.style.setProperty('--particle-delay', `${-(index % 9)}s`);
    particle.style.setProperty('--particle-duration', `${6 + (index % 5)}s`);
    particles?.append(particle);
  }

  for (let index = 0; index < limits.eq; index += 1) {
    const bar = document.createElement('span');
    bar.style.setProperty('--eq-height', `${0.2 + ((index * 13) % 7) / 10}`);
    eq?.append(bar);
  }
}

function updateEq(eq) {
  if (!eq) return;
  eq.querySelectorAll('span').forEach((bar, index) => {
    const height = 0.16 + (((Date.now() / 1000 + index * 1.7) % 7) / 10);
    bar.style.setProperty('--eq-height', String(Math.min(.9, height)));
  });
}

function startRuntime(config) {
  const stage = document.getElementById('openingStage');
  const eq = document.getElementById('openingEq');
  const audio = document.getElementById('openingAudio');
  const debug = document.getElementById('openingDebug');
  if (!stage) return;

  let eqTimer = null;
  let particleTimer = null;
  let lastPhase = 0;

  const clearSchedulers = () => {
    if (eqTimer) clearTimeout(eqTimer);
    if (particleTimer) clearTimeout(particleTimer);
    eqTimer = null;
    particleTimer = null;
  };
  const scheduleEq = () => {
    if (!config.showEq || config.quality === 'low' || document.hidden || !stage.isConnected) return;
    updateEq(eq);
    const pause = Math.random() > .7 ? 1500 + Math.random() * 1500 : 600 + Math.random() * 600;
    eqTimer = setTimeout(scheduleEq, pause);
  };
  const scheduleParticles = () => {
    if (config.quality === 'low' || document.hidden || !stage.isConnected) return;
    stage.style.setProperty('--particle-phase', `${lastPhase += 1}`);
    particleTimer = setTimeout(scheduleParticles, 2400 + Math.random() * 2200);
  };
  const pause = () => {
    clearSchedulers();
    stage.classList.add('is-paused');
    lastPhase = performance.now();
  };
  const resume = () => {
    stage.classList.remove('is-paused');
    if (!stage.classList.contains('is-disabled')) {
      scheduleEq();
      scheduleParticles();
    }
  };

  if (config.enabled) {
    scheduleEq();
    scheduleParticles();
  } else {
    stage.classList.add('is-disabled');
    clearSchedulers();
  }

  if (config.audio === 'browser' && config.enabled && audio) {
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
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });

  const reducedMotion = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const updateReducedMotion = () => stage.classList.toggle('is-reduced-motion', Boolean(reducedMotion?.matches));
  updateReducedMotion();
  reducedMotion?.addEventListener?.('change', updateReducedMotion);
}

function initOpeningOverlay() {
  const config = parseConfig();
  setText('openingTitle', config.title);
  setText('openingSubtitle', config.subtitle);
  setText('openingName', config.name);
  setText('openingFooter', config.footer);
  const stage = document.getElementById('openingStage');
  stage?.classList.add(`quality-${config.quality}`);
  stage?.classList.toggle('show-notes', config.showNotes);
  stage?.classList.toggle('show-eq', config.showEq);
  stage?.classList.toggle('is-disabled', !config.enabled);
  document.documentElement.classList.toggle('opening-disabled', !config.enabled);
  document.body.classList.toggle('opening-disabled', !config.enabled);
  createNodes(config);
  startRuntime(config);
}

if (typeof document !== 'undefined') initOpeningOverlay();

export { DEFAULTS, MAX_LENGTHS, QUALITY_LIMITS, cleanText, parseConfig };
