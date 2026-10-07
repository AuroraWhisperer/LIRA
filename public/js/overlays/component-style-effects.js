import { STYLE_PARAMETER_CAPABILITIES, styleParametersFor } from '../shared/component-style-parameters.js';
import { componentEffectProfiles, createEffectFilters, effectColor, effectTransform } from './component-effect-filters.js';

const CLOCK_TEXT = '.clock-time > span, .clock-flip-value, .clock-flip-half > span, .clock-date-row > span, .clock-label, .clock-period, .clock-year';
const DANMAKU_TEXT = '.draw-danmaku-identity strong, .draw-danmaku-body > p, .draw-danmaku-gift-copy, .moonlit-guard-name, .moonlit-guard-title, .moonlit-guard-action, .sc-name, .sc-copy, .sc-money';
const SURFACES = {
  ranked: '.draw-danmaku-body > p', cream: '.draw-danmaku-body',
  glow: '.draw-danmaku-body > p', starveil: '.draw-danmaku-body > p, .draw-danmaku-gift-copy',
  whiteframe: '.draw-danmaku-body > p, .draw-danmaku-gift-copy',
  sketch: '.draw-danmaku-body > p, .draw-danmaku-gift-copy',
};

function shadowKind(shadow) {
  const lengths = shadow.match(/-?[\d.]+px/g)?.map(parseFloat) || [];
  const glow = lengths[0] === 0 && lengths[1] === 0 && lengths[2] > 0;
  if (/\binset\b/.test(shadow) && lengths[2] === 0 && lengths[3] > 0) return 'decoration';
  return /\binset\b/.test(shadow) ? glow ? 'innerGlow' : 'innerShadow' : glow ? 'outerGlow' : 'shadow';
}

export function replaceEffectShadows(original, parameters, { text = false } = {}) {
  const shadows = original && original !== 'none' ? original.split(/,(?![^()]*\))/).map(value => value.trim()) : [];
  const result = shadows.filter(value => {
    const lengths = value.match(/-?[\d.]+px/g)?.map(parseFloat) || [];
    const kind = text && shadows.length >= 4 && lengths[2] === 0 ? 'textOutline' : shadowKind(value);
    return !Object.hasOwn(parameters, kind);
  });
  for (const group of ['shadow', 'outerGlow', ...(text ? [] : ['innerShadow', 'innerGlow'])]) {
    const value = parameters[group];
    if (!value?.opacity) continue;
    result.push(`${group.startsWith('inner') ? 'inset ' : ''}${value.x || 0}px ${value.y || 0}px ${value.blur}px ${effectColor(value)}`);
  }
  return result.join(', ') || 'none';
}

