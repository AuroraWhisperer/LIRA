import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import {
  readAppearanceValue,
  editStyleOption,
  resetStyleOptions,
  isValidFullscreenDuration,
} from '../shared/danmaku-appearance-draft.js';

export function initPreviewAppearance({ getDraft, change, error }) {
  const byId = (id) => document.getElementById(id);
  const fields = {
    fontFamily: byId('previewFontFamily'), fontSize: byId('previewFontSize'),
    textColor: byId('previewTextColor'), backgroundOpacity: byId('previewBackgroundOpacity'),
    giftImage: byId('previewGiftImage'), scrollDirection: byId('previewScrollDirection'),
  };
  for (const [key, control] of Object.entries(fields)) {
    control.addEventListener('change', () => {
      const draft = getDraft();
      let value;
      try {
        value = readAppearanceValue(key, control.value, control.min, control.max);
      } catch (reason) {
        error(reason.message);
        render();
        return;
      }
      if (key === 'fontSize') value = Math.round(value / draft.layout.contentScale);
      change(editStyleOption(draft, key, value));
    });
  }
  byId('previewAppearanceReset').addEventListener('click', () => {
    change(resetStyleOptions(getDraft()));
  });
  byId('previewDuration').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    if (!isValidFullscreenDuration(value)) {
      error('停留时间请输入 2～30 秒的整数。');
      render();
      return;
    }
    change({ ...getDraft(), fullscreenDurationSeconds: value });
  });
  function addFonts(fonts) {
    for (const { value, label } of fonts) {
      if (Array.from(fields.fontFamily.options).some((option) => option.value === value)) continue;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fields.fontFamily.append(option);
    }
  }
  function render() {
    const draft = getDraft();
    const options = styleOptionsFor(draft.style, draft.styleOptions);
    const limits = DANMAKU_STYLE_OPTIONS[draft.style];
    addFonts([{ value: options.fontFamily, label: options.fontFamily }]);
    for (const [key, control] of Object.entries(fields)) control.value = String(options[key]);
    fields.fontSize.value = String(Math.round(options.fontSize * draft.layout.contentScale));
    fields.fontSize.min = String(Math.ceil(limits.minFontSize * draft.layout.contentScale));
    fields.fontSize.max = String(Math.floor(limits.maxFontSize * draft.layout.contentScale));
    byId('previewBackgroundField').hidden = !limits.background;
    byId('previewGiftField').hidden = !limits.giftImage;
    byId('previewDirectionField').hidden = !limits.scrollDirection;
    byId('previewDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewDuration').value = String(draft.fullscreenDurationSeconds);
  }
  return { render, addFonts };
}
