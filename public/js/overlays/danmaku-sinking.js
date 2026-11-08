import { setGiftArtwork } from '../shared/gift-image.js';

// Keep text, emotes and gift details in the shared safe renderer.
export function createSinkingMessageRenderer({ document, classNames, resolveGiftImageUrl }, render) {
  const element = (tag, className) => {
    const node = document.createElement(tag);
    node.className = className;
    return node;
  };
  return (item = {}, index = 0) => {
    const superchat = item.kind === 'superchat';
    const root = render({ ...item, kind: superchat ? 'danmaku' : item.kind,
      giftImageUrl: item.kind === 'gift' ? '' : item.giftImageUrl,
      emotes: superchat ? [] : item.emotes }, index);
    root.classList.add('sinking-item');
    root.classList.remove('is-gift', 'is-superchat');
    root.dataset.sinkingKind = superchat ? 'superchat' : item.kind === 'gift' ? 'gift' : 'chat';
    const body = root.querySelector(`.${classNames.body}`);
    body.classList.add('sinking-content');
    body.children[1].classList.add('sinking-message');
    if (superchat) body.children[1].textContent = String(item.message ?? '');
    root.querySelector(`.${classNames.avatar}`)?.remove();
    if (item.kind === 'gift') {
      body.querySelector('.draw-danmaku-gift-art')?.remove();
      body.querySelector('.draw-danmaku-gift-amount')?.remove();
      const membership = { 1: '总督', 2: '提督', 3: '舰长' }[item.giftGuardLevel];
      if (membership) {
        body.querySelector('.draw-danmaku-gift-action').textContent = { open: '开通', renew: '续费' }[item.guardAction] || '支持';
        body.querySelector('.draw-danmaku-gift-name').textContent = membership;
      }
      const image = element('img', 'sinking-gift-image');
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.decoding = 'async';
      setGiftArtwork(image, membership ? '' : resolveGiftImageUrl?.(item.giftImageUrl), {
        format: 'static', mimeType: 'image/webp', guardLevel: Number(item.giftGuardLevel),
      });
      const message = body.children[1];
      message.replaceChildren(image, ...message.children);
    }
    if (superchat || item.kind === 'gift') {
      const footer = element('div', 'sinking-event');
      const label = element('span', 'sinking-event-label');
      label.textContent = superchat ? '醒目留言' : [1, 2, 3].includes(item.giftGuardLevel) ? '大航海' : '礼物';
      const amount = element('span', 'sinking-amount');
      const price = superchat ? item.price : item.giftTotalPrice;
      amount.textContent = Number.isFinite(price) && price >= 0
        ? `¥${price.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
      footer.append(label, amount);
      body.append(footer);
    }
    const panel = element('div', 'sinking-panel');
    const shadow = element('span', 'sinking-shadow');
    const surface = element('span', 'sinking-surface');
    shadow.setAttribute('aria-hidden', 'true');
    surface.setAttribute('aria-hidden', 'true');
    panel.append(shadow, surface, body);
    root.replaceChildren(panel);
    return root;
  };
}
