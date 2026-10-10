import { DANMAKU_STYLE_OPTIONS, isRandomDanmakuStyle, styleOptionsFor } from '../shared/danmaku-style-options.js';
import { canvasContentScale } from './danmaku-canvas.js';
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
    edgeFade: byId('previewEdgeFade'),
    speedPixelsPerSecond: byId('previewSpeedPixelsPerSecond'),
    centerBias: byId('previewCenterBias'), dispersion: byId('previewDispersion'),
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
      if (key === 'fontSize') value = Math.round(value / canvasContentScale(draft.layout, draft.style));
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
    byId('previewTextColorLabel').textContent = draft.style === 'sketch' ? '主题颜色' : '正文颜色';
    const scale = canvasContentScale(draft.layout, draft.style);
    addFonts([{ value: options.fontFamily, label: options.fontFamily }]);
    for (const [key, control] of Object.entries(fields)) control.value = String(options[key]);
    fields.fontSize.value = String(Math.round(options.fontSize * scale));
    fields.fontSize.min = String(Math.ceil(limits.minFontSize * scale));
    fields.fontSize.max = String(Math.floor(limits.maxFontSize * scale));
    byId('previewBackgroundField').hidden = !limits.background;
    byId('previewGiftField').hidden = !limits.giftImage;
    byId('previewDirectionField').hidden = !limits.scrollDirection;
    byId('previewEdgeFadeField').hidden = !limits.scrollDirection;
    byId('previewSpeedField').hidden = !limits.speed;
    byId('previewDurationField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewCenterBiasField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewDispersionField').hidden = !isRandomDanmakuStyle(draft.style);
    byId('previewDuration').value = String(draft.fullscreenDurationSeconds);
  }
  return { render, addFonts };
}
