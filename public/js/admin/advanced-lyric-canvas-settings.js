import { ADVANCED_LYRIC_FIELDS, ADVANCED_LYRIC_PRESETS_SETTING } from '../shared/advanced-lyric-appearance.js';
import { hasInstalledAppearance } from '../shared/scene-shared-appearance.js';
import { createAdvancedLyricEditor } from './advanced-lyric-editor.js';
import { previewElement } from './component-preview-elements.js';

export function mountAdvancedLyricCanvasSettings(host, target) {
  const section = previewElement('details', 'desktop-lyric-settings-group scene-parameter-group advanced-lyric-canvas-settings');
  section.dataset.parameterGroup = 'advanced-lyrics';
  section.open = true;
  const summary = previewElement('summary');
  summary.append(previewElement('strong', '', '高级歌词'));
  section.append(summary);
  const controls = previewElement('fieldset', 'desktop-lyric-group-body');
  const root = previewElement('div', 'advanced-lyric-editor');
  controls.append(root); section.append(controls); host.append(section);
  const savedPresets = !hasInstalledAppearance(target.getState().draft);
  const editor = createAdvancedLyricEditor(root, { idPrefix: `canvas-lyrics-${crypto.randomUUID()}-`, savedPresets });
  editor.load(target.getState().draft);
  editor.activate();
  const edit = () => {
    const state = target.getState();
    if (!state.loaded) return;
    const patch = Object.fromEntries(Object.entries(editor.read()).filter(([key, value]) =>
      (Object.hasOwn(ADVANCED_LYRIC_FIELDS, key) || savedPresets && key === ADVANCED_LYRIC_PRESETS_SETTING)
        && value !== String(state.draft[key] ?? ADVANCED_LYRIC_FIELDS[key]?.default ?? '[]')));
    if (Object.keys(patch).length) target.edit(patch);
  };
  const reset = () => editor.reset();
  root.addEventListener('input', edit);
  root.addEventListener('change', edit);
  root.addEventListener('lyric:reset-advanced', reset);
  const stop = target.subscribe(({ draft, loaded }) => {
    section.hidden = draft.lyricLayer === 'basic';
    controls.disabled = !loaded;
    editor.load(draft);
  });
  return { dispose() {
    stop(); editor.dispose();
    root.removeEventListener('input', edit);
    root.removeEventListener('change', edit);
    root.removeEventListener('lyric:reset-advanced', reset);
    section.remove();
  } };
}
