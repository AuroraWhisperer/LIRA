import { resolveAdvancedLyricSettings } from '../shared/advanced-lyric-appearance.js';
import { ADVANCED_LYRIC_CATALOG } from '../shared/advanced-lyric-catalog.js';
import { parseHexColor } from '../shared/color-value.js';
import { createAdvancedLyricText, buildAdvancedLyricLayout } from './advanced-lyric-layouts.js';
import { advancedLyricKeyframes, createAdvancedLyricMotion } from './advanced-lyric-motion.js';
import { createLyricFontStack } from './desktop-lyric-styles.js';

const HEIGHT_BUDGET = { center: 46, duet: 29, offset: 25, split: 47, corners: 27, staircase: 22,
  diagonal: 22, vertical: 69, 'split-vertical': 69, emphasis: 21, initials: 51, 'outline-echo': 31,
  tiles: 20, ribbons: 20, speech: 27, postcard: 56, arc: 15, wave: 17, fan: 16, orbit: 15, bracket: 28, magazine: 23 };

function element(document, tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function rotateChoice(settings, enabledKey, sequenceKey, selectedKey, catalog, index) {
  if (!settings[enabledKey]) return settings[selectedKey];
  const selected = settings[sequenceKey].split(',').filter(Boolean);
  const choices = selected.length ? selected : ADVANCED_LYRIC_CATALOG[catalog].map(item => item.id);
  return choices[Math.max(0, index) % choices.length];
}

export function advancedLyricLineWindow(line, nextLine) {
  const startMs = Number(line?.startMs) || 0;
  const wordEnd = (line?.words || []).reduce((end, word) => Math.max(end, Number(word.endMs) || 0), startMs);
  const declaredEnd = Number(line?.endMs) || Number(nextLine?.startMs) || Math.max(startMs + 4000, wordEnd);
  const nextStart = Number(nextLine?.startMs) || declaredEnd;
  const endMs = wordEnd > startMs && nextStart - wordEnd > 2000
    ? Math.min(declaredEnd, wordEnd + 800) : declaredEnd;
  return { startMs, endMs: Math.max(startMs + 1, endMs) };
}

function withOpacity(color, opacity) {
  const { r, g, b, alpha } = parseHexColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha * opacity})`;
}

function mixColor(color, base, proportion) {
  const a = parseHexColor(color), b = parseHexColor(base);
  const alpha = a.alpha * proportion + b.alpha * (1 - proportion);
  const channels = ['r', 'g', 'b'].map(key => Math.round((a[key] * a.alpha * proportion + b[key] * b.alpha * (1 - proportion)) / alpha));
  return `rgba(${channels.join(', ')}, ${alpha})`;
}

function textShadow(settings) {
  const s = settings, shadows = [], strength = s.advancedLyricEffectStrength;
  if (s.advancedLyricStrokeEnabled && s.advancedLyricStrokeLayers > 1) {
    for (let layer = s.advancedLyricStrokeLayers - 1; layer > 0; layer--) {
      const radius = s.advancedLyricStrokeWidth + layer * 2;
      const color = layer === 1 ? s.advancedLyricAccentColor : s.advancedLyricSecondaryColor;
      for (let point = 0; point < 8; point++) {
        const angle = point * Math.PI / 4;
        shadows.push(`${(Math.cos(angle) * radius).toFixed(2)}px ${(Math.sin(angle) * radius).toFixed(2)}px 0 ${color}`);
      }
    }
  }
  if (s.advancedLyricEmbossEnabled) shadows.push('0 -0.025em 0 #ffffffa8', '0 0.035em 0 #00000090');
  if (s.advancedLyricChromaticEnabled) shadows.push(`${0.035 + strength * 0.055}em 0 0 ${s.advancedLyricAccentColor}`, `${-0.035 - strength * 0.055}em 0 0 ${s.advancedLyricSecondaryColor}`);
  if (s.advancedLyricExtrudeEnabled) {
    const layers = Math.round(3 + strength * 7);
    for (let index = 1; index <= layers; index++) shadows.push(`${index}px ${index}px 0 ${s.advancedLyricStrokeColor}`);
  }
  if (s.advancedLyricEchoEnabled) shadows.push(`0.12em 0.13em 0 ${withOpacity(s.advancedLyricAccentColor, 0.45)}`, `0.24em 0.26em 0 ${withOpacity(s.advancedLyricSecondaryColor, 0.25)}`);
  if (s.advancedLyricGlowEnabled || s.advancedLyricMaterial === 'neon') shadows.push(`0 0 ${0.12 + strength * 0.2}em ${s.advancedLyricAccentColor}`, `0 0 ${0.22 + strength * 0.3}em ${withOpacity(s.advancedLyricAccentColor, 0.5)}`);
  if (s.advancedLyricShadowEnabled) shadows.push(`0 0.055em ${0.08 + strength * 0.08}em #00000085`);
  return shadows.join(', ') || 'none';
}

