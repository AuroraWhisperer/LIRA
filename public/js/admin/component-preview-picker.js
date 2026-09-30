import { previewElement } from './component-preview-surface.js';
import { clockStyleChange } from './clock-card.js';

const STYLE_FIELDS = {
  danmaku: ['data-danmaku-style', 'style'],
  clock: ['data-clock-style-option', 'style'],
  queue: ['data-overlay-style', 'overlayQueueStyle'],
};

export function mountComponentPreviewPicker({ components, source, add, report }) {
  const dialog = previewElement('dialog', 'preview-component-picker');
  dialog.setAttribute('aria-labelledby', 'componentPickerTitle');
  const header = previewElement('header', 'preview-picker-heading');
  const title = previewElement('h2', '', '添加组件');
  title.id = 'componentPickerTitle';
  const close = previewElement('button', 'secondary', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);
  const body = previewElement('div', 'preview-picker-body');
  const categories = previewElement('nav', 'preview-picker-categories');
  categories.setAttribute('aria-label', '组件分类');
  const content = previewElement('section', 'preview-picker-content');
  const heading = previewElement('h3');
  const hint = previewElement('p', 'hint', '选择一个样式加入画布，随后在右侧调整参数。');
  const styles = previewElement('div', 'preview-picker-styles');
  content.append(heading, hint, styles);
  body.append(categories, content);
  dialog.append(header, body);
  document.body.append(dialog);
  const choices = new Map();

  function show(component) {
    for (const [id, button] of choices) button.setAttribute('aria-pressed', String(id === component.id));
    heading.textContent = component.title;
    styles.replaceChildren();
    const field = STYLE_FIELDS[component.id];
    const originals = field ? [...source.querySelectorAll(`[${field[0]}]`)] : [null];
    for (const original of originals) {
      const button = original?.cloneNode(true) || previewElement('button', 'preview-picker-countdown');
      if (!original) button.append(previewElement('span', '', '00:02:00'), previewElement('strong', '', '默认倒计时'));
      const label = button.querySelector('strong, .danmaku-style-name').textContent;
      button.type = 'button';
      button.classList.remove('active');
      button.classList.add('preview-picker-style');
      button.removeAttribute('aria-pressed');
      button.setAttribute('aria-label', `添加${label}`);
      button.dataset.pickerStyle = original?.getAttribute(field[0]) || 'default';
      if (field) button.removeAttribute(field[0]);
      button.addEventListener('click', () => {
        try {
          const { draft, loaded } = component.controller.getState();
          if (!loaded) throw new Error('组件尚未连接，请从客户端重新打开。');
          const change = !field ? {} : component.id === 'clock' ? clockStyleChange(draft, button.dataset.pickerStyle)
            : { [field[1]]: button.dataset.pickerStyle };
          const config = { ...(component.projectConfig?.(draft) || draft), ...change };
          add(component, config);
          dialog.close();
        } catch (error) { report(error.message); }
      });
      styles.append(button);
    }
  }
  for (const component of components) {
    const button = previewElement('button', '', component.title);
    button.type = 'button';
    button.dataset.category = component.id;
    button.addEventListener('click', () => show(component));
    choices.set(component.id, button);
    categories.append(button);
  }
  return {
    open() { show(components[0]); dialog.showModal(); },
    dispose() { dialog.close(); dialog.remove(); },
  };
}
