import { setGiftImage } from './gift-image-fallback.js';

const views = new WeakMap();

export function mountMoonlitGiftWish(card, wish, documentRef) {
  const element = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  card.classList.add('wish-card--moonlit');
  const image = element('img', 'wish-card-image');
  const content = element('div', 'wish-moon-content');
  const heading = element('div', 'wish-moon-heading');
  const name = element('span', 'wish-moon-name');
  const total = element('div', 'wish-card-total');
  const count = element('strong', 'wish-card-count');
  const target = element('span', 'wish-card-target');
  total.append(count, target);
  heading.append(name, total);
  const track = element('div', 'wish-moon-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  const fill = element('div', 'wish-moon-fill');
  const flow = element('span', 'wish-moon-flow');
  const tip = element('span', 'wish-moon-tip');
  tip.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 3; index += 1) tip.append(element('i', 'wish-moon-petal'));
  fill.append(flow, tip);
  track.append(fill);
  content.append(heading, track);
  card.append(image, content);
  views.set(card, { image, name, count, target, track, fill });
  updateMoonlitGiftWish(card, wish);
  return card;
}

export function updateMoonlitGiftWish(card, wish) {
  const view = views.get(card);
  const progress = Math.max(0, Math.min(100, wish.progress));
  card.classList.toggle('is-complete', wish.completed);
  card.classList.toggle('is-empty', progress === 0);
  card.setAttribute('aria-label', `${wish.giftName} · 已收集 ${wish.count} 个，目标 ${wish.target} 个`);
  view.name.textContent = wish.giftName;
  view.name.title = wish.giftName;
  view.image.alt = wish.giftName;
  if (view.source !== wish.imagePath || !view.image.hasAttribute('src')) {
    setGiftImage(view.image, wish.imagePath);
    view.source = wish.imagePath;
  }
  view.count.textContent = String(wish.count);
  view.target.textContent = `/${wish.target}`;
  view.track.setAttribute('aria-label', `${wish.giftName}收集进度`);
  view.track.setAttribute('aria-valuemax', String(wish.target));
  view.track.setAttribute('aria-valuenow', String(Math.min(wish.count, wish.target)));
  view.track.setAttribute('aria-valuetext', `已收集 ${wish.count} 个，目标 ${wish.target} 个`);
  view.fill.style.width = `${progress}%`;
}
