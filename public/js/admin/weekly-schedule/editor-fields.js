import { WEEKLY_LAYOUTS, WEEKLY_PALETTES, WEEKLY_ICONS, WEEKLY_FONTS, WEEKLY_TEXT_LIMITS, WEEKLY_IMAGE_RANGES, WEEKLY_BACKGROUND_RANGES, WEEKLY_TYPE_RANGES, WEEKLY_PATTERNS, getWeekDates } from './model.js';
import { createWeeklyScheduleIcon } from './icons.js';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ASSETS = [
  ['portrait', '主播立绘'], ['chibi', 'Q 版小人'], ['logo', '主播 Logo'],
  ['background', '背景图片'], ['qrcode', '粉丝群二维码'],
  ['rank1', '榜一头像'], ['rank2', '榜二头像'], ['rank3', '榜三头像'], ['icon', '自定义图标'],
];

export function renderWeeklyScheduleFields(container, template) {
  const doc = container.ownerDocument;
  const fragment = doc.createDocumentFragment();
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const tabs = element('div', 'weekly-editor-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '周表编辑分类');
  fragment.append(tabs);
  const panels = {};
  for (const [id, label] of [['appearance', '外观'], ['schedule', '排期'], ['assets', '素材'], ['modules', '模块']]) {
    const tab = button(tabs, label, 'weeklyTab', id);
    tab.id = `weekly-tab-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `weekly-panel-${id}`);
    const panel = element('div', 'weekly-category');
    panel.id = `weekly-panel-${id}`;
    panel.dataset.weeklyPanel = id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panels[id] = panel;
    fragment.append(panel);
  }
  function group(title, open = false, category = 'appearance') {
    const details = element('details', 'weekly-editor-group');
    details.dataset.weeklyGroup = title;
    details.open = open;
    details.append(element('summary', '', title));
    const body = element('div', 'weekly-group-content');
    details.append(body);
    panels[category].append(details);
    return body;
  }
  function field(parent, label, path, value, { type = 'text', maxLength, options, min, max, step, unit = '' } = {}) {
    const wrapper = element(type === 'range' ? 'div' : 'label', type === 'checkbox' ? 'weekly-check' : 'weekly-field');
    const input = element(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.dataset.weeklyField = path;
    if (!options && type !== 'textarea') input.type = type;
    if (type === 'color') input.dataset.colorAlpha = 'false';
    if (maxLength) input.maxLength = maxLength;
    if (type === 'textarea') input.rows = 3;
    if (type === 'range') {
      input.min = min;
      input.max = max;
      input.step = step || 1;
      input.className = 'parameter-range';
    }
    if (options) options.forEach(option => {
      const node = element('option', '', option.label);
      node.value = option.value ?? option.id;
      input.append(node);
    });
    if (type === 'checkbox') {
      input.checked = value;
      wrapper.append(input, element('span', '', label));
    } else {
      const heading = element('span', 'weekly-field-heading');
      if (type === 'range') {
        input.id = `weekly-${path.replaceAll('.', '-')}`;
        const caption = element('label', '', label);
        caption.htmlFor = input.id;
        const number = element('input');
        Object.assign(number, { type: 'number', min, max, step: step || 1, value });
        number.dataset.weeklyNumber = path;
        number.setAttribute('aria-label', `${label}数值`);
        const exact = element('span', 'weekly-number');
        const suffix = element('span', '', unit);
        suffix.setAttribute('aria-hidden', 'true');
        exact.append(number, suffix);
        heading.append(caption, exact);
      } else heading.textContent = label;
      input.value = value;
      wrapper.append(heading, input);
    }
    parent.append(wrapper);
    return input;
  }
  function parameter(parent, label, path, value, range) {
    return field(parent, label, path, value, { ...range, type: 'range' });
  }
  function textField(parent, label, path, value, limit) {
    return field(parent, label, path, value, { maxLength: WEEKLY_TEXT_LIMITS[limit] });
  }
  function button(parent, label, dataKey, value) {
    const node = element('button', '', label);
    node.type = 'button';
    node.dataset[dataKey] = value;
    parent.append(node);
    return node;
  }
  const appearance = group('排版与配色', true);
  const layouts = element('div', 'weekly-layout-grid');
  layouts.setAttribute('aria-label', '排版样式');
  for (const layout of WEEKLY_LAYOUTS) {
    const choice = button(layouts, '', 'weeklyLayout', layout.id);
    choice.setAttribute('aria-pressed', String(template.layout === layout.id));
    const sketch = element('span', 'weekly-layout-sketch');
    sketch.dataset.layout = layout.id;
    sketch.setAttribute('aria-hidden', 'true');
    sketch.append(element('span', 'weekly-sketch-title'));
    const week = element('span', 'weekly-sketch-week');
    for (let index = 0; index < 7; index++) week.append(element('i'));
    const modules = element('span', 'weekly-sketch-modules');
    modules.append(element('i'), element('i'));
    sketch.append(week, modules);
    choice.append(sketch, element('span', '', layout.label));
  }
  appearance.append(layouts);
  const palettes = element('div', 'weekly-palette-grid');
  palettes.setAttribute('aria-label', '预设配色');
  WEEKLY_PALETTES.forEach(palette => {
    const choice = button(palettes, palette.label, 'weeklyPalette', palette.id);
    choice.style.setProperty('--weekly-swatch', palette.primaryColor);
    choice.style.setProperty('--weekly-swatch-accent', palette.accentColor);
    choice.setAttribute('aria-pressed', String(template.primaryColor === palette.primaryColor && template.accentColor === palette.accentColor));
  });
  appearance.append(palettes);
  const colors = element('div', 'weekly-field-row');
  field(colors, '主色', 'primaryColor', template.primaryColor, { type: 'color' });
  field(colors, '撞色', 'accentColor', template.accentColor, { type: 'color' });
  appearance.append(colors);
  textField(appearance, '大标题', 'title', template.title, 'title');
  textField(appearance, '周范围小标签', 'weekLabel', template.weekLabel, 'weekLabel');
  textField(appearance, '主播名字', 'streamerName', template.streamerName, 'streamerName');
  field(appearance, '日程字体', 'fontId', template.fontId, { options: WEEKLY_FONTS });
  const typography = element('details', 'weekly-parameter-details');
  typography.append(element('summary', '', '文字大小'));
  const typeFields = element('div', 'weekly-group-content');
  for (const [key, label] of [['title', '大标题'], ['theme', '直播主题'], ['note', '备注'], ['time', '开播时间']]) {
    parameter(typeFields, label, `typography.${key}`, template.typography[key], WEEKLY_TYPE_RANGES[key]);
  }
  typeFields.append(element('p', 'weekly-field-help', '100% 为版式推荐大小。长文字会自动缩小，仍放不下时会提示。'));
  button(typeFields, '恢复推荐字号', 'weeklyReset', 'typography');
  typography.append(typeFields);
  appearance.append(typography);
  field(appearance, '星期写法', 'weekdayFormat', template.weekdayFormat, { options: [
    { id: 'en', label: 'MON · 英文缩写' }, { id: 'zh', label: '周一 · 中文' }, { id: 'short', label: '一 · 简写' },
  ] });
  field(appearance, '整张左右对调', 'flippedLayout', template.flippedLayout, { type: 'checkbox' });

  const icons = group('人设图标');
  const choices = element('div', 'weekly-icon-grid');
  WEEKLY_ICONS.forEach(icon => {
    const choice = button(choices, icon.label, 'weeklyIcon', icon.id);
    const symbol = createWeeklyScheduleIcon(doc, icon.id);
    symbol.setAttribute('aria-hidden', 'true');
    choice.prepend(symbol);
    choice.setAttribute('aria-pressed', String(template.icon === icon.id));
  });
  const customIcon = button(choices, '自定义', 'weeklyIcon', 'custom');
  customIcon.hidden = !template.assets.icon;
  customIcon.setAttribute('aria-pressed', String(template.icon === 'custom'));
  icons.append(choices);
  field(icons, '自定义图标跟随主题变色', 'iconTint', template.iconTint, { type: 'checkbox' });
  icons.append(element('p', 'weekly-field-help', '在「图片素材」上传自定义图标，可随时切回内置图标。建议正方形 512 × 512。'));

  const assets = group('图片素材', true, 'assets');
  assets.append(element('p', 'weekly-field-help', 'PNG / JPG / WebP，单张最多 12 MiB，每模板合计 48 MiB；最大边 8192 像素、总像素 33,554,432。图标也支持静态 SVG。'));
  const uploads = element('div', 'weekly-upload-grid');
  ASSETS.forEach(([key, title]) => {
    const slot = element('div', 'weekly-upload');
    slot.dataset.weeklyUploadSlot = key;
    const label = element('label');
    label.append(element('span', '', title));
    const input = element('input');
    input.type = 'file';
    input.accept = `image/png,image/jpeg,image/webp${key === 'icon' ? ',image/svg+xml' : ''}`;
    input.dataset.weeklyAsset = key;
    label.append(input);
    const preview = element('img');
    preview.alt = `${title}缩略图`;
    preview.hidden = !template.assets[key];
    if (template.assets[key]) preview.src = template.assets[key];
    const status = element('span', 'weekly-upload-status', template.assets[key] ? '已上传' : '未上传');
    const remove = button(slot, '移除', 'weeklyRemoveAsset', key);
    remove.hidden = !template.assets[key];
    slot.prepend(label, preview, status);
    uploads.append(slot);
  });
  assets.append(uploads);
  for (const [key, label] of [['portrait', '立绘'], ['logo', 'Logo'], ['chibi', 'Q 版']]) {
    const transform = element('fieldset', 'weekly-transform');
    transform.dataset.weeklyTransform = key;
    transform.hidden = !template.assets[key];
    transform.append(element('legend', '', `${label}调整`));
    for (const [fieldKey, title] of [['scale', '大小'], ['x', '左右位置'], ['y', '上下位置'], ['rotation', '旋转角度'], ['opacity', '不透明度']]) {
      parameter(transform, title, `${key}.${fieldKey}`, template[key][fieldKey], WEEKLY_IMAGE_RANGES[fieldKey]);
    }
    field(transform, `左右翻转${label}`, `${key}.flip`, template[key].flip, { type: 'checkbox' });
    if (key === 'portrait') {
      field(transform, '立绘贴纸白边', 'portrait.outline', template.portrait.outline, { type: 'checkbox' });
    }
    button(transform, '恢复默认调整', 'weeklyReset', key);
    assets.append(transform);
  }
  const background = element('fieldset', 'weekly-transform');
  background.dataset.weeklyTransform = 'background';
  background.hidden = !template.assets.background;
  background.append(element('legend', '', '背景图调整'));
  field(background, '图片适配', 'background.fit', template.background.fit, { options: [
    { id: 'cover', label: '铺满画布（裁切边缘）' }, { id: 'contain', label: '完整显示（保留留白）' },
  ] });
  for (const [key, label] of [['x', '水平焦点'], ['y', '垂直焦点'], ['opacity', '不透明度'], ['blur', '背景模糊']]) {
    parameter(background, label, `background.${key}`, template.background[key], WEEKLY_BACKGROUND_RANGES[key]);
  }
  background.append(element('p', 'weekly-field-help', '焦点位置决定裁切或留白方向；无需移动文字和信息模块。'));
  button(background, '恢复背景调整', 'weeklyReset', 'background');
  assets.append(background);

  const schedule = group('一周安排', true, 'schedule');
  field(schedule, '本周周一', 'monday', template.monday, { type: 'date' });
  const weeks = element('div', 'weekly-week-actions');
  button(weeks, '上一周', 'weeklyAction', 'previous-week');
  button(weeks, '回到本周', 'weeklyAction', 'this-week');
  button(weeks, '下一周', 'weeklyAction', 'next-week');
  schedule.append(weeks);
  field(schedule, '显示日期', 'showDates', template.showDates, { type: 'checkbox' });
  const dayActions = element('div', 'weekly-day-actions');
  button(dayActions, '全部展开', 'weeklyAction', 'expand-days');
  button(dayActions, '将周一时间应用整周', 'weeklyAction', 'apply-times');
  schedule.append(dayActions);
  const dates = getWeekDates(template.monday);
  template.days.forEach((day, index) => {
    const details = element('details', 'weekly-day-editor');
    details.dataset.weeklyDay = index;
    details.open = index === 0;
    const summary = element('summary');
    summary.append(element('span', 'weekly-day-label', `${WEEKDAYS[index]} · ${dates[index].slice(5).replace('-', '/')}`),
      element('span', 'weekly-day-description', day.theme || (day.rest ? '休息' : '待安排')));
    details.append(summary);
    const content = element('div', 'weekly-group-content');
    const prefix = `days.${index}`;
    textField(content, '直播主题', `${prefix}.theme`, day.theme, 'theme');
    textField(content, '加播 / 备注', `${prefix}.note`, day.note, 'note');
    const times = element('div', 'weekly-field-row');
    textField(times, '时间 1', `${prefix}.time1`, day.time1, 'time');
    textField(times, '时间 2', `${prefix}.time2`, day.time2, 'time');
    content.append(times);
    field(content, '当天休息', `${prefix}.rest`, day.rest, { type: 'checkbox' });
    field(content, '活动场高亮', `${prefix}.highlight`, day.highlight, { type: 'checkbox' });
    textField(content, '活动标签', `${prefix}.highlightLabel`, day.highlightLabel, 'highlightLabel');
    details.append(content);
    schedule.append(details);
  });

  const modules = group('信息模块', true, 'modules');
  for (const [key, label] of [['message', '留言板'], ['rank', '上周榜单'], ['qr', '粉丝群二维码'], ['benefits', '福利便签']]) {
    const section = element('fieldset', 'weekly-module-editor');
    section.append(element('legend', '', label));
    const value = template.modules[key];
    field(section, `显示${label}`, `modules.${key}.enabled`, value.enabled, { type: 'checkbox' });
    if (key !== 'qr') textField(section, '标题', `modules.${key}.title`, value.title, 'moduleTitle');
    if (key === 'rank') {
      textField(section, '说明小字', 'modules.rank.subtitle', value.subtitle, 'rankSubtitle');
      value.names.forEach((name, index) => textField(section, `榜${['一', '二', '三'][index]}昵称`, `modules.rank.names.${index}`, name, 'rankName'));
      section.append(element('p', 'weekly-field-help', '头像在「图片素材」上传；未上传时使用所选人设图标。'));
    } else if (key === 'qr') {
      textField(section, '二维码下方文字', 'modules.qr.caption', value.caption, 'qrCaption');
    } else {
      field(section, key === 'message' ? '留言正文（可留空手写）' : '福利内容（每行一条）', `modules.${key}.text`, value.text, { type: 'textarea', maxLength: WEEKLY_TEXT_LIMITS[key] });
    }
    modules.append(section);
  }
  const decorations = group('花纹与装饰');
  field(decorations, '背景花纹', 'decorations.pattern', template.decorations.pattern, { options: WEEKLY_PATTERNS });
  parameter(decorations, '花纹浓度', 'decorations.intensity', template.decorations.intensity, { min: 0, max: 100, unit: '%' });
  for (const [key, label] of [['lace', '上下花边'], ['sparkles', '星星闪光'], ['tape', '纸胶带'], ['bow', '书脊蝴蝶结'], ['backgroundIcons', '背景小图标']]) {
    field(decorations, label, `decorations.${key}`, template.decorations[key], { type: 'checkbox' });
  }
  for (const panel of Object.values(panels)) {
    if (panel.childElementCount !== 1) continue;
    const details = panel.firstElementChild;
    const section = element('section', 'weekly-editor-group');
    section.append(element('h3', 'weekly-group-title', details.firstElementChild.textContent), details.lastElementChild);
    details.replaceWith(section);
  }
  container.replaceChildren(fragment);
  return container.querySelector('[data-weekly-field="fontId"]');
}

export function refreshWeeklyScheduleAsset(container, template, key) {
  const slot = container.querySelector(`[data-weekly-upload-slot="${key}"]`);
  const value = template.assets[key];
  const image = slot.querySelector('img');
  if (value) image.src = value;
  else image.removeAttribute('src');
  image.hidden = !value;
  slot.querySelector('.weekly-upload-status').textContent = value ? '已上传' : '未上传';
  slot.querySelector('button').hidden = !value;
  const transform = container.querySelector(`[data-weekly-transform="${key}"]`);
  if (transform) transform.hidden = !value;
  if (key === 'icon') {
    container.querySelector('[data-weekly-icon="custom"]').hidden = !value;
    container.querySelectorAll('[data-weekly-icon]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.weeklyIcon === template.icon));
    });
  }
}