export function createAdvancedLyricRenderer(root) {
  const document = root.ownerDocument || globalThis.document;
  const motion = createAdvancedLyricMotion();
  const position = element(document, 'div', 'advanced-lyric-position');
  const fit = element(document, 'div', 'advanced-lyric-fit');
  const art = element(document, 'div', 'advanced-lyric-art');
  art.setAttribute('aria-hidden', 'true');
  fit.append(art);
  position.append(fit);
  root.replaceChildren(position);
  root.classList.add('advanced-lyric-renderer');
  root.setAttribute('role', 'img');
  let settings = resolveAdvancedLyricSettings();
  let settingsSignature = '';
  let frame = null;
  let line = null;
  let nextLine = null;
  let lineIndex = -1;
  let trackTitle = '';
  let visible = !root.hidden;
  let disposed = false;
  let dirty = true;
  let items = [];
  let layout = 'center';
  let reducedMotion = false;
  let lineWindow = { startMs: 0, endMs: 1 };
  let currentUnits = [];
  let contentVisible = null;
  const media = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  reducedMotion = media?.matches === true;

  function applySurface() {
    const s = settings;
    root.style.fontFamily = createLyricFontStack(s.advancedLyricFontFamily);
    root.style.fontWeight = s.advancedLyricFontWeight;
    root.style.opacity = String(s.advancedLyricOpacity);
    root.style.setProperty('--advanced-text', s.advancedLyricTextColor);
    root.style.setProperty('--advanced-accent', s.advancedLyricAccentColor);
    root.style.setProperty('--advanced-secondary', s.advancedLyricSecondaryColor);
    for (const [tone, values] of Object.entries({ text: [35, 55, 75], accent: [24, 70, 77], secondary: [28, 45, 72] })) {
      const color = s[`advancedLyric${tone[0].toUpperCase()}${tone.slice(1)}Color`];
      for (const opacity of values) root.style.setProperty(`--advanced-${tone}-${opacity}`, withOpacity(color, opacity / 100));
    }
    root.style.setProperty('--advanced-postcard', mixColor(s.advancedLyricAccentColor, '#201c26', 0.24));
    root.style.setProperty('--advanced-fan', mixColor(s.advancedLyricAccentColor, '#211b28', 0.18));
    root.style.setProperty('--advanced-accent-ribbon', mixColor(s.advancedLyricAccentColor, '#14101b', 0.85));
    root.style.setProperty('--advanced-secondary-ribbon', mixColor(s.advancedLyricSecondaryColor, '#14101b', 0.85));
    root.style.setProperty('--advanced-stroke', s.advancedLyricStrokeColor);
    root.style.setProperty('--advanced-stroke-width', `${s.advancedLyricStrokeEnabled ? s.advancedLyricStrokeWidth : 0}px`);
    root.style.setProperty('--advanced-letter-spacing', `${s.advancedLyricLetterSpacing}em`);
    root.style.setProperty('--advanced-text-shadow', textShadow(s));
    root.dataset.material = s.advancedLyricMaterial;
    root.classList.toggle('is-hollow', s.advancedLyricHollowEnabled || s.advancedLyricMaterial === 'outline');
    position.style.left = `${s.advancedLyricPositionX}%`;
    position.style.top = `${s.advancedLyricPositionY}%`;
    position.style.width = `${s.advancedLyricWidth}%`;
    position.style.transform = `translate(-50%, -50%) rotate(${s.advancedLyricRotate}deg) scale(${s.advancedLyricScale})`;
  }

  function measure() {
    if (!visible || disposed || !items.length) return;
    const width = position.clientWidth, height = position.clientHeight;
    if (!width || !height) return;
    fit.style.transform = 'none';
    // First estimate all sizes, then read them in one batch. No frame-loop
    // measurement and no per-character measurement is needed.
    for (const entry of items) {
      const { item, node, text, units } = entry;
      const availableWidth = width * item.width / 100;
      const maxHeight = height * (item.translation ? 12 : item.maxHeight || HEIGHT_BUDGET[layout] || 30) / 100;
      const count = units.reduce((sum, unit) => sum + [...unit.text].reduce((length, ch) => length + (/\s/u.test(ch) ? 0.3 : /[\x20-\x7e]/u.test(ch) ? 0.58 : 1), 0), 0);
      const padding = item.plate ? 0.7 : 0;
      const requestedSize = settings.advancedLyricFontSize * item.size;
      const size = Math.max(3, item.vertical
        ? Math.min(requestedSize, maxHeight / Math.max(1, count + padding), availableWidth * 0.7)
        : Math.max(...[1, 2, 3].map(rows => Math.min(requestedSize,
          maxHeight / (rows * 1.2 + padding), availableWidth * rows / Math.max(1, count + padding)))));
      node.style.fontSize = `${size}px`;
      text.style.maxHeight = item.vertical ? `${maxHeight}px` : '';
      entry.size = size;
      entry.maxHeight = maxHeight;
      entry.availableWidth = availableWidth;
    }
    const corrections = items.map(entry => ({ entry, ratio: Math.min(1,
      entry.availableWidth / Math.max(1, entry.text.scrollWidth),
      entry.maxHeight / Math.max(1, entry.node.offsetHeight)) }));
    for (const { entry, ratio } of corrections) if (ratio < 0.99) entry.node.style.fontSize = `${Math.max(3, entry.size * ratio)}px`;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const { node, item } of items) {
      const radians = item.rotation * Math.PI / 180;
      const w = node.offsetWidth, h = node.offsetHeight;
      const halfWidth = (Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h) / 2;
      const halfHeight = (Math.abs(Math.sin(radians)) * w + Math.abs(Math.cos(radians)) * h) / 2;
      const x = width * item.x / 100, y = height * item.y / 100;
      left = Math.min(left, x - halfWidth); right = Math.max(right, x + halfWidth);
      top = Math.min(top, y - halfHeight); bottom = Math.max(bottom, y + halfHeight);
    }
    const scale = Math.min(1, width * 0.96 / Math.max(1, right - left), height * 0.94 / Math.max(1, bottom - top));
    const x = (left + right) / 2, y = (top + bottom) / 2;
    fit.style.transformOrigin = `${x}px ${y}px`;
    fit.style.transform = `translate(${width / 2 - x}px, ${height / 2 - y}px) scale(${scale})`;
  }

  function addDecoration(type) {
    if (type === 'none') return;
    const decoration = element(document, 'div', 'advanced-lyric-decoration');
    decoration.dataset.decoration = type;
    if (['stars', 'dots', 'corners'].includes(type)) {
      const count = type === 'corners' ? 4 : 8;
      for (let index = 0; index < count; index++) {
        const mark = element(document, 'i', 'advanced-lyric-mark');
        mark.style.setProperty('--mark-index', String(index));
        mark.style.left = `${[8, 89, 15, 82, 5, 94, 27, 73][index]}%`;
        mark.style.top = `${[16, 20, 73, 69, 45, 47, 9, 80][index]}%`;
        decoration.append(mark);
      }
    }
    art.append(decoration);
  }

  function build() {
    dirty = false;
    motion.clear();
    items = [];
    art.replaceChildren();
    if (!line?.text) { root.setAttribute('aria-label', '暂无歌词'); return; }
    const s = settings;
    layout = rotateChoice(s, 'advancedLyricRotateLayouts', 'advancedLyricLayoutSequence', 'advancedLyricLayout', 'layouts', lineIndex);
    const entrance = rotateChoice(s, 'advancedLyricRotateMotions', 'advancedLyricMotionSequence', 'advancedLyricEnter', 'enters', lineIndex);
    root.dataset.layout = layout;
    root.setAttribute('aria-label', line.text);
    const window = lineWindow;
    const duration = Math.min(s.advancedLyricMotionDuration, (window.endMs - window.startMs) * 0.3);
    const units = currentUnits;
    const sungEnd = Math.max(...units.map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd));
    const exitStart = Math.max(window.endMs - duration * 0.55, sungEnd);
    const plan = buildAdvancedLyricLayout(layout, units);
    if (s.advancedLyricShowTranslation && line.translation) {
      plan.push({ start: 0, end: 1, x: 50, y: 97, width: 85, size: 0.38, rotation: 0, source: 'translation', translation: true });
    }
    addDecoration(s.advancedLyricDecoration);
    const pendingMotion = [];
    plan.forEach((item, ordinal) => {
      const itemUnits = item.translation ? createAdvancedLyricText({ text: line.translation,
        startMs: Math.min(...units.map(unit => unit.startMs)), endMs: sungEnd }) : units.slice(item.start, item.end);
      const itemStart = Math.min(...itemUnits.map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart));
      const node = element(document, 'div', 'advanced-lyric-item');
      node.dataset.source = item.source;
      if (item.plate) node.dataset.plate = item.plate;
      if (item.tone) node.dataset.tone = item.tone;
      if (item.treatment) node.dataset.treatment = item.treatment;
      if (item.vertical) node.classList.add('is-vertical');
      node.style.left = `${item.x}%`; node.style.top = `${item.y}%`; node.style.width = `${item.width}%`;
      node.style.transform = `translate(-50%, -50%) rotate(${item.rotation}deg)`;
      node.style.textAlign = item.align || 'center';
      const enter = element(document, 'div', 'advanced-lyric-enter');
      const hold = element(document, 'div', 'advanced-lyric-hold');
      const exit = element(document, 'div', 'advanced-lyric-exit');
      const text = element(document, 'div', 'advanced-lyric-text');
      let wordRun = null;
      itemUnits.forEach((unit, index) => {
        const reveal = element(document, 'span', 'advanced-lyric-reveal');
        const glyph = element(document, 'span', 'advanced-lyric-glyph');
        glyph.dataset.text = unit.text;
        const ink = element(document, 'span', 'advanced-lyric-ink');
        ink.textContent = unit.text;
        glyph.append(ink);
        reveal.append(glyph);
        if (/^[A-Za-z0-9]+$/u.test(unit.text) && !item.vertical) {
          if (!wordRun) { wordRun = element(document, 'span', 'advanced-lyric-word-run'); text.append(wordRun); }
          wordRun.append(reveal);
        } else {
          wordRun = null;
          text.append(reveal);
        }
        const begin = unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart;
        const end = unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd;
        if (s.advancedLyricHideUnsung) {
          const revealDuration = Math.min(duration, 280, Math.max(80, (end - begin) * 0.7));
          if (unit.revealAsRun) {
            pendingMotion.push(() => motion.add(reveal,
              [{ clipPath: item.vertical ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
              { startMs: begin, endMs: end, easing: 'linear' }));
          } else if (reducedMotion) {
            pendingMotion.push(() => motion.add(reveal, [{ opacity: 0 }, { opacity: 1 }],
              { startMs: begin - 1, endMs: begin, easing: 'steps(1, end)' }));
          } else {
            pendingMotion.push(() => motion.add(reveal,
              advancedLyricKeyframes('enter', entrance, s.advancedLyricMotionAmount, item.start + index),
              { startMs: begin, endMs: begin + revealDuration }));
          }
        }
        if (item.source !== 'current' || item.decorative || s.advancedLyricWordMotion === 'none') return;
        const highlight = element(document, 'span', 'advanced-lyric-highlight');
        highlight.textContent = unit.text;
        glyph.append(highlight);
        pendingMotion.push(() => motion.add(highlight, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
          { startMs: begin, endMs: end, easing: 'linear' }));
        if (!reducedMotion) pendingMotion.push(() => motion.add(glyph,
          advancedLyricKeyframes('word', s.advancedLyricWordMotion, s.advancedLyricMotionAmount, index),
          { startMs: begin, endMs: Math.min(window.endMs, begin + Math.min(650, Math.max(220, end - begin + 120))), easing: 'ease-in-out' }));
      });
      exit.append(text); hold.append(exit); enter.append(hold); node.append(enter); art.append(node);
      items.push({ item, node, text, units: itemUnits });
      if (s.advancedLyricHideUnsung) pendingMotion.push(() => motion.add(enter, [{ opacity: 0 }, { opacity: 1 }],
        { startMs: itemStart - 1, endMs: itemStart, easing: 'steps(1, end)' }));
      if (!reducedMotion && !item.decorative) {
        const delay = Math.min(duration * 0.3, ordinal * 28);
        pendingMotion.push(() => {
          if (!s.advancedLyricHideUnsung) motion.add(enter, advancedLyricKeyframes('enter', entrance, s.advancedLyricMotionAmount, ordinal),
            { startMs: window.startMs + delay, endMs: window.startMs + duration, duration: Math.max(1, duration - delay) });
          motion.add(hold, advancedLyricKeyframes('hold', s.advancedLyricHold, s.advancedLyricMotionAmount, ordinal),
            { startMs: Math.max(window.startMs, itemStart) + duration, endMs: exitStart, duration: 2600 + ordinal * 80, loop: true, easing: 'ease-in-out' });
          if (exitStart < window.endMs) motion.add(exit, advancedLyricKeyframes('exit', s.advancedLyricExit, s.advancedLyricMotionAmount, ordinal),
            { startMs: exitStart, endMs: window.endMs, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' });
        });
      }
    });
    measure();
    pendingMotion.forEach(add => add());
  }

  function renderFrame(value) {
    if (disposed) return;
    frame = value;
    if (line !== value.line || nextLine !== value.nextLine || lineIndex !== value.index || trackTitle !== value.trackTitle) {
      line = value.line; nextLine = value.nextLine; lineIndex = value.index; trackTitle = value.trackTitle;
      lineWindow = advancedLyricLineWindow(line, nextLine);
      currentUnits = createAdvancedLyricText(line ? { ...line, endMs: Number(line.endMs) || lineWindow.endMs } : null);
      dirty = true;
    }
    if (!visible) return;
    if (dirty) build();
    const { startMs, endMs } = lineWindow;
    const hasContent = Boolean(line?.text) && value.currentMs >= startMs && value.currentMs < endMs;
    if (contentVisible !== hasContent) {
      contentVisible = hasContent;
      art.style.visibility = hasContent ? 'visible' : 'hidden';
      if (!hasContent) motion.suspend();
    }
    if (hasContent) motion.sync(value);
  }

  function applySettings(raw) {
    if (disposed) return;
    const next = resolveAdvancedLyricSettings(raw);
    // Visibility belongs to the host. A disabled output can still be edited in
    // its dedicated preview, and toggling output must not reconstruct glyphs.
    const { desktopLyricEnabled, advancedLyricEnabled, ...appearance } = next;
    const signature = JSON.stringify(appearance);
    if (signature === settingsSignature) return;
    const structural = ['Layout', 'HideUnsung', 'ShowTranslation', 'FontFamily', 'FontWeight', 'FontSize', 'LetterSpacing',
      'Enter', 'Hold', 'Exit', 'WordMotion', 'MotionDuration', 'MotionAmount', 'RotateLayouts', 'LayoutSequence',
      'RotateMotions', 'MotionSequence', 'Decoration'];
    const rebuild = structural.some(key => settings[`advancedLyric${key}`] !== next[`advancedLyric${key}`]);
    const remeasure = settings.advancedLyricWidth !== next.advancedLyricWidth
      || (settings.advancedLyricMaterial === 'marker') !== (next.advancedLyricMaterial === 'marker');
    settings = next; settingsSignature = signature;
    dirty ||= rebuild;
    applySurface();
    if (visible && frame) renderFrame(frame);
    if (visible && remeasure && !rebuild) measure();
  }

  function setVisible(value) {
    if (disposed || visible === Boolean(value)) return;
    visible = Boolean(value);
    root.hidden = !visible;
    if (!visible) {
      motion.suspend();
      resizeObserver?.disconnect();
    } else {
      resizeObserver?.observe(root);
      const rebuilding = frame !== null && dirty;
      if (frame) renderFrame({ ...frame, discontinuity: true });
      if (!rebuilding) measure();
    }
  }

  const onFontLoad = () => { if (visible) measure(); };
  const onMotionPreference = event => {
    reducedMotion = event.matches;
    dirty = true;
    if (visible && frame) renderFrame(frame);
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  if (visible) resizeObserver?.observe(root);
  document.fonts?.addEventListener?.('loadingdone', onFontLoad);
  media?.addEventListener?.('change', onMotionPreference);
  applySurface();

  return { applySettings, renderFrame, setVisible,
    dispose() {
      if (disposed) return;
      disposed = true;
      motion.clear();
      resizeObserver?.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', onFontLoad);
      media?.removeEventListener?.('change', onMotionPreference);
      root.replaceChildren();
      items = []; frame = null; line = null; nextLine = null;
    },
  };
}
