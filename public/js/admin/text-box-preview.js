import { createTextBoxDefaults, TEXT_BOX_SIZE, TEXT_BOX_SCROLL_SPEED } from '../shared/text-box-config.js';
import { initParameterRanges, refreshParameterRange, disposeParameterRanges } from '../shared/parameter-range.js';
import { enhanceColorControls } from '../shared/color-control.js';
import { previewElement } from './component-preview-elements.js';
import { mountTextBoxEditor } from './text-box-editor.js';
import { mountTextBoxMedia } from './text-box-media.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ALIGN_PATHS = {
  left: 'M3 5h12M3 9h8M3 13h10',
  center: 'M3 5h12M5 9h8M4 13h10',
  right: 'M3 5h12M7 9h8M5 13h10',
};

function createAlignIcon(direction) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ALIGN_PATHS[direction]);
  svg.append(path);
  return svg;
}

function createSegmentedRadioGroup({ ariaLabel, className = '', options, onSelect }) {
  const group = previewElement('div', `text-box-segmented ${className}`.trim());
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', ariaLabel);
  const buttons = options.map(({ value, label, title, icon }) => {
    const button = previewElement('button', 'text-box-segment');
    button.type = 'button';
    button.dataset.value = value;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.title = title || label;
    if (icon) {
      button.setAttribute('aria-label', label);
      button.append(icon);
    } else {
      button.textContent = label;
    }
    button.addEventListener('click', () => {
      if (!button.disabled) onSelect(value);
    });
    button.addEventListener('keydown', event => {
      const index = buttons.indexOf(button);
      let nextIndex = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = buttons.length - 1;
      if (nextIndex === -1) return;
      event.preventDefault();
      const target = buttons[nextIndex];
      if (!target.disabled) {
        target.focus();
        onSelect(target.dataset.value);
      }
    });
    group.append(button);
    return button;
  });
  return {
    group,
    update(activeValue, disabled) {
      for (const button of buttons) {
        const active = button.dataset.value === activeValue;
        button.setAttribute('aria-checked', String(active));
        button.tabIndex = active ? 0 : -1;
        button.disabled = disabled;
      }
    },
  };
}

