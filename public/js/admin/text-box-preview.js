import { createTextBoxDefaults, TEXT_BOX_SIZE, TEXT_BOX_SCROLL_SPEED } from '../shared/text-box-config.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { enhanceColorControls } from '../shared/color-control.js';
import { previewElement } from './component-preview-elements.js';
import { mountTextBoxEditor } from './text-box-editor.js';
import { mountTextBoxMedia } from './text-box-media.js';

export function createTextBoxPreview({ media } = {}) {
  const getState = () => ({ draft: createTextBoxDefaults(), saved: createTextBoxDefaults(), loaded: true, dirty: false });
  const controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  return { id: 'text-box', title: '文本框', sceneOnly: true, controller,
    url: new URL('/text-box?preview=1&componentPreview=1', location.href).href,
    size: () => TEXT_BOX_SIZE,
    createPanel(host, target = controller, { settingsHost } = {}) {
      const content = previewElement('div', 'text-box-panel');
      const label = previewElement('h4', 'text-box-section-title', '内容');
      const editorHost = previewElement('div');
      const error = previewElement('p', 'text-box-error');
      error.setAttribute('role', 'alert'); error.hidden = true;
      const report = failure => { error.textContent = failure.message; error.hidden = false; };
      const composer = mountTextBoxEditor(editorHost, {
        getConfig: () => target.getState().draft,
        onChange(config) { target.edit(config); error.hidden = true; }, onError: report,
      });
      const materials = previewElement('section', 'text-box-materials');
      const assets = mountTextBoxMedia(materials, { composer, request: media, onError: report });
      const layout = previewElement('div', 'text-box-layout-fields');
      const typography = previewElement('section', 'text-box-settings-group text-box-layout-settings');
      typography.append(previewElement('h4', 'text-box-section-title', '文字排版'), layout);
      const fields = new Map();
      for (const [key, title, options] of [
        ['align', '文字对齐', [['left', '左对齐'], ['center', '居中'], ['right', '右对齐']]],
        ['lineHeight', '行距', [[1, '紧凑'], [1.2, '稍紧'], [1.4, '标准'], [1.6, '宽松'], [2, '双倍']]],
      ]) {
        const label = previewElement('label', '', title);
        const input = previewElement('select');
        input.setAttribute('aria-label', title);
        for (const [value, text] of options) { const option = previewElement('option', '', text); option.value = value; input.append(option); }
        input.addEventListener('change', () => target.edit({ [key]: key === 'lineHeight' ? Number(input.value) : input.value }));
        label.append(input); layout.append(label); fields.set(key, input);
      }
      const background = previewElement('div', 'text-box-background');
      const backgroundLabel = previewElement('span', 'text-box-background-label', '背景颜色');
      const backgroundHelp = previewElement('lira-help', '', '设置文本框底色和透明度（调到 0% 或点「恢复透明」即无底色）。预览区的底色仅方便看清文字，不会出现在直播画面里。');
      backgroundHelp.setAttribute('label', '背景颜色说明');
      backgroundLabel.append(backgroundHelp);
      const backgroundColor = previewElement('input');
      backgroundColor.type = 'color'; backgroundColor.setAttribute('aria-label', '文本框背景颜色');
      backgroundColor.setAttribute('value', '#00000000');
      backgroundColor.addEventListener('input', () => target.edit({ backgroundColor: backgroundColor.value }));
      const clearBackground = previewElement('button', 'secondary', '恢复透明');
      clearBackground.type = 'button';
      clearBackground.addEventListener('click', () => target.edit({ backgroundColor: '#00000000' }));
      background.append(backgroundLabel, backgroundColor, clearBackground);
      typography.append(background);
      const scrolling = previewElement('section', 'text-box-settings-group text-box-scroll-settings');
      const scrollTitle = previewElement('h4', 'text-box-section-title', '自动滚动');
      const scrollHelp = previewElement('lira-help', '', '横向滚动为单行向左，纵向滚动保留换行并向上；两个方向只能启用一个。都关闭时，文字保持静止。');
      scrollHelp.setAttribute('label', '自动滚动说明');
      scrollTitle.append(scrollHelp); scrolling.append(scrollTitle);
      const directions = previewElement('div', 'text-box-scroll-options');
      const switches = new Map();
      for (const [mode, title] of [['horizontal', '横向滚动'], ['vertical', '纵向滚动']]) {
        const label = previewElement('label', 'text-box-scroll-option', title);
        const control = previewElement('span', 'switch-control');
        const input = previewElement('input');
        input.type = 'checkbox'; input.setAttribute('role', 'switch'); input.setAttribute('aria-label', title);
        const track = previewElement('span', 'switch-track');
        track.setAttribute('aria-hidden', 'true');
        input.addEventListener('change', () => target.edit({ scrollMode: input.checked ? mode : 'none' }));
        control.append(input, track); label.append(control); directions.append(label); switches.set(mode, input);
      }
      const speed = previewElement('div', 'text-box-scroll-speed');
      const speedHeading = previewElement('div', 'text-box-speed-heading');
      const speedLabel = previewElement('span', '', '滚动速度');
      const speedHelp = previewElement('lira-help', '', '开启横向或纵向滚动后可调，数值越大滚得越快。');
      speedHelp.setAttribute('label', '滚动速度说明');
      speedLabel.append(speedHelp);
      const speedValue = previewElement('output', 'text-box-speed-value');
      const slider = previewElement('input', 'parameter-range');
      slider.type = 'range'; slider.min = TEXT_BOX_SCROLL_SPEED.min; slider.max = TEXT_BOX_SCROLL_SPEED.max; slider.step = 1;
      slider.setAttribute('aria-label', '滚动速度');
      slider.addEventListener('input', () => target.edit({ scrollSpeed: Number(slider.value) }));
      speedHeading.append(speedLabel, speedValue);
      speed.append(speedHeading, slider);
      scrolling.append(directions, speed);
      const settings = previewElement('div', 'text-box-settings');
      settings.append(typography, scrolling);
      content.append(label, editorHost, materials);
      (settingsHost || content).append(settings);
      content.append(error);
      host.append(content);
      enhanceColorControls(settings);
      initParameterRanges(settings);
      const stop = target.subscribe(({ draft, loaded }) => {
        const disabled = !loaded || host.closest('fieldset:disabled') !== null;
        composer.setConfig(draft, disabled);
        assets.setDisabled(disabled);
        for (const [key, input] of fields) { input.value = String(draft[key]); input.disabled = disabled; }
        for (const [mode, input] of switches) { input.checked = draft.scrollMode === mode; input.disabled = disabled; }
        backgroundColor.value = draft.backgroundColor || '#00000000';
        backgroundColor.disabled = disabled;
        clearBackground.disabled = disabled || backgroundColor.value.length === 9 && backgroundColor.value.endsWith('00');
        slider.value = draft.scrollSpeed ?? TEXT_BOX_SCROLL_SPEED.default;
        speed.hidden = !draft.scrollMode || draft.scrollMode === 'none';
        slider.disabled = disabled || draft.scrollMode === 'none';
        speedValue.value = `${slider.value} 像素/秒`;
        slider.setAttribute('aria-valuetext', speedValue.value);
        refreshParameterRange(slider);
      });
      return { cancelPendingMedia() { assets.cancelPending(); },
        dispose() { stop(); composer.dispose(); assets.dispose(); disposeParameterRanges(settings); settings.remove(); content.remove(); } };
    },
  };
}
