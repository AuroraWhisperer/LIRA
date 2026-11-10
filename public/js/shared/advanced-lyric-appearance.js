import { ADVANCED_LYRIC_CATALOG } from './advanced-lyric-catalog.js';

const number = (label, value, min, max, step = 1, group = 'layout') => ({ label, type: 'number', default: String(value), min, max, step, group });
const check = (label, value, group) => ({ label, type: 'checkbox', default: String(value), group });
const color = (label, value, group = 'font') => ({ label, type: 'color', default: value, group });
const select = (label, value, catalog, group) => ({ label, type: 'select', default: value, catalog, group,
  options: Object.fromEntries(ADVANCED_LYRIC_CATALOG[catalog].map(item => [item.id, item.label])) });

export const LYRIC_DISPLAY_FIELDS = Object.freeze({
  desktopLyricEnabled: check('显示基础歌词', true, 'display'),
  advancedLyricEnabled: check('显示高级歌词', false, 'display'),
});

export const ADVANCED_LYRIC_FIELDS = Object.freeze({
  advancedLyricLayout: select('编排与构图', 'phrase-flow', 'layouts', 'layout'),
  // Retained for saved settings/presets; advanced output only renders the current line.
  advancedLyricShowNextLine: { ...check('显示下一句', false, 'display'), hidden: true },
  advancedLyricHideUnsung: check('隐藏未唱到的字', true, 'display'),
  advancedLyricShowTranslation: check('显示翻译', false, 'display'),
  advancedLyricHideOnPause: check('暂停时隐藏', false, 'display'),
  advancedLyricFontFamily: { label: '字体', type: 'text', default: 'Lira Maiyuan', maxLength: 256, group: 'font', description: '可选择软件字体库或本机字体。' },
  advancedLyricFontWeight: { label: '字重', type: 'select', default: '800', group: 'font',
    options: { 400: '常规', 500: '中等', 600: '半粗', 700: '加粗', 800: '特粗', 900: '超粗' } },
  advancedLyricFontStyle: { label: '字形', type: 'select', default: 'normal', group: 'font', options: { normal: '正体', italic: '斜体' } },
  advancedLyricFontSize: { ...number('字号', 72, 24, 160, 1, 'font'), description: '字号上限；长句会自动缩小以适应构图。' },
  advancedLyricLetterSpacing: number('字间距（字宽）', 0, -0.05, 0.6, 0.01, 'font'),
  advancedLyricLineHeight: { ...number('换行行距（倍）', 1.2, 0.9, 1.8, 0.05, 'font'), description: '调整同一词组换行后的行距。' },
  advancedLyricTextColor: color('文字颜色', '#fff9ee'),
  advancedLyricAccentColor: color('强调颜色', '#f5bd6b'),
  advancedLyricSecondaryColor: color('辅助颜色', '#e7a1ba'),
  advancedLyricHighlightOpacity: { ...number('演唱填色浓度', 1, 0, 1, 0.05, 'colors'), description: '调低可露出文字材质；设为 0 仍保留逐字动作。' },
  advancedLyricMaterial: select('文字材质', 'solid', 'materials', 'effects'),
  advancedLyricGradientAngle: { ...number('材质方向（°）', 160, 0, 360, 5, 'effects'), description: '旋转渐变、反光或条纹的方向。' },
  advancedLyricTextureScale: { ...number('纹理大小（倍）', 1, 0.5, 3, 0.1, 'effects'), description: '放大条纹、圆点或粉笔颗粒。' },
  advancedLyricStrokeEnabled: check('描边', true, 'effects'),
  advancedLyricStrokeColor: color('描边颜色', '#22202a', 'effects'),
  advancedLyricStrokeWidth: number('描边宽度', 2, 0, 8, 0.5, 'effects'),
  advancedLyricStrokeLayers: number('描边层数', 1, 1, 3, 1, 'effects'),
  advancedLyricShadowEnabled: check('投影', true, 'effects'),
  advancedLyricShadowColor: color('投影颜色', '#00000085', 'effects'),
  advancedLyricShadowDistance: number('投影距离（倍）', 1, 0, 8, 0.25, 'effects'),
  advancedLyricShadowAngle: { ...number('投影方向（°）', 90, -180, 180, 5, 'effects'), description: '0° 向右，90° 向下，−90° 向上。' },
  advancedLyricShadowBlur: { ...number('投影柔和度（倍）', 1, 0, 4, 0.1, 'effects'), description: '0 为清晰硬边，调大后边缘更柔和。' },
  advancedLyricGlowEnabled: check('外发光', false, 'effects'),
  advancedLyricGlowRadius: number('发光范围（倍）', 1, 0.25, 3, 0.25, 'effects'),
  advancedLyricGlowOpacity: { ...number('发光浓度', 1, 0, 1, 0.05, 'effects'), description: '使用强调色；设为 0 时光晕消失。' },
  advancedLyricExtrudeEnabled: check('长投影', false, 'effects'),
  advancedLyricChromaticEnabled: check('文字色差', false, 'effects'),
  advancedLyricEmbossEnabled: check('浮雕', false, 'effects'),
  advancedLyricEchoEnabled: check('文字回声', false, 'effects'),
  advancedLyricHollowEnabled: check('空心字形', false, 'effects'),
  advancedLyricEffectStrength: number('字效强度', 0.5, 0, 1, 0.05, 'effects'),
  advancedLyricEnter: select('入场', 'rise', 'enters', 'motion'),
  advancedLyricHold: select('停留', 'still', 'holds', 'motion'),
  advancedLyricExit: select('退场', 'fade', 'exits', 'motion'),
  advancedLyricWordMotion: select('逐字动作', 'fill', 'wordMotions', 'motion'),
  advancedLyricMotionDuration: number('转场时长（毫秒）', 600, 100, 1600, 50, 'motion'),
  advancedLyricMotionAmount: number('动作幅度', 1, 0.25, 2, 0.05, 'motion'),
  advancedLyricRotateLayouts: check('按句轮换排版', false, 'layout'),
  advancedLyricLayoutSequence: { label: '排版轮换组合', type: 'text', default: '', maxLength: 256, group: 'layout', sequence: 'layouts' },
  advancedLyricRotateMotions: check('按句轮换入场', false, 'motion'),
  advancedLyricMotionSequence: { label: '入场轮换组合', type: 'text', default: '', maxLength: 256, group: 'motion', sequence: 'enters' },
  advancedLyricDecoration: select('装饰', 'none', 'decorations', 'decoration'),
  advancedLyricWidth: number('构图宽度（%）', 90, 25, 100),
  advancedLyricScale: number('整体缩放', 1, 0.3, 2, 0.05),
  advancedLyricPositionX: number('水平位置（%）', 50, 0, 100),
  advancedLyricPositionY: number('垂直位置（%）', 50, 0, 100),
  advancedLyricRotate: number('整体旋转', 0, -30, 30),
  advancedLyricOpacity: number('整体不透明度', 1, 0, 1, 0.05, 'display'),
});

