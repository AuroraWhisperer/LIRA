import { getWeekDates, getWeeklyImagePath } from './model.js';
import { createWeeklyScheduleIcon } from './icons.js';

const WEEKDAYS = {
  en: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  short: ['一', '二', '三', '四', '五', '六', '日'],
};

function mixColor(first, second, weight) {
  const channels = [1, 3, 5].map(offset => {
    const a = Number.parseInt(first.slice(offset, offset + 2), 16);
    const b = Number.parseInt(second.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * weight).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function luminance(color) {
  const channels = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function contrastColor(color) {
  const ink = '#243040';
  const paper = '#fffdf8';
  const preferred = contrast(color, ink) >= contrast(color, paper) ? ink : paper;
  if (contrast(color, preferred) >= 4.5) return preferred;
  return contrast(color, '#000000') >= contrast(color, '#ffffff') ? '#000000' : '#ffffff';
}

function readableTint(color, backgrounds, target = '#172334') {
  for (let step = 0; step <= 20; step++) {
    const candidate = mixColor(color, target, step / 20);
    if (backgrounds.every(background => contrast(candidate, background) >= 4.5)) return candidate;
  }
  return target;
}

function setPalette(root, template) {
  const primary = template.primaryColor;
  const accent = template.accentColor;
  const colors = {
    primary,
    accent,
    paper: mixColor(primary, '#ffffff', 0.94),
    base: mixColor(primary, '#ffffff', 0.78),
    soft: mixColor(primary, '#ffffff', 0.54),
    line: mixColor(primary, '#ffffff', 0.24),
    ink: mixColor(primary, '#172334', 0.85),
    muted: mixColor(primary, '#6a7180', 0.76),
    'accent-soft': mixColor(accent, '#ffffff', 0.78),
    'on-primary': contrastColor(primary),
    'on-accent': contrastColor(accent),
  };
  const papers = [colors.paper, colors['accent-soft']];
  if (template.layout === 'letterpress') papers.push(mixColor(primary, '#fbf6eb', 0.9));
  const darkPaper = { celestial: mixColor(primary, '#243c52', 0.82), nocturne: mixColor(primary, '#1b2532', 0.8) }[template.layout];
  colors['accent-ink'] = darkPaper
    ? readableTint(accent, [darkPaper], '#fff1cb')
    : readableTint(accent, papers);
  if (template.layout === 'nocturne') colors.line = mixColor(accent, '#344252', 0.65);
  colors.muted = readableTint(colors.muted, papers);
  for (const [name, color] of Object.entries(colors)) {
    const prefix = ['paper', 'base', 'soft', 'ink', 'muted'].includes(name) ? '--wsa-color-' : '--wsa-';
    root.style.setProperty(`${prefix}${name}`, color);
  }
  root.style.setProperty('--wsa-font', template.fontId);
  for (const key of ['title', 'theme', 'note', 'time']) {
    root.style.setProperty(`--wsa-${key}-scale`, (template.typography?.[key] ?? 100) / 100);
  }
  root.style.setProperty('--wsa-pattern-intensity', (template.decorations.intensity ?? 100) / 100);
}

function createArtBuilder(documentRef, template) {
  const node = (tag, className, text) => {
    const result = documentRef.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const image = (source, className, alt) => {
    const result = node('img', className);
    result.src = source;
    result.alt = alt;
    result.draggable = false;
    return result;
  };
  const icon = (className = '') => {
    const wrapper = node('span', `wsa-icon ${className}`);
    wrapper.setAttribute('aria-hidden', 'true');
    if (template.icon === 'custom' && template.assets.icon) {
      wrapper.classList.add('wsa-custom-icon');
      const artwork = node('span', 'wsa-custom-art');
      artwork.append(image(template.assets.icon, '', ''));
      if (template.iconTint) {
        artwork.classList.add('is-tinted');
        artwork.style.maskImage = `url("${template.assets.icon}")`;
      }
      applyWeeklyImageSettings(artwork, template, 'icon');
      wrapper.append(artwork);
    } else wrapper.append(createWeeklyScheduleIcon(documentRef, template.icon));
    return wrapper;
  };
  return { node, image, icon };
}

function buildDecorations(template, { node, image, icon }, documentRef) {
  const decorations = node('div', 'wsa-decorations');
  decorations.setAttribute('aria-hidden', 'true');
  if (template.assets.background) {
    const background = image(template.assets.background, 'wsa-background-image', '');
    applyWeeklyImageSettings(background, template, 'background');
    decorations.append(background);
  }
  else {
    const pattern = node('div', 'wsa-pattern');
    pattern.dataset.pattern = template.decorations.pattern;
    decorations.append(pattern);
  }
  if (template.decorations.backgroundIcons) {
    const scatter = node('div', 'wsa-scatter');
    for (let index = 0; index < 14; index += 1) scatter.append(icon());
    decorations.append(scatter);
  }
  if (template.decorations.lace) decorations.append(node('div', 'wsa-lace wsa-lace-top'), node('div', 'wsa-lace wsa-lace-bottom'));
  if (template.decorations.sparkles) {
    const sparkles = node('div', 'wsa-sparkles');
    for (let index = 0; index < 6; index += 1) sparkles.append(node('span', 'wsa-sparkle'));
    decorations.append(sparkles);
  }
  const book = node('div', 'wsa-book');
  const spine = node('div', 'wsa-spine');
  for (let index = 0; index < 4; index += 1) spine.append(node('span', 'wsa-ring'));
  if (template.decorations.bow) {
    const bow = node('div', 'wsa-spine-bow');
    bow.append(createWeeklyScheduleIcon(documentRef, 'bow'));
    spine.append(bow);
  }
  decorations.append(book, spine, node('div', 'wsa-orbit'), node('div', 'wsa-scroll-rod wsa-scroll-rod-left'), node('div', 'wsa-scroll-rod wsa-scroll-rod-right'));
  return decorations;
}

function buildHeading(template, dates, { node }) {
  const heading = node('header', 'wsa-heading');
  const title = node('h2', 'wsa-title', template.title);
  title.style.setProperty('--wsa-title-size', `${Math.max(48, 104 - Math.max(0, Array.from(template.title).length - 10) * 2)}px`);
  const range = node('div', 'wsa-date-label');
  range.append(node('span', 'wsa-week-label', template.weekLabel));
  if (template.showDates) range.append(node('span', 'wsa-range', `${dates[0].slice(5).replace('-', '.')} — ${dates[6].slice(5).replace('-', '.')}`));
  heading.append(title, range);
  return heading;
}

function buildDays(template, dates, { node, icon }) {
  const week = node('section', 'wsa-week');
  week.setAttribute('aria-label', '一周直播安排');
  template.days.forEach((day, index) => {
    const row = node('div', 'wsa-day');
    row.classList.toggle('is-rest', day.rest);
    row.classList.toggle('is-highlight', day.highlight && !day.rest);
    row.classList.toggle('has-note', Boolean(day.note));
    const weekday = node('div', 'wsa-weekday');
    weekday.append(node('strong', '', (WEEKDAYS[template.weekdayFormat] || WEEKDAYS.en)[index]));
    if (template.showDates) weekday.append(node('small', 'wsa-day-date', dates[index].slice(5).replace('-', '/')));
    const program = node('div', 'wsa-program');
    const theme = node('strong', 'wsa-theme', day.theme || (day.rest ? '休息' : ''));
    const columnWidth = { celestial: 390, magazine: 300 }[template.layout] || 500;
    theme.style.setProperty('--wsa-theme-size', `${Math.max(18, Math.min(34, columnWidth / Math.max(1, textUnits(day.theme))))}px`);
    program.append(theme);
    if (day.note) {
      const note = node('span', 'wsa-note', day.note);
      note.style.setProperty('--wsa-note-size', `${Math.max(16, Math.min(25, columnWidth / textUnits(day.note)))}px`);
      program.append(note);
    }
    const times = node('div', 'wsa-times');
    times.style.setProperty('--wsa-time-size', `${Math.max(16, Math.min(28, 200 / Math.max(1, textUnits(day.time1), textUnits(day.time2))))}px`);
    if (!day.rest) {
      for (const time of [day.time1, day.time2]) {
        if (time) times.append(node('span', '', time));
      }
    }
    row.append(weekday, program, times, icon('wsa-day-icon'));
    if (day.highlight && !day.rest && day.highlightLabel) row.append(node('span', 'wsa-event-label', day.highlightLabel));
    week.append(row);
  });
  return week;
}

function textUnits(text) {
  return Array.from(text).reduce((total, character) => total + (/[^\x00-\xff]/.test(character) ? 1 : 0.55), 0);
}

function buildModules(template, { node, image, icon }) {
  const modules = node('aside', 'wsa-modules');
  const makeModule = (name, title) => {
    const section = node('section', `wsa-module wsa-${name}`);
    if (title) section.append(node('h3', 'wsa-module-title', title));
    if (template.decorations.tape && (name === 'message' || name === 'qr')) section.append(node('span', 'wsa-tape'));
    return section;
  };
  if (template.modules.message.enabled) {
    const message = makeModule('message', template.modules.message.title);
    message.append(node('p', 'wsa-message-text', template.modules.message.text));
    modules.append(message);
  }
  if (template.modules.rank.enabled) {
    const ranking = makeModule('ranking', template.modules.rank.title);
    ranking.append(node('span', 'wsa-paperclip'));
    if (template.modules.rank.subtitle) ranking.append(node('p', 'wsa-rank-subtitle', template.modules.rank.subtitle));
    const ranks = node('div', 'wsa-ranks');
    template.modules.rank.names.forEach((name, index) => {
      const rank = node('div', 'wsa-rank');
      const avatar = node('div', 'wsa-avatar');
      const key = `rank${index + 1}`;
      const portrait = template.assets[key] ? image(template.assets[key], '', `榜${index + 1}头像`) : icon();
      if (template.assets[key]) applyWeeklyImageSettings(portrait, template, key);
      avatar.append(portrait);
      avatar.append(node('span', 'wsa-rank-number', `榜${['一', '二', '三'][index]}`));
      if (index === 0) avatar.append(node('span', 'wsa-crown'));
      rank.append(avatar, node('span', 'wsa-rank-name', name));
      ranks.append(rank);
    });
    ranking.append(ranks);
    modules.append(ranking);
  }
  if (template.modules.qr.enabled || template.modules.benefits.enabled) {
    const bottom = node('div', 'wsa-module-row');
    if (template.modules.qr.enabled) {
      const qr = makeModule('qr');
      if (template.assets.qrcode) {
        const code = image(template.assets.qrcode, 'wsa-qr-image', '粉丝群二维码');
        applyWeeklyImageSettings(code, template, 'qrcode');
        qr.append(code);
      }
      else qr.append(node('div', 'wsa-qr-empty', '二维码'));
      qr.append(node('p', 'wsa-qr-caption', template.modules.qr.caption));
      bottom.append(qr);
    }
    if (template.modules.benefits.enabled) {
      const benefits = makeModule('benefits', template.modules.benefits.title);
      benefits.append(node('p', 'wsa-benefits-text', template.modules.benefits.text));
      bottom.append(benefits);
    }
    modules.append(bottom);
  }
  modules.dataset.moduleCount = String(Object.values(template.modules).filter(module => module.enabled).length);
  return modules;
}

function buildAssets(template, { node, image, icon }) {
  const layer = node('div', 'wsa-assets');
  if (template.streamerName) {
    const identity = node('div', 'wsa-identity');
    identity.append(icon(), node('span', '', template.streamerName));
    layer.append(identity);
  }
  for (const key of ['portrait', 'logo', 'chibi']) {
    if (!template.assets[key]) continue;
    const figure = node('figure', `wsa-${key}`);
    applyWeeklyImageSettings(figure, template, key);
    figure.append(image(template.assets[key], '', { portrait: '主播立绘', logo: '主播 Logo', chibi: 'Q版小人' }[key]));
    layer.append(figure);
  }
  return layer;
}

// Used by both print rendering and in-place pointer edits in the preview.
export function applyWeeklyImageSettings(node, template, key) {
  const settings = template[getWeeklyImagePath(key)] || {};
  node.dataset.weeklyImage = key;
  node.classList.add('wsa-adjustable-image');
  node.style.setProperty('--wsa-asset-x', `${settings[key === 'background' ? 'offsetX' : 'x'] ?? 0}px`);
  node.style.setProperty('--wsa-asset-y', `${settings[key === 'background' ? 'offsetY' : 'y'] ?? 0}px`);
  node.style.setProperty('--wsa-asset-scale', (settings.scale ?? 100) / 100);
  node.style.setProperty('--wsa-asset-rotation', `${settings.rotation ?? 0}deg`);
  node.style.setProperty('--wsa-asset-flip', settings.flip ? -1 : 1);
  node.style.opacity = (settings.opacity ?? 100) / 100;
  const filters = [];
  if (key === 'background') {
    node.style.objectFit = settings.fit || 'cover';
    node.style.objectPosition = `${settings.x ?? 50}% ${settings.y ?? 50}%`;
    filters.push(`blur(${settings.blur ?? 0}px)`);
  }
  for (const [field, filter] of [['brightness', 'brightness'], ['contrast', 'contrast'], ['saturation', 'saturate']]) {
    if (settings[field] !== undefined && settings[field] !== 100) filters.push(`${filter}(${settings[field]}%)`);
  }
  if (settings.shadow) filters.push(`drop-shadow(0 ${settings.shadow * 0.16}px ${settings.shadow * 0.24}px rgb(0 0 0 / ${settings.shadow * 0.006}))`);
  if (settings.glow) filters.push(`drop-shadow(0 0 ${settings.glow * 0.3}px rgb(255 255 255 / ${settings.glow / 100}))`);
  node.style.filter = filters.join(' ') || 'none';
  if (key === 'portrait') {
    node.classList.toggle('has-outline', settings.outline);
    node.style.setProperty('--wsa-outline-width', `${settings.outlineWidth ?? 7}px`);
  }
}

export function renderWeeklySchedule(container, template, { documentRef = container.ownerDocument } = {}) {
  const builder = createArtBuilder(documentRef, template);
  const root = builder.node('article', 'weekly-schedule-art');
  root.dataset.layout = template.layout;
  root.dataset.flipped = String(template.flippedLayout);
  root.classList.toggle('wsa-edition', ['editorial', 'letterpress', 'nocturne', 'gallery'].includes(template.layout));
  root.classList.toggle('has-portrait', Boolean(template.assets.portrait));
  root.classList.toggle('no-modules', !Object.values(template.modules).some(module => module.enabled));
  root.setAttribute('aria-label', `${template.streamerName ? `${template.streamerName}的` : ''}周表预览`);
  setPalette(root, template);
  const dates = getWeekDates(template.monday);
  root.append(
    buildDecorations(template, builder, documentRef),
    buildHeading(template, dates, builder),
    buildDays(template, dates, builder),
    buildModules(template, builder),
    buildAssets(template, builder),
  );
  container.replaceChildren(root);
  fitWeeklyScheduleText(root);
  return root;
}

// The editor and export page rerun this after their chosen font finishes loading.
// Content that cannot fit at a readable print size is reported, never clipped away.
export function fitWeeklyScheduleText(root) {
  if (!root.isConnected || !root.getClientRects().length) return [];
  const view = root.ownerDocument.defaultView;
  const overflow = [];
  root.querySelectorAll('[data-wsa-fitted]').forEach(element => {
    element.style.removeProperty('font-size');
    delete element.dataset.wsaFitted;
  });
  const contentHeight = element => {
    const style = view.getComputedStyle(element);
    return element.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
  };
  const fits = (element, height) => element.scrollHeight <= height + 1 && element.scrollWidth <= element.clientWidth + 1;
  const fit = (element, label, minimum = 16, height = element?.clientHeight) => {
    if (!element || !element.textContent.trim()) return;
    let size = Number.parseFloat(view.getComputedStyle(element).fontSize);
    while (!fits(element, height) && size > minimum) {
      size = Math.max(minimum, size - 1);
      element.style.fontSize = `${size}px`;
      element.dataset.wsaFitted = 'true';
    }
    if (!fits(element, height)) overflow.push(label);
  };
  const heading = root.querySelector('.wsa-heading');
  let titleHeight = contentHeight(heading);
  const headingStyle = view.getComputedStyle(heading);
  if (root.classList.contains('wsa-edition') && headingStyle.flexDirection === 'column') {
    titleHeight -= heading.querySelector('.wsa-date-label').offsetHeight + Number.parseFloat(headingStyle.rowGap);
  }
  fit(root.querySelector('.wsa-title'), '大标题', 28, titleHeight);
  fit(root.querySelector('.wsa-week-label'), '周范围标签');
  fit(root.querySelector('.wsa-identity > span:last-child'), '主播名字', 18);
  const moduleFields = [
    ['.wsa-message .wsa-module-title', '留言板标题'], ['.wsa-ranking .wsa-module-title', '榜单标题'],
    ['.wsa-benefits .wsa-module-title', '福利标题'], ['.wsa-rank-subtitle', '榜单说明'],
    ['.wsa-rank-name', '榜单昵称'], ['.wsa-qr-caption', '二维码说明'],
  ];
  for (const [selector, label] of moduleFields) root.querySelectorAll(selector).forEach(element => fit(element, label));
  fit(root.querySelector('.wsa-message-text'), '留言内容');
  fit(root.querySelector('.wsa-benefits-text'), '福利内容');
  root.querySelectorAll('.wsa-day').forEach(day => {
    const weekday = day.querySelector('.wsa-weekday strong').textContent;
    const program = day.querySelector('.wsa-program');
    const height = root.dataset.layout === 'week-grid' || root.classList.contains('wsa-edition') ? program.clientHeight : contentHeight(day);
    const fields = Array.from(program.children);
    while (!fits(program, height)) {
      let changed = false;
      for (const field of fields) {
        const size = Number.parseFloat(view.getComputedStyle(field).fontSize);
        if (size <= 16) continue;
        field.style.fontSize = `${Math.max(16, size - 1)}px`;
        field.dataset.wsaFitted = 'true';
        changed = true;
      }
      if (!changed) break;
    }
    if (!fits(program, height)) overflow.push(`${weekday}日程文字`);
    fit(day.querySelector('.wsa-times'), `${weekday}开播时间`, 16, contentHeight(day));
    fit(day.querySelector('.wsa-event-label'), `${weekday}活动标签`);
  });
  const bounds = root.getBoundingClientRect();
  for (const section of root.querySelectorAll('.wsa-heading, .wsa-week, .wsa-module, .wsa-identity')) {
    const rectangle = section.getBoundingClientRect();
    if (rectangle.top < bounds.top - 1 || rectangle.bottom > bounds.bottom + 1
      || rectangle.left < bounds.left - 1 || rectangle.right > bounds.right + 1) {
      overflow.push(section.classList.contains('wsa-module') ? '信息模块超出画布' : '排版内容超出画布');
    }
  }
  root.dataset.overflow = overflow.length ? 'true' : 'false';
  return [...new Set(overflow)];
}

export async function waitForWeeklyScheduleImages(root) {
  await Promise.all(Array.from(root.querySelectorAll('img'), async image => {
    if (typeof image.decode === 'function') {
      try { await image.decode(); } catch { throw new Error('周表图片尚未就绪，请重新上传后重试。'); }
      return;
    }
    if (image.complete) {
      if (!image.naturalWidth) throw new Error('周表图片无法读取，请重新上传。');
      return;
    }
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener('load', loaded);
        image.removeEventListener('error', failed);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('周表图片无法读取，请重新上传。')); };
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
    });
  }));
}