// One owner per page/frame. Restores inline properties and releases nodes on reconfiguration/disposal.
export function createComponentStyleEffects(document, { externalFrame = null } = {}) {
  const filters = createEffectFilters(document);
  const originals = new Map();
  const roots = new Set();
  let rootSeen = new WeakSet();
  let textSeen = new WeakSet();
  let observer;
  let config = {};
  let type;
  let parameters = {};
  let artworkFilter = '';
  let colorFilter = '';
  let disposed = false;
  const view = document.defaultView;
  function set(element, property, value) {
    let saved = originals.get(element);
    if (!saved) { saved = new Map(); originals.set(element, saved); }
    if (!saved.has(property)) saved.set(property, [element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
    element.style.setProperty(property, value);
  }
  function restore() {
    for (const [element, properties] of originals) for (const [name, [value, priority]] of properties) {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    }
    for (const element of roots) componentEffectProfiles.delete(element);
    roots.clear();
    originals.clear(); rootSeen = new WeakSet(); textSeen = new WeakSet();
    filters.clear();
  }
  function textEffects(root, selector, shadowMode) {
    for (const text of root.querySelectorAll(selector)) {
      if (textSeen.has(text)) continue;
      textSeen.add(text);
      const computed = view.getComputedStyle(text);
      if (parameters.textOutline) {
        set(text, '-webkit-text-stroke', `${parameters.textOutline.width}px ${effectColor(parameters.textOutline)}`);
        set(text, 'paint-order', 'stroke fill');
      }
      if (parameters.textOutline || shadowMode && (parameters.shadow || parameters.outerGlow)) {
        const shadows = shadowMode === 'clear' ? { ...parameters, ...Object.fromEntries(['shadow', 'outerGlow']
          .filter(key => parameters[key]).map(key => [key, { ...parameters[key], opacity: 0 }])) }
          : shadowMode ? parameters : { textOutline: parameters.textOutline };
        set(text, 'text-shadow', replaceEffectShadows(computed.textShadow, shadows, { text: true }));
      }
    }
  }
  function surfaceEffects(element) {
    const computed = view.getComputedStyle(element);
    if (parameters.shadow || parameters.outerGlow) clearElementShadows(element);
    if (['shadow', 'outerGlow', 'innerShadow', 'innerGlow'].some(key => parameters[key])) {
      set(element, 'box-shadow', replaceEffectShadows(computed.boxShadow, parameters));
    }
    if (parameters.outline) {
      set(element, 'border-color', effectColor(parameters.outline));
      set(element, 'border-width', `${parameters.outline.width}px`);
      set(element, 'border-style', 'solid');
    }
  }
  function clearElementShadows(element) {
    const computed = view.getComputedStyle(element);
    // Remove only the authored shadow category that the user has overridden.
    const filter = computed.filter.replace(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g,
      value => parameters[shadowKind(value)] ? '' : value).trim();
    if (filter !== computed.filter) set(element, 'filter', filter || 'none');
  }
  function applyRoot(root, surface, artwork, textOnly = false) {
    if (!rootSeen.has(root)) {
      rootSeen.add(root);
      componentEffectProfiles.set(root, parameters);
      roots.add(root);
      if (artwork && (parameters.shadow || parameters.outerGlow)) {
        for (const element of [root, ...root.querySelectorAll('*')]) clearElementShadows(element);
      }
      const filter = externalFrame ? ['shadow', 'outerGlow'].filter(key => parameters[key]?.opacity).map(key => {
        const value = parameters[key];
        return `drop-shadow(${value.x || 0}px ${value.y || 0}px ${value.blur / 2}px ${effectColor(value)})`;
      }).join(' ') : artwork ? artworkFilter : colorFilter;
      if (filter) {
        const original = view.getComputedStyle(root).filter;
        set(root, 'filter', `${original === 'none' ? '' : original + ' '}${filter}`);
      }
      if (surface) for (const element of surface === ':self' ? [root] : root.querySelectorAll(surface)) surfaceEffects(element);
      if (externalFrame && parameters.outline) set(root, 'outline', `${parameters.outline.width}px solid ${effectColor(parameters.outline)}`);
      const transform = effectTransform(parameters.transform);
      if (transform) {
        set(root, 'transform-origin', 'top left');
        if (!externalFrame && !config.mediaStyle && (type === 'clock' || !config.cssStyle)) {
          set(root, '--component-transform', transform);
          if (type === 'danmaku') set(root, 'transform', 'var(--component-transform)');
        }
        else {
          const original = view.getComputedStyle(root).transform;
          set(root, 'transform-origin', 'top left');
          set(root, 'transform', `${original === 'none' ? '' : original + ' '}${transform}`);
        }
      }
    }
    if (type !== 'browser') textEffects(root, type === 'clock' ? CLOCK_TEXT : config.cssStyle?.engine === 'blc'
      ? '.danmaku-author-name, .danmaku-message' : config.cssStyle?.engine === 'blivechat'
        ? '#author-name, #message' : DANMAKU_TEXT, textOnly ? 'replace' : artwork ? 'clear' : '');
  }
  function apply() {
    if (disposed || !Object.keys(parameters).some(key => key !== 'showEntryMessages')) return;
    for (const element of originals.keys()) if (!element.isConnected) originals.delete(element);
    for (const element of roots) if (!element.isConnected) { roots.delete(element); componentEffectProfiles.delete(element); }
    if (externalFrame) { applyRoot(externalFrame, null, true); return; }
    if (config.mediaStyle) {
      applyRoot(document.body, null, true);
      return;
    }
    const engine = config.cssStyle?.engine;
    if (engine === 'blc' || engine === 'blivechat') {
      const app = document.getElementById('app');
      if (app) applyRoot(app, null, false);
      // New messages arrive after the root has been processed.
      for (const item of document.querySelectorAll(engine === 'blc' ? '.danmaku-item' : 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer')) {
        if (!rootSeen.has(item)) { rootSeen.add(item); surfaceEffects(item); }
      }
      return;
    }
    const kind = STYLE_PARAMETER_CAPABILITIES[type]?.[config.style] || 'art';
    if (type === 'clock') {
      const card = document.getElementById('clockCard');
      if (!card) return;
      const surface = kind === 'moon' ? '.clock-moon-face' : kind === 'panel' ? config.style === 'flip' ? '.clock-content' : ':self' : null;
      applyRoot(card, surface, kind === 'art', kind === 'text');
      return;
    }
    for (const item of document.querySelectorAll('#danmakuFeed > .draw-danmaku-item')) {
      const surface = ['panel', 'frame'].includes(kind)
        ? item.classList.contains('is-superchat') ? '.sc-message'
          : config.style === 'glow' && item.classList.contains('is-gift') ? ':self' : SURFACES[config.style] || ':self' : null;
      applyRoot(item, surface, kind === 'art', kind === 'text');
    }
  }
  const themeChanged = () => { if (type === 'clock') controller.update(type, config); };
  view.addEventListener('lira:effect-theme-change', themeChanged);
  const controller = {
    update(nextType, nextConfig) {
      if (disposed) return;
      observer?.disconnect();
      restore();
      type = nextType; config = nextConfig;
      parameters = styleParametersFor(config);
      colorFilter = externalFrame ? '' : filters.build(parameters);
      artworkFilter = externalFrame ? '' : filters.build(parameters, { artwork: true });
      apply();
      view.dispatchEvent(new view.Event('lira:effects-updated'));
      if (!externalFrame && Object.keys(parameters).some(key => key !== 'showEntryMessages')) {
        observer ||= new view.MutationObserver(() => {
          apply();
          if (type === 'danmaku') view.dispatchEvent(new view.Event('lira:effects-updated'));
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    },
    refresh: apply,
    dispose() {
      if (disposed) return;
      disposed = true; observer?.disconnect(); restore(); filters.dispose();
      view.removeEventListener('lira:effect-theme-change', themeChanged);
    },
  };
  return controller;
}
