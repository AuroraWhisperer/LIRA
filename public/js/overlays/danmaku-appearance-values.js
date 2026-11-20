import { DANMAKU_STYLE_OPTIONS, DANMAKU_TEXT_TARGETS, styleOptionFields, styleOptionsFor, supportsDanmakuSuperchat } from '../shared/danmaku-style-options.js';
import { createDanmakuMessageRenderer, DEFAULT_DANMAKU_CLASSES } from './danmaku-message-renderer.js';
import { applyStyleOptions } from './danmaku-style-application.js';

const readers = new WeakMap();

// A deterministic sample of the same identity/event variants used by the renderer.
export function createAppearanceSamples() {
  const sender = { name: 'Aa 观众', message: 'Aa 正文', timestamp: 1794750000000, uid: '1',
    roomGuardLevel: 0, guardLevel: 0, medalName: '', medalLevel: 0, honorLevel: 20 };
  const medal = { name: '粉丝牌', level: 12, colorText: '#ffffff', colorStart: '#5762a7', colorEnd: '#5762a7' };
  const messages = [
    ['普通观众', { ...sender }],
    ['粉丝', { ...sender, medalName: medal.name, medalLevel: 12, roomMedal: medal }],
    ...[3, 2, 1].map((level) => [['', '总督', '提督', '舰长'][level], { ...sender,
      roomGuardLevel: level, guardLevel: level, medalName: medal.name, medalLevel: 12, roomMedal: { ...medal, guardLevel: level } }]),
    ['主播', { ...sender, isStreamer: true }],
    ['房管', { ...sender, isAdmin: true }],
    ['系统', { ...sender, kind: 'system' }],
    ...[1, 50, 100, 500, 1000, 2000].map(price => [`礼物 ${price}`, { ...sender, kind: 'gift', giftName: '星愿', giftCount: 2, giftTotalPrice: price }]),
    ...[3, 2, 1].map(level => [`上舰${['', '总督', '提督', '舰长'][level]}`, { ...sender, kind: 'gift', giftGuardLevel: level,
      roomGuardLevel: level, guardLevel: level, roomMedal: { ...medal, guardLevel: level }, medalName: medal.name, medalLevel: 12,
      guardAction: 'renew', giftName: '大航海', giftCount: 1, giftTotalPrice: 1998, guardAccompanyDays: 365 }]),
    ...[1, 50, 100, 500, 1000, 2000].map(price => [`SC ${price}`, { ...sender, kind: 'superchat', price }]),
  ];
  return messages.map(([label, item], index) => ({ label, item: { ...item, id: `appearance-${index}`, onlineRank: index % 3 + 1 } }));
}

export function renderAppearanceSamples(document, style) {
  const render = createDanmakuMessageRenderer({ document, style, classNames: DEFAULT_DANMAKU_CLASSES,
    fullscreen: Boolean(DANMAKU_STYLE_OPTIONS[style].layout && DANMAKU_STYLE_OPTIONS[style].layout !== 'horizontal'),
    showGiftTotal: true, getGuardLabel: level => ['', '总督', '提督', '舰长'][level] || '' });
  const feed = document.getElementById('feed');
  const samples = createAppearanceSamples().filter(({ item }) => item.kind !== 'superchat' || supportsDanmakuSuperchat(style));
  feed.replaceChildren(...samples.flatMap(({ label, item }, index) => Array.from({ length: style === 'stargazer' ? 4 : style === 'neon-glass' ? 5 : 1 }, (_, tone) => {
      const node = render(style === 'neon-glass' ? { ...item, name: `${item.name}${tone}` } : item, index);
      node.dataset.appearanceSample = label;
      // Palette samples cover every authored random color, without a running feed.
      if (style === 'starveil') node.dataset.palette = String(index % 6);
      if (style === 'stargazer') node.dataset.stargazerTone = String(tone);
      return node;
    })));
}

