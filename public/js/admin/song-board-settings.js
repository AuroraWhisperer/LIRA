import { normalizeRangeValue, toast } from '../shared/utils.js';
import { initParameterRanges } from '../shared/parameter-range.js';
import { theme } from '../shared/theme.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
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
  ['scrollSecondsRange', 'scrollSeconds', 1, 100, 20],
  ['songBoardFontSize', 'songBoardFontSizeNumber', 10, 80, 28],
  ['songBoardThemeOpacity', 'songBoardThemeOpacityNumber', 0, 1, 0.35, 100],
  ['songBoardBackdropBlur', 'songBoardBackdropBlurNumber', 0, 30, 0],
  ['songBoardGlowIntensity', 'songBoardGlowIntensityNumber', 0, 20, 0],
  ['songBoardSongFontSize', 'songBoardSongFontSizeNumber', 10, 100, 16],
  ['songBoardTitleFontSize', 'songBoardTitleFontSizeNumber', 10, 100, 15],
];

export function songBoardConfigFromSettings(settings) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) => [key, settings[key] ?? fallback]));
}

export function songBoardSettingsPayload(draft, changed = draft) {
  return Object.fromEntries(Object.entries(changed).filter(([key]) => Object.hasOwn(DEFAULTS, key)
    && (draft.songBoardSyncTheme === 'false' || !Object.hasOwn(THEME_DEFAULTS, key))));
}

export function collectSongBoardSettings(form) {
  const node = (id) => form.querySelector(`[id="${id}"]`);
  const draft = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, node(key).value]));
  draft.songBoardSyncTheme = String(node('songBoardSyncTheme').checked);
  draft.songBoardSongColor = node('songBoardSongColorMode').value === 'custom' ? node('songBoardSongColor').value : '';
  return songBoardSettingsPayload(draft);
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
    controller.edit(collectSongBoardSettings(form));
    clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 180);
  };
  for (const [rangeId, numberId, min, max, fallback, displayScale = 1] of RANGE_PAIRS) {
    const range = node(rangeId), number = node(numberId);
    range.addEventListener('input', () => { number.value = String(Math.round(Number(range.value) * displayScale)); });
    number.addEventListener('input', () => {
      if (!number.value || !number.checkValidity()) return;
      range.value = normalizeRangeValue(Number(number.value) / displayScale, min, max, fallback);
    });
    number.addEventListener('change', () => {
      range.value = normalizeRangeValue(number.value === '' ? '' : Number(number.value) / displayScale, min, max, fallback);
      syncComponentFieldValue(number, Math.round(Number(range.value) * displayScale), true);
    });
  }
  form.addEventListener('input', edit);
  form.addEventListener('change', edit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    controller.edit(collectSongBoardSettings(form));
    if (await save()) toast('展示板已保存');
  });
  node('songBoardPresets').addEventListener('click', async (event) => {
    const card = event.target.closest('[data-theme]');
    const preset = card && theme.songBoardThemePresets[card.dataset.theme];
    if (!preset || node('songBoardSyncTheme').checked) return;
    controller.edit(preset);
    render(controller.getState(), true);
    renderPresetCards('songBoardPresets', theme.songBoardThemePresets, theme.songBoardPresetLabels, theme.songBoardPresetSwatches);
    if (await save()) toast(`已套用「${theme.songBoardPresetLabels[card.dataset.theme]}」展示板预设`);
  });
  node('songBoardResetTheme').addEventListener('click', async () => {
    controller.edit(THEME_DEFAULTS);
    render(controller.getState(), true);
    if (await save()) toast('展示板主题已恢复默认');
  });
  function render({ draft, dirty, saving, error, applied }, force = false) {
    ensureSavedFontOption(node('songBoardFontFamily'), draft.songBoardFontFamily);
    const saveState = node('songBoardSaveState');
    saveState.textContent = error ? '保存失败，修改已保留，可点击“保存展示板”重试。'
      : saving ? '正在保存…' : dirty ? '等待自动保存…' : applied ? '已保存并应用到直播画面' : '';
    saveState.hidden = !saveState.textContent;
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
    for (const [rangeId, numberId, , , , displayScale = 1] of RANGE_PAIRS) {
      const saved = draft[rangeId] ?? draft[numberId];
      syncComponentFieldValue(node(rangeId), saved, force);
      syncComponentFieldValue(node(numberId), Math.round(Number(saved) * displayScale), force);
    }
    initParameterRanges(form);
  }
  const unsubscribe = controller.subscribe(render);
  return { save, dispose() {
    clearTimeout(timer);
    unsubscribe();
    unregisterFont?.();
    form.removeEventListener('input', edit);
    form.removeEventListener('change', edit);
  } };
}