export function createTextBoxPreview({ media } = {}) {
  const getState = () => ({ draft: createTextBoxDefaults(), saved: createTextBoxDefaults(), loaded: true, dirty: false });
  const controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  return { id: 'text-box', title: '文本框', sceneOnly: true, controller,
    url: new URL('/text-box?preview=1&componentPreview=1', location.href).href,
    size: () => TEXT_BOX_SIZE,
    createPanel(host, target = controller, { settingsHost, rejectedEdits = new Map(), itemId, onValidityChange } = {}) {
      const content = previewElement('div', 'text-box-panel');
      const label = previewElement('h4', 'text-box-section-title text-box-content-title', '内容');
      const editorHost = previewElement('div');
      const error = previewElement('p', 'text-box-error');
      error.setAttribute('role', 'alert'); error.hidden = true;
      const report = failure => { error.textContent = failure.message; error.hidden = false; };
      function reject(failure) {
        report(failure);
        if (rejectedEdits.get(itemId)?.message === failure.message) return;
        rejectedEdits.set(itemId, { message: failure.message });
        onValidityChange?.();
      }
      function clearRejection() {
        error.hidden = true;
        if (rejectedEdits.delete(itemId)) onValidityChange?.();
      }
      const composer = mountTextBoxEditor(editorHost, {
        getConfig: () => target.getState().draft,
        onChange(config) {
          if (target.edit(config, { onError: reject }) !== false) clearRejection();
        },
        onError: reject,
      });
      const materials = previewElement('section', 'text-box-materials');
      const assets = mountTextBoxMedia(materials, { composer, request: media, onError: report });

      const settings = previewElement('div', 'text-box-settings');
      const bar = previewElement('div', 'text-box-property-bar');

      const alignGroup = previewElement('div', 'text-box-control-group text-box-align-group');
      alignGroup.append(previewElement('span', 'text-box-control-label', '对齐'));
      const alignControl = createSegmentedRadioGroup({
        ariaLabel: '文字对齐',
        className: 'text-box-align-segmented',
        options: [
          { value: 'left', label: '左对齐', icon: createAlignIcon('left') },
          { value: 'center', label: '居中', icon: createAlignIcon('center') },
          { value: 'right', label: '右对齐', icon: createAlignIcon('right') },
        ],
        onSelect: value => target.edit({ align: value }),
      });
      alignGroup.append(alignControl.group);

      const lineHeightGroup = previewElement('label', 'text-box-control-group text-box-line-height-group');
      lineHeightGroup.append(previewElement('span', 'text-box-control-label', '行距'));
      const lineHeightInput = previewElement('select');
      lineHeightInput.setAttribute('aria-label', '行距');
      for (const [value, text] of [[1, '紧凑'], [1.2, '稍紧'], [1.4, '标准'], [1.6, '宽松'], [2, '双倍']]) {
        const option = previewElement('option', '', text);
        option.value = value;
        lineHeightInput.append(option);
      }
      lineHeightInput.addEventListener('change', () => target.edit({ lineHeight: Number(lineHeightInput.value) }));
      lineHeightGroup.append(lineHeightInput);

      const backgroundGroup = previewElement('div', 'text-box-control-group text-box-background');
      const backgroundLabel = previewElement('span', 'text-box-control-label', '背景');
      backgroundLabel.title = '设置文本框底色与不透明度（0% 即透明）；预览区底色不会输出到直播';
      const backgroundColor = previewElement('input');
      backgroundColor.type = 'color';
      backgroundColor.setAttribute('aria-label', '文本框背景颜色');
      backgroundColor.setAttribute('value', '#00000000');
      backgroundColor.addEventListener('input', () => target.edit({ backgroundColor: backgroundColor.value }));
      const clearBackground = previewElement('button', 'ghost text-box-clear-bg', '恢复透明');
      clearBackground.type = 'button';
      clearBackground.addEventListener('click', () => target.edit({ backgroundColor: '#00000000' }));
      backgroundGroup.append(backgroundLabel, backgroundColor, clearBackground);

      const scrollGroup = previewElement('div', 'text-box-control-group text-box-scroll-group');
      scrollGroup.append(previewElement('span', 'text-box-control-label', '自动滚动'));
      const scrollControl = createSegmentedRadioGroup({
        ariaLabel: '自动滚动',
        className: 'text-box-scroll-segmented',
        options: [
          { value: 'none', label: '静止', title: '文字保持静止' },
          { value: 'horizontal', label: '横向', title: '单行向左循环滚动' },
          { value: 'vertical', label: '纵向', title: '保留换行向上循环滚动' },
        ],
        onSelect: value => target.edit({ scrollMode: value }),
      });
      scrollGroup.append(scrollControl.group);

      bar.append(alignGroup, lineHeightGroup, backgroundGroup, scrollGroup);

      const speed = previewElement('div', 'text-box-scroll-speed');
      const speedHeading = previewElement('div', 'text-box-speed-heading');
      const speedLabel = previewElement('span', 'text-box-control-label', '滚动速度');
      const speedValue = previewElement('output', 'text-box-speed-value');
      const slider = previewElement('input', 'parameter-range');
      slider.type = 'range';
      slider.min = TEXT_BOX_SCROLL_SPEED.min;
      slider.max = TEXT_BOX_SCROLL_SPEED.max;
      slider.step = 1;
      slider.setAttribute('aria-label', '滚动速度');
      slider.addEventListener('input', () => target.edit({ scrollSpeed: Number(slider.value) }));
      speedHeading.append(speedLabel, speedValue);
      speed.append(speedHeading, slider);

      settings.append(bar, speed);
      content.append(label, editorHost, materials);
      (settingsHost || content).append(settings);
      content.append(error);
      host.append(content);
      enhanceColorControls(settings);
      initParameterRanges(settings);
      const stop = target.subscribe(({ draft, loaded }) => {
        const disabled = !loaded || host.closest('fieldset:disabled') !== null;
        const rejected = rejectedEdits.get(itemId);
        if (rejected?.content) {
          composer.setConfig(draft, disabled);
          composer.editor.replaceChildren(rejected.content);
          delete rejected.content;
          report(rejected);
        } else if (rejected) composer.setDisabled(disabled);
        else composer.setConfig(draft, disabled);
        assets.setDisabled(disabled);
        alignControl.update(String(draft.align || 'left'), disabled);
        lineHeightInput.value = String(draft.lineHeight);
        lineHeightInput.disabled = disabled;
        const scrollMode = draft.scrollMode || 'none';
        scrollControl.update(scrollMode, disabled);
        backgroundColor.value = draft.backgroundColor || '#00000000';
        backgroundColor.disabled = disabled;
        const transparent = backgroundColor.value.length === 9 && backgroundColor.value.endsWith('00');
        clearBackground.hidden = transparent;
        clearBackground.disabled = disabled || transparent;
        slider.value = draft.scrollSpeed ?? TEXT_BOX_SCROLL_SPEED.default;
        speed.hidden = scrollMode === 'none';
        slider.disabled = disabled || scrollMode === 'none';
        speedValue.value = `${slider.value} 像素/秒`;
        slider.setAttribute('aria-valuetext', speedValue.value);
        refreshParameterRange(slider);
      });
      return {
        discardPendingEdit() {
          assets.cancelPending(); clearRejection();
          const { draft, loaded } = target.getState();
          composer.setConfig(draft, !loaded, true);
        },
        dispose() {
          const rejected = rejectedEdits.get(itemId);
          if (rejected) {
            const range = document.createRange();
            range.selectNodeContents(composer.editor);
            rejected.content = range.extractContents();
          }
          stop(); composer.dispose(); assets.dispose(); disposeParameterRanges(settings); settings.remove(); content.remove();
        },
      };
    },
  };
}
