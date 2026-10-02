import { theme } from '../shared/theme.js';
import { normalizeRangeValue } from '../shared/utils.js';
import { readQueueStyleSettings } from '../shared/queue-style-settings.js';
import { initParameterRanges, disposeParameterRanges } from '../shared/parameter-range.js';
import { componentField, syncComponentFieldValue } from './component-preview-panel.js';
import { componentSaveMessage } from './component-config-controller.js';
import { setOverlayStyle } from './theme-style-view.js';
import { ensureSavedFontOption, registerLocalFontSelect } from './local-font-library.js';
import { collectQueueTheme, pickQueueSettings, QUEUE_STYLE_CONTROLS } from './queue-theme-config.js';

const RANGE_PAIRS = [
  ['themeOpacity', 'themeOpacityNumber', 0, 1, 0.48, 100],
  ['queueSongFontSize', 'queueSongFontSizeNumber', 10, 70, 28],
  ['queueTitleFontSize', 'queueTitleFontSizeNumber', 10, 40, 30],
  ['identityQueueFontSize', 'identityQueueFontSizeNumber', 9, 78, 28],
  ['overlayRuleFontSize', 'overlayRuleFontSizeNumber', 8, 18, 10],
  ['backdropBlur', 'backdropBlurNumber', 0, 30, 14],
  ['glowIntensity', 'glowIntensityNumber', 0, 20, 2],
  ['queueScrollSpeedRange', 'queueScrollSpeed', 1, 100, 80],
  ['identityQueueScrollSpeedRange', 'identityQueueScrollSpeed', 1, 100, 80],
];

export function bindQueueTheme(root, controller) {
  const node = (id) => componentField(root, id);
  const unregisterFont = registerLocalFontSelect(node('illustratedQueueFontFamily'));
  for (const [rangeId, numberId, min, max, fallback, scale = 1] of RANGE_PAIRS) {
    const range = node(rangeId), number = node(numberId);
    range.addEventListener('input', () => { number.value = String(Number(range.value) * scale); });
    number.addEventListener('input', () => {
      if (!number.value || !number.checkValidity()) return;
      range.value = normalizeRangeValue(Number(number.value) / scale, min, max, fallback);
    });
    number.addEventListener('change', () => {
      range.value = normalizeRangeValue(Number(number.value) / scale, min, max, fallback);
      syncComponentFieldValue(number, Number(range.value) * scale, true);
    });
  }
  const edit = (event) => {
    if (event.target.type === 'number' && (!event.target.value || !event.target.checkValidity())) return;
    controller.edit(collectQueueTheme(root));
  };
  root.addEventListener('input', edit);
  root.addEventListener('change', edit);
  root.addEventListener('submit', (event) => { event.preventDefault(); void controller.save(); });
  for (const button of root.querySelectorAll('[data-overlay-style]')) button.addEventListener('click', () => {
    controller.edit({ overlayQueueStyle: button.dataset.overlayStyle });
  });
  node('classicPresets').addEventListener('click', (event) => {
    const card = event.target.closest('[data-theme]');
    const preset = card && theme.classicThemePresets[card.dataset.theme];
    if (preset && controller.getState().draft.overlayQueueStyle === 'classic') controller.edit(pickQueueSettings(preset));
  });
  node('quickBeautifyBtn').addEventListener('click', () => controller.edit({ backdropBlur: '20', glowIntensity: '4',
    overlayLowPowerMode: 'false', enableGradient: 'true', gradientEnd: node('gradientEnd').value || '#2a1a2e',
    themeOpacity: '0.30', themeRadius: '14' }));
  node('resetClassicTheme').addEventListener('click', () => controller.edit(pickQueueSettings(theme.defaultThemeLook)));
  node('queueThemeDiscard')?.addEventListener('click', () => controller.discard());
  function render(state) {
    const { draft } = state;
    for (const [key, value] of Object.entries(draft)) {
      const control = node(key);
      if (control) syncComponentFieldValue(control, value);
    }
    const active = readQueueStyleSettings(draft, draft.overlayQueueStyle);
    ensureSavedFontOption(node('illustratedQueueFontFamily'), active.fontFamily);
    for (const [field, id] of Object.entries(QUEUE_STYLE_CONTROLS)) syncComponentFieldValue(node(id), active[field]);
    node('queueScrollSpeedRange').value = draft.queueScrollSpeed;
    node('identityQueueScrollSpeedRange').value = active.scrollSpeed;
    for (const [rangeId, numberId, , , , scale = 1] of RANGE_PAIRS) syncComponentFieldValue(node(numberId), Number(node(rangeId).value) * scale);
    setOverlayStyle(draft.overlayQueueStyle, root);
    initParameterRanges(root);
    const save = node('queueThemeSave');
    if (save) { save.disabled = !state.dirty || state.saving; save.textContent = state.saving ? '正在保存…' : '保存点歌板主题'; }
    const discard = node('queueThemeDiscard');
    if (discard) discard.disabled = !state.dirty || state.saving;
    const status = node('queueThemeSaveState');
    if (status) status.textContent = componentSaveMessage(state);
  }
  const unsubscribe = controller.subscribe(render);
  return { dispose() { unsubscribe(); unregisterFont?.(); disposeParameterRanges(root); } };
}
