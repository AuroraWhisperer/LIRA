const SVG_NS = 'http://www.w3.org/2000/svg';
const GUARD_NAMES = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });
const GUARD_COLORS = Object.freeze({
  1: 'var(--guard-governor)',
  2: 'var(--guard-admiral)',
  3: 'var(--guard-captain)',
});

const ICON_PATHS = Object.freeze({
  comment: [
    ['path', { d: 'M21 11.5a8.5 8.5 0 0 1-9 8.5 9.8 9.8 0 0 1-4-.9L3 21l1.8-4.4A8.5 8.5 0 1 1 21 11.5Z' }],
  ],
  repost: [
    ['path', { d: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-3v2a3 3 0 0 1-3 3H3' }],
  ],
  heart: [
    ['path', { d: 'M20.8 4.7a5.6 5.6 0 0 0-7.9 0L12 5.6l-.9-.9a5.6 5.6 0 0 0-7.9 7.9l.9.9 7.9 7.9 7.9-7.9.9-.9a5.6 5.6 0 0 0 0-7.9Z' }],
  ],
  share: [
    ['circle', { cx: '18', cy: '5', r: '2.5' }],
    ['circle', { cx: '6', cy: '12', r: '2.5' }],
    ['circle', { cx: '18', cy: '19', r: '2.5' }],
    ['path', { d: 'm8.2 10.8 7.5-4.4M8.2 13.2l7.5 4.4' }],
  ],
  chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
  step: [['path', { d: 'm4 15 8-8 8 8M4 20l8-8 8 8' }]],
});

export function decorateTwitterMessage(document, bubble, item, { identity, body, message }) {
  const name = displayName(item);
  preparePost(bubble, item);
  bubble.querySelector('.draw-danmaku-avatar')?.classList.add('twitter-avatar');
  body.classList.add('twitter-post-main');
  fillIdentity(document, identity, item, name);
  message.classList.add('twitter-post-content');

  if (item.kind === 'gift') {
    bubble.classList.add('twitter-gift');
    const guardLevel = normalizeGuardLevel(item.giftGuardLevel);
    const action = message.querySelector('.draw-danmaku-gift-action');
    if (guardLevel) {
      bubble.classList.add('twitter-guard');
      bubble.dataset.guard = String(guardLevel);
      if (action) {
        action.textContent = item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '感谢支持';
      }
      body.append(createGuardSteps(document));
      if (Number.isSafeInteger(item.guardAccompanyDays) && item.guardAccompanyDays > 0) {
        body.append(node(document, 'p', 'twitter-guard-companion', `已陪伴主播 ${item.guardAccompanyDays} 天`));
      }
    } else if (action) action.textContent = '送出';
  }
  bubble.append(createChevron(document), createActions(document));
  return bubble;
}

export function createTwitterSuperChat(document, root, card, { item, name, copy, amount, avatar }) {
  preparePost(root, item);
  root.classList.add('twitter-superchat');
  avatar.classList.add('draw-danmaku-avatar', 'twitter-avatar');
  card.classList.add('draw-danmaku-body', 'twitter-post-main');
  const identity = node(document, 'div', 'draw-danmaku-identity');
  fillIdentity(document, identity, item, name);
  copy.classList.add('twitter-post-content');
  card.append(identity, amount, copy);
  root.append(avatar, card, createChevron(document), createActions(document));
  return root;
}

function preparePost(root, item) {
  root.classList.add('twitter-post');
  const roomGuardLevel = normalizeGuardLevel(item.roomGuardLevel ?? item.guardLevel);
  const guardLevel = normalizeGuardLevel(item.giftGuardLevel) || roomGuardLevel;
  root.dataset.roomGuard = String(roomGuardLevel);
  if (guardLevel) root.style.setProperty('--twitter-guard-color', GUARD_COLORS[guardLevel]);
}

function fillIdentity(document, identity, item, name) {
  identity.replaceChildren();
  identity.classList.add('twitter-name-line');
  identity.append(node(document, 'strong', 'twitter-name', name));
  const guardLevel = normalizeGuardLevel(item.giftGuardLevel)
    || normalizeGuardLevel(item.roomGuardLevel ?? item.guardLevel);
  if (guardLevel) identity.append(createVerified(document));
  identity.append(node(document, 'span', 'twitter-meta', identityMeta(item, guardLevel)));
}

function identityMeta(item, guardLevel) {
  const uid = String(item.uid || '').trim();
  const handle = uid || GUARD_NAMES[guardLevel] || '观众';
  const timestamp = Number(item.timestamp);
  const date = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    : '';
  return `@${handle}${time ? ` · ${time}` : ''}`;
}

function createVerified(document) {
  const svg = svgRoot(document, 'twitter-verified');
  svg.append(svgNode(document, 'circle', { cx: '12', cy: '12', r: '10', fill: 'currentColor', stroke: 'none' }));
  svg.append(svgNode(document, 'path', {
    d: 'm7.5 12 3 3 6-6', fill: 'none', stroke: '#fff', 'stroke-width': '2.4',
  }));
  return svg;
}

function createChevron(document) {
  return createIcon(document, 'chevron', 'twitter-chevron');
}

function createActions(document) {
  const actions = node(document, 'div', 'twitter-actions');
  actions.setAttribute('aria-hidden', 'true');
  for (const name of ['comment', 'repost', 'heart', 'share']) {
    const action = node(document, 'span', `twitter-action twitter-action-${name}`);
    action.append(createIcon(document, name, 'twitter-action-icon'));
    if (name === 'heart') {
      action.append(node(document, 'span', 'twitter-like-ring'));
      const particles = node(document, 'span', 'twitter-like-particles');
      for (let index = 0; index < 6; index += 1) particles.append(node(document, 'i'));
      action.append(particles);
    }
    actions.append(action);
  }
  return actions;
}

function createGuardSteps(document) {
  const root = node(document, 'div', 'twitter-guard-steps');
  root.setAttribute('aria-hidden', 'true');
  root.append(node(document, 'span', 'twitter-guard-label', 'NEW MEMBER'));
  const steps = node(document, 'span', 'twitter-guard-step-icons');
  for (let index = 0; index < 3; index += 1) {
    const step = node(document, 'span', `twitter-guard-step twitter-guard-step-${index + 1}`);
    step.append(createIcon(document, 'step', 'twitter-step-icon'));
    steps.append(step);
  }
  root.append(steps);
  return root;
}

function createIcon(document, name, className) {
  const svg = svgRoot(document, `twitter-icon ${className}`);
  for (const [tag, attributes] of ICON_PATHS[name]) svg.append(svgNode(document, tag, attributes));
  return svg;
}

function svgRoot(document, className) {
  const svg = svgNode(document, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  svg.setAttribute('class', className);
  if (typeof svg.className === 'string') svg.className = className;
  return svg;
}

function svgNode(document, tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function displayName(item) {
  return String(item.name || '观众').trim() || '观众';
}

function normalizeGuardLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 3 ? level : 0;
}
