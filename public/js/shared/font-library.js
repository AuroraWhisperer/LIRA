import { SHARED_FONTS, findSharedFont } from './font-catalog.js';
import { ensureSavedFontOption as ensureLocalFontOption, registerLocalFontSelect } from './local-font-library.js';

const registeredSelects = new Set();
const fontReadiness = new Map();
const FONT_MODES = new Set(['', 'default', 'system', 'inherit']);
const legacyFontOptions = new WeakMap();

function retainLegacyFontOptions(select) {
  if (legacyFontOptions.has(select)) return;
  const currentValue = select.value;
  const legacy = new Map();
  for (const option of Array.from(select.options)) {
    if (FONT_MODES.has(option.value)) continue;
    legacy.set(option.value, { label: SYSTEM_FONT_OPTIONS[option.value] || option.textContent,
      fontFamily: option.dataset.fontFamily || option.value });
    option.remove();
  }
  for (const group of Array.from(select.children)) {
    if (group.tagName === 'OPTGROUP' && !group.children.length) group.remove();
  }
  legacyFontOptions.set(select, legacy);
  ensureSavedFontOption(select, currentValue);
  select.value = currentValue;
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
  registeredSelects.forEach(select => populateSharedFontOptions(select));
}

export function refreshSharedFonts() {
  if (!registeredSelects.size) return false;
  const families = sharedFacesByFamily();
  let changed = false;
  for (const font of SHARED_FONTS) {
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
    void document.fonts.load(`16px ${font.value}`, font.sample || font.label).then(loaded => {
      if (fontReadiness.get(font.id) !== readiness) return;
      readiness.ready = loaded.length > 0 && loaded.every(face => face.status === 'loaded');
      refreshRegisteredSelects();
    }, () => {});
  }
  if (changed) refreshRegisteredSelects();
  return changed;
}

// Preserve stored IDs / unquoted families without adding duplicate library choices.
export function ensureSavedFontOption(select, value) {
  if (!select?.options) return;
  const font = findSharedFont(value);
  if (font && !isReady(font)) {
    for (const option of Array.from(select.options)) {
      if (option.dataset.sharedFontPending && option.value !== value) option.remove();
    }
    ensureLocalFontOption(select, value);
    const option = Array.from(select.options).find(item => item.value === value);
    option.textContent = `${font.label}（未就绪）`;
    option.disabled = true;
    option.dataset.sharedFontPending = 'true';
    return;
  }
  const option = font && Array.from(select.options).find(item => item.dataset.fontId === font.id);
  if (option) {
    if (option.value !== value) option.value = value;
  }
  ensureLocalFontOption(select, value, legacyFontOptions.get(select)?.get(value));
}

export function populateSharedFontOptions(select) {
  if (!select) return;
  const currentValue = select.value;
  select.querySelector('optgroup[data-shared-fonts]')?.remove();
  for (const option of Array.from(select.options)) {
    if (findSharedFont(option.value)) option.remove();
  }
  const group = document.createElement('optgroup');
  group.label = '软件字体库';
  group.dataset.sharedFonts = 'true';
  for (const font of SHARED_FONTS) {
    if (!isReady(font)) continue;
    const option = document.createElement('option');
    option.value = font.value;
    option.textContent = font.label;
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

export function registerFontSelect(select, { maxLength } = {}) {
  if (!select) return;
  if (maxLength) select.dataset.fontMaxLength = String(maxLength);
  retainLegacyFontOptions(select);
  registeredSelects.add(select);
  if (!refreshSharedFonts()) populateSharedFontOptions(select);
  const unregisterLocal = registerLocalFontSelect(select);
  return () => {
    registeredSelects.delete(select);
    unregisterLocal();
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
  'Georgia, Times New Roman, STSong, serif': 'Georgia · 优雅衬线',
  'Courier New, Consolas, monospace': '等宽字体 · 极客风格',
});

// Registration retains these old stacks as compatibility metadata, not font choices.
export function populateSystemFontOptions(select, maxLength = Infinity) {
  if (!select) return;
  select.replaceChildren(...Object.entries(SYSTEM_FONT_OPTIONS).filter(([value]) => Array.from(value).length <= maxLength).map(([value, title]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    return option;
  }));
}