function colorHex(document, value) {
  const context = document.createElement('canvas').getContext('2d');
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const rgba = Array.from(context.getImageData(0, 0, 1, 1).data);
  return `#${rgba.slice(0, rgba[3] === 255 ? 3 : 4).map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

async function createReader(document) {
  // Standalone overlays have an opaque origin. Keep their CSP and measure inside a private shadow tree.
  const opaque = document.defaultView.origin === 'null';
  const surface = document.createElement(opaque ? 'div' : 'iframe');
  surface.setAttribute('aria-hidden', 'true');
  surface.tabIndex = -1;
  surface.inert = true;
  surface.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1000px;visibility:hidden;pointer-events:none;border:0';
  document.body.append(surface);
  let sample = surface.contentDocument;
  if (opaque) {
    const shadow = surface.attachShadow({ mode: 'closed' });
    const root = document.createElement('html');
    const head = document.createElement('head');
    const body = document.createElement('body');
    root.append(head, body); shadow.append(root);
    sample = { body, head, documentElement: root, defaultView: document.defaultView,
      getElementById: id => shadow.getElementById(id),
      querySelector: selector => shadow.querySelector(selector),
      querySelectorAll: selector => shadow.querySelectorAll(selector),
      ...Object.fromEntries(['createElement', 'createElementNS', 'createTextNode', 'createDocumentFragment', 'importNode']
        .map(key => [key, document[key].bind(document)])),
    };
  }
  const css = sample.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('/css/overlays/danmaku.css', document.baseURI).href;
  const loaded = new Promise((resolve, reject) => { css.onload = resolve; css.onerror = () => reject(new Error('无法读取弹幕样式。')); });
  sample.head.append(css);
  const still = sample.createElement('style');
  still.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
  sample.head.append(still);
  sample.body.className = 'danmaku-overlay-body';
  sample.body.innerHTML = '<div class="danmaku-signal-stage"><div id="feed" class="draw-danmaku-feed"></div></div>';
  try {
    let markup = document;
    if (!opaque) {
      const response = await fetch(new URL('/danmaku?preview=1&componentPreview=1', document.baseURI));
      if (!response.ok) throw new Error('无法读取弹幕文字区域。');
      markup = new DOMParser().parseFromString(await response.text(), 'text/html');
    }
    for (const selector of ['.twitter-profile', '.twitter-tabs', '.twitter-composer', '.spooky-frame']) {
      const node = markup.querySelector(selector);
      if (node) sample.querySelector('.danmaku-signal-stage').append(sample.importNode(node, true));
    }
    await loaded;
  } catch (error) { surface.remove(); throw error; }
  let renderedStyle;
  return { dispose: () => surface.remove(), read(draft) {
    const { style, styleOptions } = draft;
    sample.body.dataset.style = style;
    applyStyleOptions(sample, style, styleOptions, draft.fullscreenDurationSeconds);
    if (renderedStyle !== style) { renderAppearanceSamples(sample, style); renderedStyle = style; }
    const values = {};
    const fields = styleOptionFields(style);
    const options = styleOptionsFor(style, styleOptions, draft.fullscreenDurationSeconds);
    if (fields.bubbleColor) {
      const variables = { 'horizontal-charm': '--charm-accent', 'neon-glass': '--neon-glass-tint-rgb', snowfox: '--snowfox-accent' };
      const variable = variables[style];
      const color = variable && sample.defaultView.getComputedStyle(sample.querySelector('#feed > :first-child')).getPropertyValue(variable).trim();
      values.bubbleColor = color ? colorHex(sample, style === 'neon-glass' ? `rgb(${color})` : color) : DANMAKU_STYLE_OPTIONS[style].defaultBubbleColor;
    }
    for (const [key, field] of Object.entries(fields)) {
      if (!['font', 'color'].includes(field.type)) continue;
      if (field.appearanceWhen && options[field.appearanceWhen[0]] !== field.appearanceWhen[1]) continue;
      const role = field.textRole;
      const selector = field.appearanceTarget || (role ? DANMAKU_TEXT_TARGETS[style][role] : ['fontFamily', 'textColor'].includes(key) ? '#feed p' : '');
      if (!selector) continue;
      const peers = Object.values(fields).filter(other => other.appearanceParent === key).map(other => other.appearanceSelector);
      const nodes = [...sample.querySelectorAll(selector)].filter(node => field.appearanceSelector
        ? node.matches(field.appearanceSelector) : !peers.some(other => node.matches(other)));
      const node = nodes[0];
      if (!node) continue;
      const css = sample.defaultView.getComputedStyle(node);
      values[key] = field.type === 'font' ? css.fontFamily : colorHex(sample, field.colorProperty === 'stroke' ? css.webkitTextStrokeColor : css.color);
    }
    return values;
  } };
}

// The desktop panel and canvas share one measurement document and no data subscription.
export function acquireDanmakuAppearanceValues(document) {
  let entry = readers.get(document);
  if (!entry) {
    entry = { users: 0, ready: createReader(document) };
    readers.set(document, entry);
  }
  entry.users += 1;
  return {
    async read(draft) { return (await entry.ready).read(draft); },
    dispose() {
      entry.users -= 1;
      if (!entry.users) { readers.delete(document); void entry.ready.then(reader => reader.dispose(), () => {}); }
    },
  };
}
