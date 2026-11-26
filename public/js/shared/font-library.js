import { SHARED_FONTS, findSharedFont } from './font-catalog.js';
import { ensureSavedFontOption as ensureLocalFontOption, registerLocalFontSelect } from './local-font-library.js';

const registeredSelects = new Map();
const fontReadiness = new Map();
const FONT_MODES = new Set(['', 'default', 'system', 'inherit']);
const providedFontOptions = new WeakMap();
const FONT_ALIASES = { 'Christmas Letter Nunito': 'Spooky Nunito', 'Celestial Montserrat': 'Gradient Montserrat', 'Lira Wireframe Serif': 'Lira Sea Breeze Serif' };

function fontName(select, label) {
  return select.dataset.fontNamesOnly === 'true' ? label.split(' · ')[0] : label;
}

// Resolve the first available face in the authored stack using the same library inventory.
export function fontValueForStack(select, stack, fallbackValue = '"Microsoft YaHei UI"') {
  const families = (stack.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^,]+/g) || [])
    .map(value => value.trim().replace(/^['"]|['"]$/g, ''));
  const context = select.ownerDocument.createElement('canvas').getContext('2d');
  for (const family of families) {
    const font = findSharedFont(FONT_ALIASES[family] || family);
    if (font) return font.value;
    if (['serif', 'sans-serif', 'monospace', 'cursive', 'system-ui', 'inherit'].includes(family)) continue;
    const value = `"${family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const available = ['monospace', 'serif', 'sans-serif'].some(fallback => {
      context.font = `72px ${fallback}`;
      const baseline = context.measureText('AaWm中文汉字123').width;
      context.font = `72px ${value}, ${fallback}`;
      return context.measureText('AaWm中文汉字123').width !== baseline;
    });
    if (available) return value;
  }
  return fallbackValue;
}

function configureProvidedFonts(select, keepProvidedFonts) {
  let provided = providedFontOptions.get(select);
  if (!provided) {
    provided = Array.from(select.options)
      .filter(option => !FONT_MODES.has(option.value))
      .map(option => ({ option, parent: option.parentNode }));
    providedFontOptions.set(select, provided);
  }
  for (const { option, parent } of provided) {
    if (keepProvidedFonts && !findSharedFont(option.value)) {
      if (parent !== select && !parent.parentNode) select.appendChild(parent);
      if (!option.parentNode) parent.appendChild(option);
    } else {
      option.remove();
      if (parent.tagName === 'OPTGROUP' && !parent.children.length) parent.remove();
    }
  }
}

function sharedFacesByFamily() {
  const families = new Map();
  for (const face of document.fonts || []) {
    const family = face.family.replace(/^(['"])(.*)\1$/, '$2');
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(face);
  }
  return families;
}

function isReady(font) {
  return fontReadiness.get(font.id)?.ready === true;
}

function refreshRegisteredSelects() {
  for (const select of registeredSelects.keys()) populateSharedFontOptions(select);
}

export function refreshSharedFonts() {
  if (!registeredSelects.size) return false;
  const families = sharedFacesByFamily();
  let changed = false;
  const loads = [];
  const menus = new Set(registeredSelects.values());
  const requestedFonts = menus.has(SHARED_FONTS) ? SHARED_FONTS : new Set([...menus].flat());
  for (const font of requestedFonts) {
    const faces = families.get(font.family) || [];
    const previous = fontReadiness.get(font.id);
    if (previous && previous.faces.length === faces.length
      && faces.every((face, index) => face === previous.faces[index])) continue;
    changed = true;
    const readiness = { faces, ready: false };
    fontReadiness.set(font.id, readiness);
    if (!faces.length) continue;
    // Let the browser resolve the current CSS face, including Unicode subsets.
    // A fallback-only result must never count as an available shared font.
    loads.push(document.fonts.load(`16px ${font.value}`, font.sample || font.label).then(loaded => {
      if (fontReadiness.get(font.id) !== readiness) return;
      readiness.ready = loaded.length > 0 && loaded.every(face => face.status === 'loaded');
      return readiness.ready;
    }));
  }
  if (changed) refreshRegisteredSelects();
  if (loads.length) void Promise.allSettled(loads).then(results => {
    if (results.some(result => result.status === 'fulfilled' && result.value)) refreshRegisteredSelects();
  });
  return changed;
}

// Preserve stored IDs / unquoted families without adding duplicate library choices.
export function ensureSavedFontOption(select, value) {
  if (!select?.options) return;
  const font = findSharedFont(value);
  const offeredFonts = registeredSelects.get(select) ?? SHARED_FONTS;
  const option = font && Array.from(select.options).find(item => item.dataset.fontId === font.id);
  if (option && option.value !== value) option.value = value;
  const provided = providedFontOptions.get(select)?.find(({ option }) => option.value === value)?.option;
  const systemLabel = Object.hasOwn(SYSTEM_FONT_OPTIONS, value) ? SYSTEM_FONT_OPTIONS[value] : undefined;
  const label = font?.label ?? systemLabel ?? provided?.textContent;
  const saved = ensureLocalFontOption(select, value, {
    label: label && fontName(select, label),
    fontFamily: provided ? provided.dataset.fontFamily || provided.value : font?.value,
  });
  if (!saved?.dataset.savedLocalFont) return;
  if (font && offeredFonts.includes(font) && !isReady(font)) {
    saved.textContent = select.dataset.fontNamesOnly === 'true' ? fontName(select, font.label) : `${font.label}（未就绪）`;
    saved.title = '字体资源尚未就绪';
    saved.disabled = true;
  } else if (offeredFonts !== SHARED_FONTS) {
    // Keep the stored value and trigger label, but don't offer it as a new choice.
    if (!saved.hidden) saved.hidden = true;
  } else if (saved.hidden) saved.hidden = false;
}

export function populateSharedFontOptions(select) {
  if (!select) return;
  const currentValue = select.value;
  const offeredFonts = registeredSelects.get(select) ?? SHARED_FONTS;
  select.querySelector('optgroup[data-shared-fonts]')?.remove();
  for (const option of Array.from(select.options)) {
    const font = findSharedFont(option.value);
    if (font && (option.dataset.savedLocalFont || (offeredFonts.includes(font) && isReady(font)))) option.remove();
  }
  const group = document.createElement('optgroup');
  group.label = '软件字体库';
  group.dataset.sharedFonts = 'true';
  for (const font of offeredFonts) {
    if (!isReady(font)) continue;
    const option = document.createElement('option');
    option.value = font.value;
    option.textContent = fontName(select, font.label);
    option.dataset.fontId = font.id;
    option.dataset.fontFamily = font.value;
    group.appendChild(option);
  }
  if (group.children.length) select.insertBefore(group, Array.from(select.children).find(child => child.tagName === 'OPTGROUP') || null);
  select.dataset.selectSearch = '';
  select.dataset.selectFontPreview = '';
  ensureSavedFontOption(select, currentValue);
  select.value = currentValue;
}

/** allowedFonts scopes this menu by shared catalog ID and installed family name. Omit it for the full library. */
export function registerFontSelect(select, { allowedFonts, keepProvidedFonts = false, maxLength, namesOnly = false } = {}) {
  if (!select) return;
  if (namesOnly) select.dataset.fontNamesOnly = 'true';
  if (maxLength) select.dataset.fontMaxLength = String(maxLength);
  const currentValue = select.value;
  const fonts = allowedFonts ? SHARED_FONTS.filter(font => allowedFonts.shared?.includes(font.id)) : SHARED_FONTS;
  registeredSelects.set(select, fonts);
  select.querySelector('optgroup[data-local-fonts="true"]')?.remove();
  configureProvidedFonts(select, keepProvidedFonts && !allowedFonts);
  ensureSavedFontOption(select, currentValue);
  select.value = currentValue;
  if (!refreshSharedFonts()) populateSharedFontOptions(select);
  const unregisterLocal = registerLocalFontSelect(select, allowedFonts && (allowedFonts.local ?? []));
  return () => {
    registeredSelects.delete(select);
    unregisterLocal?.();
  };
}

const SYSTEM_FONT_OPTIONS = Object.freeze({
  'Microsoft YaHei, Microsoft JhengHei, PingFang SC, Hiragino Sans GB, Yu Gothic, Meiryo, Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK SC, Noto Sans JP, Noto Sans KR, Segoe UI, Arial, sans-serif': '系统字体',
  'Microsoft YaHei': '微软雅黑',
  'PingFang SC, Microsoft YaHei, sans-serif': '苹方 · 现代简约',
  'SimHei, Microsoft YaHei, sans-serif': '黑体 · 醒目有力',
  'KaiTi, STKaiti, serif': '楷体 · 优雅手写',
  'system-ui, -apple-system, sans-serif': '系统默认无衬线',
  'SimSun, STSong, serif': '宋体 · 传统典雅',
  'Noto Sans SC, Noto Sans JP, Microsoft YaHei, sans-serif': '思源黑体 · 清晰现代',
  'YouYuan, STYuanti, PingFang SC, sans-serif': '幼圆 · 圆润亲切',
  'STLiti, FZLiShu, KaiTi, serif': '隶书 · 古朴庄重',
  'Georgia, Times New Roman, STSong, serif': 'Georgia · 优雅衬线',
  'Courier New, Consolas, monospace': '等宽字体 · 极客风格',
  'STHupo, KaiTi, cursive': '琥珀体 · 创意醒目',
  'Hannotate SC, KaiTi, serif': '手札体 · 文艺清新',
});
