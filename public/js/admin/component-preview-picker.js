import { previewElement } from './component-preview-surface.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { mountBrowserSourceFields } from './browser-source-preview.js';
import { createTextBoxDefaults } from '../shared/text-box-config.js';
import { renderTextBox } from '../shared/text-box-renderer.js';
import { mountComponentStyleLibrary } from './component-style-library.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';

// Content bounds in the existing 640 × 400 thumbnails; retain room for shadows.
const PREVIEW_IMAGE_BOUNDS = {
  'clock-digital': [44, 100, 504, 196],
  'clock-flip': [72, 128, 496, 160],
  'clock-orbit': [48, 104, 552, 204],
  'clock-peach': [16, 84, 608, 232],
  'clock-soda': [16, 84, 608, 232],
  'clock-starlight': [8, 84, 624, 240],
  'clock-timeline-horizontal': [116, 144, 408, 104],
  'clock-timeline-vertical': [272, 56, 100, 288],
  'queue-classic': [88, 8, 464, 384],
  'queue-identity': [116, 8, 412, 384],
  'queue-storybook': [196, 16, 248, 340],
  'queue-neon-vinyl': [168, 8, 304, 384],
  'queue-cherry-ribbon': [168, 8, 304, 384],
  'queue-golden-lily': [184, 8, 272, 384],
  'songlist-default': [132, 8, 376, 384],
  'lyrics-default': [8, 84, 396, 236],
  'games-number-bomb': [8, 64, 624, 272],
  'games-gomoku': [124, 8, 392, 384],
  'wheel-default': [124, 8, 392, 384],
  'gift-wishes-card': [16, 140, 616, 120],
  'gift-wishes-text': [8, 160, 256, 80],
  'gift-wishes-circle': [140, 8, 360, 376],
  'gift-sprint-default': [24, 160, 592, 80],
};

