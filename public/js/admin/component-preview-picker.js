import { previewElement } from './component-preview-surface.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';

const CATEGORY_ICONS = {
  danmaku: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Zm3 5h9M8 13h6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  queue: 'M9 6h11M9 12h11M9 18h7M4 6h.01M4 12h.01M4 18h.01',
  overtime: 'M9 3h6m-3 0v3m6 2 2-2M12 10v4l2 1m6-1a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  songlist: 'M5 5h9M5 9h7M5 13h5m7-5v10m0-10 4-1v3l-4 1m0 7a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z',
  lyrics: 'M4 6h16M4 12h16M7 18h10',
  '直播小游戏': 'M8 7h8a5 5 0 0 1 5 4l1 5a3 3 0 0 1-5 3l-3-3h-4l-3 3a3 3 0 0 1-5-3l1-5a5 5 0 0 1 5-4Zm-1 3v5m-2-2h4m7-2h.01m2 3h.01',
  'gift-feed': 'M3 8h18v4H3Zm2 4v9h14v-9M12 8v13m0-13H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z',
  blindbox: 'm12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5m-9 5L3 8m9 5v9m-5-17 10 6',
  'gift-wishes': 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
};

function pickerIcon(path) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  icon.append(shape);
  return icon;
}

export function mountComponentPreviewPicker({ components, source, add, report }) {
  const dialog = previewElement('dialog', 'preview-component-picker');
  dialog.setAttribute('aria-labelledby', 'componentPickerTitle');
  dialog.setAttribute('aria-describedby', 'componentPickerDescription');
  const header = previewElement('header', 'preview-picker-heading');
  const heading = previewElement('div');
  const title = previewElement('h2', '', '添加组件');
  title.id = 'componentPickerTitle';
  const description = previewElement('p', '', '预览为示例效果，添加后可调整。');
  description.id = 'componentPickerDescription';
  heading.append(title, description);
  const close = previewElement('button', 'secondary preview-picker-close');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  close.title = '关闭';
  close.append(pickerIcon('m6 6 12 12M18 6 6 18'));
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const body = previewElement('div', 'preview-picker-body');
  const categories = previewElement('nav', 'preview-picker-categories');
  categories.setAttribute('aria-label', '组件分类');
  const content = previewElement('section', 'preview-picker-content');
  const contentHeading = previewElement('div', 'preview-picker-section-heading');
  const contentTitle = previewElement('h3');
  const styleCount = previewElement('span');
  contentHeading.append(contentTitle, styleCount);
  const subcategories = previewElement('nav', 'preview-picker-subcategories');
  subcategories.setAttribute('aria-label', '小游戏分类');
  const styles = previewElement('div', 'preview-picker-styles');
  content.append(contentHeading, subcategories, styles);
  body.append(categories, content);
  dialog.append(header, body);
  document.body.append(dialog);
  const choices = new Map();
  const groups = new Map();
  for (const component of components) {
    const category = COMPONENT_PREVIEW_DEFINITIONS[component.id].category || component.id;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(component);
  }

  function show(component) {
    const category = COMPONENT_PREVIEW_DEFINITIONS[component.id].category || component.id;
    for (const [id, button] of choices) button.setAttribute('aria-pressed', String(id === category));
    subcategories.replaceChildren();
    const members = groups.get(category);
    subcategories.hidden = members.length < 2;
    if (members.length > 1) for (const member of members) {
      const button = previewElement('button', 'secondary', member.title);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(member.id === component.id));
      button.addEventListener('click', () => show(member));
      subcategories.append(button);
    }
    content.setAttribute('aria-label', `${component.title}样式`);
    styles.replaceChildren();
    const definition = COMPONENT_PREVIEW_DEFINITIONS[component.id];
    const attribute = definition.styleAttribute;
    const options = definition.variants?.map((variant) => ({ variant }))
      || (attribute ? [...source.querySelectorAll(`[${attribute}]`)] : [null]).map((original) => ({ original }));
    contentTitle.textContent = definition.category || component.title;
    styleCount.textContent = `${options.length} 款样式`;
    content.scrollTop = 0;
    for (const { original, variant } of options) {
      const preset = variant || definition.defaultStyle;
      const label = original ? original.querySelector('strong, .danmaku-style-name').textContent : preset.label;
      const style = variant?.value || original?.getAttribute(attribute) || 'default';
      const button = previewElement('button', 'preview-picker-style');
      button.type = 'button';
      button.setAttribute('aria-label', `添加${label}`);
      button.dataset.pickerStyle = style;
      const image = previewElement('img', 'preview-picker-image');
      image.src = original?.querySelector('img')?.getAttribute('src') || `/img/component-previews/${component.id}-${style}.webp`;
      image.alt = `${label}示例效果`;
      image.width = 640;
      image.height = 400;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      const caption = previewElement('span', 'preview-picker-caption');
      const action = previewElement('span', 'preview-picker-add', '添加');
      action.prepend(pickerIcon('M12 5v14M5 12h14'));
      caption.append(previewElement('strong', '', label), action);
      button.append(image, caption);
      button.addEventListener('click', () => {
        try {
          const { draft, loaded } = component.controller.getState();
          if (!loaded) throw new Error('组件尚未连接，请从客户端重新打开。');
          const change = definition.styleChange(draft, button.dataset.pickerStyle);
          const config = { ...(component.projectConfig?.(draft) || draft), ...change };
          add(variant ? { ...component, title: label } : component, config);
          dialog.close();
        } catch (error) { report(error.message); }
      });
      styles.append(button);
    }
  }
  for (const [category, members] of groups) {
    const component = members[0];
    const button = previewElement('button');
    button.append(pickerIcon(CATEGORY_ICONS[category]), previewElement('span', '', COMPONENT_PREVIEW_DEFINITIONS[component.id].category || component.title));
    button.type = 'button';
    button.dataset.category = category;
    button.addEventListener('click', () => show(component));
    choices.set(category, button);
    categories.append(button);
  }
  return {
    open() { show(components[0]); dialog.showModal(); },
    dispose() { dialog.close(); dialog.remove(); },
  };
}
