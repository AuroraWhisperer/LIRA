import { toast } from '../shared/utils.js';
import { bindRangeNumber, formatRangeNumber, initParameterRanges, disposeParameterRanges } from '../shared/parameter-range.js';
import { theme } from '../shared/theme.js';
import { syncComponentFieldValue, subscribeComponentFields } from './component-preview-panel.js';
import { renderPresetCards } from './theme-preset-cards.js';
import { ensureSavedFontOption, registerFontSelect } from '../shared/font-library.js';

const THEME_DEFAULTS = {
  songBoardThemePrimary: '#ff6f91', songBoardThemeAccent: '#21b6a8', songBoardThemeText: '#fff7fb',
  songBoardThemeBackground: '#181823', songBoardThemeOpacity: '0.35', songBoardThemeRadius: '8',
  songBoardBackdropBlur: '0', songBoardGlowIntensity: '0', songBoardEnableGradient: 'false',
  songBoardGradientEnd: '#181823', songBoardFontFamily: 'Microsoft YaHei', songBoardFontWeight: '800',
  songBoardSongColor: '', songBoardTitle: '', songBoardSongFontSize: '16', songBoardTitleFontSize: '15',
};
const DEFAULTS = { scrollSeconds: '20', songBoardSyncTheme: 'true', songBoardSortMode: 'initial',
  songBoardFontSize: '28', ...THEME_DEFAULTS };
const RANGE_PAIRS = [
  ['scrollSecondsRange', 'scrollSeconds'],
  ['songBoardFontSize', 'songBoardFontSizeNumber'],
  ['songBoardThemeOpacity', 'songBoardThemeOpacityNumber', 100],
  ['songBoardBackdropBlur', 'songBoardBackdropBlurNumber'],
  ['songBoardGlowIntensity', 'songBoardGlowIntensityNumber'],
  ['songBoardSongFontSize', 'songBoardSongFontSizeNumber'],
  ['songBoardTitleFontSize', 'songBoardTitleFontSizeNumber'],
];

export function songBoardConfigFromSettings(settings) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, settings[key] ?? fallback]));
}

export function songBoardSettingsPayload(draft, changed = draft) {
  // Sync chooses the rendered theme; independent edits still need to survive toggling it.
  return Object.fromEntries(Object.entries(changed).filter(([key]) => Object.hasOwn(DEFAULTS, key)));
}

export function collectSongBoardSettings(form, keys = Object.keys(DEFAULTS)) {
  const node = id => form.querySelector(`[id="${id}"]`);
  const values = {};
  for (const key of keys) {
    if (key === 'songBoardSyncTheme') values[key] = String(node(key).checked);
    else if (key === 'songBoardSongColor' && node('songBoardSongColorMode').value !== 'custom') values[key] = '';
    else values[key] = node(key).value;
  }
  return values;
}

export function bindSongBoardSettings(form, controller) {
  const node = (id) => form.querySelector(`[id="${id}"]`);
  const unregisterFont = registerFontSelect(node('songBoardFontFamily'));
  let timer;
  let pendingSave;
  const save = () => {
    clearTimeout(timer);
    if (pendingSave) return pendingSave;
    // Serialize writes, including edits made while the previous request is pending.
    pendingSave = (async () => {
      while (controller.getState().dirty) {
        if (!await controller.save()) {
          toast(controller.getState().error || '展示板保存失败，修改已保留，请重试。', { type: 'error' });
          return false;
        }
      }
      return true;
    })().finally(() => { pendingSave = null; });
    return pendingSave;
  };
  const edit = (event) => {
    if (event.target.type === 'number' && (!event.target.value || !event.target.checkValidity())) return;
    const id = event.target.id;
    const pair = RANGE_PAIRS.find(([rangeId, numberId]) => id === rangeId || id === numberId);
    const key = pair ? pair.find(id => Object.hasOwn(DEFAULTS, id))
      : id === 'songBoardSongColorMode' ? 'songBoardSongColor' : id;
    if (!Object.hasOwn(DEFAULTS, key)) return;
    // Focused fields may still display an older value; only this control is an edit.
    controller.edit(collectSongBoardSettings(form, [key]));
    clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 180);
  };
  const unbindRanges = RANGE_PAIRS.map(([rangeId, numberId, scale]) => bindRangeNumber(node(rangeId), node(numberId), scale));
  form.addEventListener('input', edit);
  form.addEventListener('change', edit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await save();
  });
  node('songBoardPresets').addEventListener('click', async (event) => {
    const card = event.target.closest('[data-theme]');
    const preset = card && theme.songBoardThemePresets[card.dataset.theme];
    if (!preset || node('songBoardSyncTheme').checked) return;
    controller.edit(preset);
    render(controller.getState(), true);
    renderPresetCards('songBoardPresets', theme.songBoardThemePresets, theme.songBoardPresetLabels, theme.songBoardPresetSwatches);
    await save();
  });
  node('songBoardResetTheme').addEventListener('click', async () => {
    controller.edit(THEME_DEFAULTS);
    render(controller.getState(), true);
    await save();
  });
  function render({ draft, error }, force = false) {
    ensureSavedFontOption(node('songBoardFontFamily'), draft.songBoardFontFamily);
    const saveState = node('songBoardSaveState');
    saveState.textContent = error ? '自动保存失败，修改已保留，请重试。' : '';
    saveState.hidden = !saveState.textContent;
    form.querySelector('button[type="submit"]').hidden = !error;
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'songBoardSyncTheme' || key === 'songBoardSongColor') continue;
      syncComponentFieldValue(node(key), draft[key], force);
    }
    node('songBoardSyncTheme').checked = draft.songBoardSyncTheme !== 'false';
    node('songBoardThemeArea').hidden = node('songBoardSyncTheme').checked;
    const color = node('songBoardSongColor');
    color.disabled = !draft.songBoardSongColor;
    syncComponentFieldValue(node('songBoardSongColorMode'), draft.songBoardSongColor ? 'custom' : 'inherit', force);
    syncComponentFieldValue(color, draft.songBoardSongColor || draft.songBoardThemeText, force);
    for (const [rangeId, numberId, scale] of RANGE_PAIRS) {
      const saved = draft[rangeId] ?? draft[numberId];
      const range = node(rangeId);
      syncComponentFieldValue(range, saved, force);
      syncComponentFieldValue(node(numberId), formatRangeNumber(range.value, scale), force);
    }
    initParameterRanges(form);
  }
  const unsubscribe = subscribeComponentFields(form, controller, render);
  return { save, dispose() {
    clearTimeout(timer);
    unsubscribe();
    unregisterFont?.();
    unbindRanges.forEach(unbind => unbind());
    disposeParameterRanges(form);
    form.removeEventListener('input', edit);
    form.removeEventListener('change', edit);
  } };
}