const CATEGORY_ICONS = {
  background: 'M3 4h18v16H3Zm0 12 5-5 4 4 3-3 6 6M16 8h.01',
  'text-box': 'M4 4h16v4M12 4v16m-4 0h8',
  opening: 'M3 5h18v14H3Zm7 4 5 3-5 3Z',
  danmaku: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Zm3 5h9M8 13h6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  queue: 'M9 6h11M9 12h11M9 18h7M4 6h.01M4 12h.01M4 18h.01',
  overtime: 'M9 3h6m-3 0v3m6 2 2-2M12 10v4l2 1m6-1a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  songlist: 'M5 5h9M5 9h7M5 13h5m7-5v10m0-10 4-1v3l-4 1m0 7a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z',
  lyrics: 'M4 6h16M4 12h16M7 18h10',
  '直播小游戏': 'M8 7h8a5 5 0 0 1 5 4l1 5a3 3 0 0 1-5 3l-3-3h-4l-3 3a3 3 0 0 1-5-3l1-5a5 5 0 0 1 5-4Zm-1 3v5m-2-2h4m7-2h.01m2 3h.01',
  'gift-feed': 'M3 8h18v4H3Zm2 4v9h14v-9M12 8v13m0-13H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z',
  'gift-frame': 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h10v10H7Z',
  'guard-thanks': 'M12 3v16m-4-9h8m-4-7a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM4 13v3c0 6 16 6 16 0v-3m-18 2 2-2 2 2m12 0 2-2 2 2',
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

export function mountComponentPreviewPicker({ components, source, add, report, getTextBoxes = () => [], requestStyles }) {
  const dialog = previewElement('dialog', 'preview-component-picker');
  dialog.setAttribute('aria-labelledby', 'componentPickerTitle');
  const header = previewElement('header', 'preview-picker-heading');
  const title = previewElement('h2', '', '添加组件');
  title.id = 'componentPickerTitle';
  const close = previewElement('button', 'secondary preview-picker-close');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭');
  close.title = '关闭';
  close.append(pickerIcon('m6 6 12 12M18 6 6 18'));
  close.addEventListener('click', () => dialog.close());
  header.append(title, close);
  const body = previewElement('div', 'preview-picker-body');
  const categories = previewElement('nav', 'preview-picker-categories');
  categories.setAttribute('aria-label', '组件分类');
  const content = previewElement('section', 'preview-picker-content');
  const subcategories = previewElement('nav', 'preview-picker-subcategories');
  subcategories.setAttribute('aria-label', '小游戏分类');
  const styles = previewElement('div');
  const browserForm = previewElement('form', 'preview-browser-form');
  let styleLibrary;
  browserForm.hidden = true;
  content.append(subcategories, styles, browserForm);
  body.append(categories, content);
  dialog.append(header, body);
  document.body.append(dialog);
  const choices = new Map();
  const groups = new Map();
  const textPreviews = new ResizeObserver(entries => {
    const samples = new Set(entries.map(({ target }) => target.closest('.preview-picker-text-preview')));
    for (const sample of samples) {
      const text = sample.firstElementChild;
      if (!text.offsetWidth || !text.offsetHeight) continue;
      sample.style.aspectRatio = String(Math.min(2.4, Math.max(1, text.offsetWidth / text.offsetHeight)));
      const width = sample.clientWidth - 32;
      const height = sample.clientHeight - 32;
      if (width <= 0 || height <= 0) continue;
      const scale = Math.min(2, width / text.offsetWidth, height / text.offsetHeight);
      text.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }
  });
  dialog.addEventListener('close', () => { textPreviews.disconnect(); styleLibrary?.dispose(); });
  for (const component of components) {
    if (component.id === 'browser') continue;
    const category = COMPONENT_PREVIEW_DEFINITIONS[component.id].category || component.id;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(component);
  }

  function textBoxCards(component) {
    const cards = [];
    for (const item of [null, ...getTextBoxes()]) {
      const button = previewElement('button', 'preview-picker-style preview-picker-text-card');
      button.type = 'button';
      button.setAttribute('aria-label', item ? `添加副本：${item.name}` : '新建文本框');
      const sample = previewElement('div', 'preview-picker-text-preview');
      sample.setAttribute('aria-hidden', 'true');
      if (item) {
        button.dataset.textBoxSource = item.id;
        const text = previewElement('div');
        renderTextBox(text, item.appearance.config);
        for (const image of text.querySelectorAll('img')) image.loading = 'lazy';
        sample.append(text);
        textPreviews.observe(sample);
        textPreviews.observe(text);
      } else {
        button.dataset.pickerStyle = 'default';
        sample.classList.add('preview-picker-text-new');
        sample.append(pickerIcon('M12 5v14M5 12h14'));
      }
      const caption = previewElement('span', 'preview-picker-caption');
      caption.append(previewElement('strong', '', item?.name || '新建文本框'));
      if (item) {
        button.title = item.name;
        caption.append(previewElement('span', 'preview-picker-add', '添加副本'));
      }
      button.append(sample, caption);
      button.addEventListener('click', () => {
        try {
          if (item) {
            const current = getTextBoxes().find(candidate => candidate.id === item.id);
            if (!current) throw new Error('这个文本框已被移除，请重新打开添加组件。');
            add(component, structuredClone(current.appearance.config), {
              name: `${current.name.slice(0, 75)} 副本`, size: [current.width, current.height],
            });
          } else add(component, createTextBoxDefaults());
          dialog.close();
        } catch (error) { report(error.message); }
      });
      cards.push(button);
    }
    return cards;
  }

  function importAtTarget(target, file, pack) {
    if (target === 'suite') showSuites(file, pack);
    else {
      const component = components.find(entry => entry.id === target);
      if (component) show(component, file, pack);
      else report('当前画布不支持这个组件，请更新客户端。');
    }
  }

  function show(component, initialFile, updatePack) {
    styleLibrary?.dispose();
    textPreviews.disconnect();
    content.classList.add('has-style-grid');
    const category = COMPONENT_PREVIEW_DEFINITIONS[component.id].category || component.id;
    for (const [id, button] of choices) button.setAttribute('aria-pressed', String(id === category));
    styles.hidden = false;
    browserForm.hidden = true;
    subcategories.replaceChildren();
    subcategories.setAttribute('aria-label', category === '直播小游戏' ? '小游戏分类' : '组件类型');
    const members = groups.get(category);
    subcategories.hidden = false;
    if (members.length > 1) for (const member of members) {
      const button = previewElement('button', 'secondary', member.title);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(member.id === component.id));
      button.addEventListener('click', () => show(member));
      subcategories.append(button);
    }
    content.setAttribute('aria-label', `${component.title}样式`);
    content.scrollTop = 0;
    styleLibrary = mountComponentStyleLibrary(styles, {
      type: component.id, request: requestStyles, inline: true,
      onImportTarget: importAtTarget, initialFile, updatePack,
      renderList: componentStyleList(component),
      onUse(style) { add(components.find(entry => entry.id === style.type) || component, style.config,
        { name: style.name, size: [componentStyleMedia(style.config).width, componentStyleMedia(style.config).height] }); dialog.close(); },
    });
  }

  function componentStyleList(component) {
    const danmaku = component.id === 'danmaku';
    const types = danmaku ? [['fixed', '固定弹幕'], ['fullscreen-random', '随机弹幕'], ['floating', '飘窗弹幕']] : [];
    const group = style => danmaku ? DANMAKU_STYLE_OPTIONS[style]?.layout || 'fixed' : 'all';
    const builtinCards = component.id === 'text-box' ? textBoxCards(component)
      : styleOptions(component).map(option => styleCard(component, option));
    const builtins = builtinCards.map(card => ({ group: group(card.dataset.pickerStyle), card }));
    let active = danmaku ? 'fixed' : 'all';
    let entries = builtins;
    if (danmaku) subcategories.setAttribute('aria-label', '弹幕类型');
    const tabs = types.map(([id, label]) => {
      const button = previewElement('button', 'secondary', label);
      button.type = 'button';
      button.addEventListener('click', () => { active = id; filter(); content.scrollTop = 0; });
      subcategories.append(button);
      return { id, button };
    });
    function filter() {
      for (const { id, button } of tabs) button.setAttribute('aria-pressed', String(id === active));
      for (const entry of entries) entry.card.hidden = entry.group !== active;
    }
    return ({ list, cards, add, manage }) => {
      list.classList.add('preview-picker-styles');
      entries = [...builtins, ...cards.map(({ style, card }) => ({ group: group(style.config.style), card }))];
      list.replaceChildren(...entries.map(entry => entry.card));
      add.className = 'secondary preview-picker-import';
      add.replaceChildren(pickerIcon('M12 5v14M5 12h14'), previewElement('span', '', '添加样式'));
      subcategories.append(add, manage);
      filter();
    };
  }

  function styleOptions(component) {
    const definition = COMPONENT_PREVIEW_DEFINITIONS[component.id];
    const attribute = definition.styleAttribute;
    return definition.variants?.map(variant => ({ variant }))
      || (attribute ? [...source.querySelectorAll(`[${attribute}]`)] : [null]).map(original => ({ original }));
  }

  function styleCard(component, { original, variant }) {
    const definition = COMPONENT_PREVIEW_DEFINITIONS[component.id];
    const preset = variant || definition.defaultStyle;
    const label = original ? original.querySelector('strong, .danmaku-style-name').textContent : preset.label;
    const style = variant?.value || original?.getAttribute(definition.styleAttribute) || 'default';
    const button = previewElement('button', 'preview-picker-style');
    button.type = 'button';
    button.setAttribute('aria-label', `添加${label}`);
    button.dataset.pickerStyle = style;
    button.dataset.pickerComponent = component.id;
    const image = previewElement('img', 'preview-picker-image');
    const sourceImage = variant?.image || original?.querySelector('img')?.getAttribute('src');
    image.src = sourceImage || `/img/component-previews/${component.id}-${style}.webp`;
    image.alt = `${label}示例效果`;
    image.width = 640;
    image.height = 400;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.draggable = false;
    image.addEventListener('load', () => {
      const bounds = !sourceImage && PREVIEW_IMAGE_BOUNDS[`${component.id}-${style}`];
      const [x, y, width, height] = bounds || [0, 0, image.naturalWidth, image.naturalHeight];
      if (bounds) image.style.objectViewBox = `inset(${y / image.naturalHeight * 100}% ${(image.naturalWidth - x - width) / image.naturalWidth * 100}% ${(image.naturalHeight - y - height) / image.naturalHeight * 100}% ${x / image.naturalWidth * 100}%)`;
      if (component.id !== 'danmaku') image.style.aspectRatio = String(Math.min(2.5, Math.max(1, width / height)));
    }, { once: true });
    const caption = previewElement('span', 'preview-picker-caption');
    caption.append(previewElement('strong', '', label));
    button.append(image, caption);
    button.addEventListener('click', () => {
      try {
        const { draft, loaded } = component.controller.getState();
        if (!loaded) throw new Error('组件尚未连接，请从客户端重新打开。');
        const change = definition.styleChange(draft, button.dataset.pickerStyle);
        const config = { ...(component.projectConfig?.(draft) || draft), ...change };
        if (component.id === 'danmaku') {
          delete config.mediaStyle; delete config.resourceStyle; delete config.cssStyle;
        }
        add(variant ? { ...component, title: label } : component, config);
        dialog.close();
      } catch (error) { report(error.message); }
    });
    return button;
  }

  function showSuites(initialFile, updatePack) {
    styleLibrary?.dispose();
    content.classList.remove('has-style-grid');
    styleLibrary = mountComponentStyleLibrary(styles, { request: requestStyles, suitesOnly: true,
      onImportTarget: importAtTarget, initialFile, updatePack,
      onUse(style) {
        const component = components.find(entry => entry.id === style.type);
        if (!component) throw new Error('当前画布不支持这个组件，请重新打开。');
        const media = componentStyleMedia(style.config);
        add(component, style.config, { name: style.name, size: [media.width, media.height] }); dialog.close();
      },
    });
    textPreviews.disconnect();
    for (const [id, button] of choices) button.setAttribute('aria-pressed', String(id === 'suites'));
    styles.hidden = false;
    browserForm.hidden = subcategories.hidden = true;
    subcategories.replaceChildren();
    content.setAttribute('aria-label', '套装'); content.scrollTop = 0;
  }
  const suites = previewElement('button');
  suites.type = 'button';
  suites.dataset.category = 'suites';
  suites.append(pickerIcon('M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z'), previewElement('span', '', '套装'));
  suites.addEventListener('click', () => showSuites());
  choices.set('suites', suites);
  categories.append(suites);

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
  const browser = components.find(({ id }) => id === 'browser');
  if (browser) {
    const more = previewElement('button', 'preview-picker-more');
    more.type = 'button';
    more.dataset.category = 'browser';
    more.append(pickerIcon('M12 5v14M5 12h14'), previewElement('span', '', '更多'));
    more.addEventListener('click', () => {
      styleLibrary?.dispose();
      content.classList.remove('has-style-grid');
      textPreviews.disconnect();
      for (const [id, button] of choices) button.setAttribute('aria-pressed', String(id === 'browser'));
      subcategories.hidden = styles.hidden = true;
      browserForm.hidden = false;
      content.setAttribute('aria-label', '导入浏览器源');
      content.scrollTop = 0;
    });
    choices.set('browser', more);
    categories.append(more);
    const nameLabel = previewElement('label', '', '组件名称');
    const name = previewElement('input');
    name.type = 'text'; name.required = true; name.maxLength = 80; name.defaultValue = '浏览器源';
    nameLabel.append(name);
    browserForm.append(previewElement('p', 'hint', '粘贴其他工具提供的浏览器源链接。网页需允许嵌入，内容与样式在原工具中设置。'), nameLabel);
    const fields = mountBrowserSourceFields(browserForm);
    const error = previewElement('p', 'preview-browser-error');
    error.setAttribute('role', 'alert'); error.hidden = true;
    const submit = previewElement('button', 'primary', '添加到画布');
    submit.type = 'submit';
    browserForm.append(error, submit);
    browserForm.addEventListener('input', () => { error.hidden = true; });
    browserForm.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        if (!name.value.trim()) throw new Error('请填写组件名称。');
        add(browser, fields.read(), { name: name.value.trim() });
        dialog.close();
        browserForm.reset();
      } catch (failure) { error.textContent = failure.message; error.hidden = false; }
    });
  }
  return {
    open() {
      const selected = categories.querySelector('[aria-pressed="true"]');
      if (selected) selected.click();
      else show(groups.values().next().value[0]);
      dialog.showModal();
    },
    dispose() { styleLibrary?.dispose(); textPreviews.disconnect(); dialog.close(); dialog.remove(); },
  };
}
