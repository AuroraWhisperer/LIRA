const ART = '/img/overlays/danmaku-christmas/';
const GUARDS = Object.freeze({ 1: '总督', 2: '提督', 3: '舰长' });

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function ornament(document, name) {
  const image = node(document, 'img', `christmas-ornament christmas-${name}`);
  image.src = `${ART}${name}.svg`;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function frame(document) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', 'christmas-frame');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(namespace, 'rect');
  line.setAttribute('x', '.5');
  line.setAttribute('y', '.5');
  line.setAttribute('rx', '13');
  line.setAttribute('pathLength', '1');
  svg.append(line);
  return svg;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// Reuse canonical text/emote rendering; only this style's composition lives here.
export function createChristmasMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const gift = item.kind === 'gift';
    const sc = item.kind === 'superchat';
    const bought = gift && GUARDS[item.giftGuardLevel];
    const guard = GUARDS[item.roomGuardLevel];
    const role = item.isStreamer === true ? '主播' : guard || (item.roomMedal?.level > 0 ? '粉丝' : '');
    const root = render({ ...item, kind: 'danmaku' }, index);
    const copy = root.querySelector(`.${classNames.body}`).children[1];
    root.replaceChildren();
    root.classList.add('christmas-item');
    root.dataset.christmasKind = sc ? 'superchat' : bought ? 'member' : gift ? 'gift' : 'chat';
    if (gift) root.classList.add('is-gift');
    if (sc) root.classList.add('is-superchat');
    if (item.kind === 'system' || item.kind === 'entry') root.classList.add('christmas-notice');
    const card = node(document, 'div', `${classNames.body} christmas-card`);
    card.append(frame(document));
    const heading = node(document, 'div', `${classNames.identity} christmas-heading`);
    if (gift) heading.append(node(document, 'span', 'christmas-thanks', '谢谢'));
    heading.append(node(document, 'strong', 'christmas-name', item.name || '观众'));
    if (role && !gift && !sc) heading.append(node(document, 'span', 'christmas-role', role));
    copy.classList.add('christmas-copy');
    if (gift || sc) {
      const lights = node(document, 'span', 'christmas-lights');
      lights.setAttribute('aria-hidden', 'true');
      for (let bulb = 0; bulb < 5; bulb += 1) lights.append(node(document, 'i', 'christmas-light'));
      card.append(ornament(document, 'garland'), lights);
      const price = node(document, 'span', 'christmas-amount', amount(sc ? item.price : item.giftTotalPrice));
      if (sc) {
        const meta = node(document, 'span', 'christmas-event-meta');
        meta.append(node(document, 'span', 'christmas-event-label', '醒目留言'), price);
        heading.append(meta);
      }
      if (gift) {
        const action = bought ? item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持' : '送来的';
        const description = node(document, 'span', 'christmas-gift-description');
        description.append(node(document, 'span', 'christmas-gift-action', `${action} `),
          node(document, 'strong', 'christmas-gift-name', bought || item.giftName || '礼物'),
          node(document, 'span', 'christmas-gift-count', ` × ${item.giftCount ?? 1}`));
        copy.classList.add('christmas-gift-copy');
        copy.replaceChildren(description, price);
      }
      root.append(ornament(document, 'wreath'));
    } else {
      card.append(ornament(document, 'corner'));
      root.append(ornament(document, 'pendant'));
    }
    card.append(heading);
    card.append(copy, ornament(document, 'bow'));
    root.append(card);
    return root;
  };
}
