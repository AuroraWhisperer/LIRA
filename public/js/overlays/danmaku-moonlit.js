const GUARDS = Object.freeze({
  1: { identity: 'governor', label: '总督' },
  2: { identity: 'admiral', label: '提督' },
  3: { identity: 'captain', label: '舰长' },
});

function ornament(document, className) {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function guardIcon(document, level) {
  const guard = GUARDS[level];
  if (!guard) return null;
  const icon = document.createElement('span');
  icon.className = `moonlit-guard-icon moonlit-icon-${guard.identity}`;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', guard.label);
  return icon;
}

function caption(document, tag, className, label) {
  const element = document.createElement(tag);
  element.className = className;
  for (const character of label) {
    const glyph = document.createElement('span');
    glyph.textContent = character;
    element.append(glyph);
  }
  return element;
}

// The ordinary renderer owns safe avatars, names and emotes. This module only composes the artwork.
export function decorateMoonlitMessage(document, root, item, { avatar, body, identity, message }) {
  const purchase = item.kind === 'gift' ? GUARDS[item.giftGuardLevel] : null;
  if (purchase) {
    root.className += ' moonlit-guard';
    root.dataset.identity = purchase.identity;
    root.setAttribute('aria-label', `${item.name || '观众'}上任${purchase.label}`);
    const scene = ornament(document, 'moonlit-guard-scene');
    scene.append(ornament(document, 'moonlit-guard-landscape'));
    if (avatar) scene.append(avatar);
    scene.append(guardIcon(document, item.giftGuardLevel));
    const lettering = document.createElement('div');
    lettering.className = 'moonlit-guard-lettering';
    const title = caption(document, 'strong', 'moonlit-guard-title', purchase.label);
    const action = caption(document, 'span', 'moonlit-guard-action', '上任');
    const name = document.createElement('div');
    name.className = 'moonlit-guard-name';
    name.textContent = String(item.name || '观众');
    const birds = ornament(document, 'moonlit-birds');
    for (let index = 0; index < 3; index += 1) birds.append(ornament(document, 'moonlit-bird'));
    lettering.append(title, action, name, birds);
    root.replaceChildren(scene, lettering);
    return;
  }
  if (item.kind === 'gift') {
    const amount = message.querySelector('.draw-danmaku-gift-amount');
    const action = message.querySelector('.draw-danmaku-gift-action');
    const count = message.querySelector('.draw-danmaku-gift-count');
    action?.remove();
    if (count) message.querySelector('.draw-danmaku-gift-copy').append(count);
    if (amount) identity.append(amount);
    createMoonlitScroll(document, root, { avatar, body });
    return;
  }
  root.className += ' moonlit-chat';
  root.append(ornament(document, 'moonlit-brush'), ornament(document, 'moonlit-chat-flowers'),
    ornament(document, 'moonlit-ink-sweep'));
  const icon = guardIcon(document, item.guardLevel);
  if (icon) root.append(icon);
}

export function createMoonlitScroll(document, root, { avatar, body }) {
  root.className += ' moonlit-scroll';
  const paper = document.createElement('div');
  paper.className = 'moonlit-scroll-paper';
  if (avatar) paper.append(avatar);
  paper.append(body);
  const decoration = ornament(document, 'moonlit-scroll-decoration');
  decoration.append(ornament(document, 'moonlit-scroll-flowers'));
  root.replaceChildren(ornament(document, 'moonlit-scroll-ink'), paper,
    ornament(document, 'moonlit-scroll-roller'), decoration);
}