const FIELDS = Object.freeze({ ...LYRIC_DISPLAY_FIELDS, ...ADVANCED_LYRIC_FIELDS });
export const LYRIC_VISUAL_DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, field.default])));
export const ADVANCED_LYRIC_PRESETS_SETTING = 'advancedLyricSavedPresets';

export function normalizeLyricVisualSetting(key, raw) {
  const field = FIELDS[key];
  if (!field) return null;
  if (field.type === 'checkbox') return [true, false, 'true', 'false'].includes(raw) ? String(raw) : null;
  if (field.type === 'number') {
    if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < field.min || value > field.max
      || Math.abs((value - field.min) / field.step - Math.round((value - field.min) / field.step)) > 0.000001) return null;
    return String(value);
  }
  if (typeof raw !== 'string') return null;
  if (field.type === 'color') return /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(raw) ? raw : null;
  if (field.type === 'select') return Object.hasOwn(field.options, raw) ? raw : null;
  if (Array.from(raw).length > field.maxLength || /[\u0000-\u001f]/u.test(raw)) return null;
  if (field.sequence) {
    const ids = raw.split(',').map(id => id.trim()).filter(Boolean);
    const allowed = new Set(ADVANCED_LYRIC_CATALOG[field.sequence].map(item => item.id));
    if (ids.length > 12 || ids.some(id => !allowed.has(id))) return null;
    return [...new Set(ids)].join(',');
  }
  return raw.trim() ? raw : null;
}

export function resolveAdvancedLyricSettings(raw = {}) {
  return Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => {
    const value = normalizeLyricVisualSetting(key, raw[key]) ?? field.default;
    return [key, field.type === 'checkbox' ? value === 'true' : field.type === 'number' ? Number(value) : value];
  }));
}

export function normalizeAdvancedLyricPresets(raw) {
  try {
    if (typeof raw === 'string' && raw.length > 65536) return null;
    const entries = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(entries) || entries.length > 20) return null;
    const ids = new Set();
    const result = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some(key => !['id', 'name', 'settings'].includes(key))
        || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id) || ids.has(entry.id)
        || typeof entry.name !== 'string' || !entry.name.trim() || Array.from(entry.name).length > 64
        || /[\u0000-\u001f]/u.test(entry.name) || !entry.settings || typeof entry.settings !== 'object' || Array.isArray(entry.settings)) throw new Error('Invalid preset');
      ids.add(entry.id);
      const settings = Object.fromEntries(Object.entries(ADVANCED_LYRIC_FIELDS).map(([key, field]) => [key, field.default]));
      for (const [key, value] of Object.entries(entry.settings)) {
        if (!Object.hasOwn(ADVANCED_LYRIC_FIELDS, key)) throw new Error('Invalid preset setting');
        const normalized = normalizeLyricVisualSetting(key, value);
        if (normalized === null) throw new Error('Invalid preset value');
        settings[key] = normalized;
      }
      return { id: entry.id, name: entry.name.trim(), settings };
    });
    const serialized = JSON.stringify(result);
    return serialized.length <= 65536 ? serialized : null;
  } catch {
    return null;
  }
}

export function parseAdvancedLyricPresets(raw) {
  const value = normalizeAdvancedLyricPresets(raw);
  return value === null ? [] : JSON.parse(value);
}
