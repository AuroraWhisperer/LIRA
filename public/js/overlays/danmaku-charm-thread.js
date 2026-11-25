import { GUARD_LABELS } from '../shared/bilibili-guard-labels.js';
import { formatDanmakuAmount } from '../shared/display-format.js';
import { createTextElement } from '../shared/dom-element.js';

export function createCharmThreadMessageRenderer({ document, classNames }, render) {
  return (item = {}, index = 0) => {
    const gift = item.kind === 'gift';
    const sc = item.kind === 'superchat';
    const root = render(gift || sc ? { ...item, kind: 'danmaku' } : item, index);
    const body = root.querySelector(`.${classNames.body}`);
    const [heading, copy] = body.children;
    const name = heading.children[0];
    root.classList.add('thread-item');
    name.classList.add('thread-name');
    if (item.kind === 'system' && !item.name) name.textContent = '直播间';
    heading.replaceChildren(name);
    copy.classList.add('thread-copy');

    const member = gift && GUARD_LABELS[item.giftGuardLevel];
    const guard = GUARD_LABELS[item.roomGuardLevel] || member;
    root.dataset.threadRole = item.isStreamer ? 'streamer' : guard ? 'guard' : item.roomMedal?.name ? 'fan' : 'viewer';
    if (gift || sc) {
      root.classList.add(gift ? 'is-gift' : 'is-superchat');
      heading.append(createTextElement(document, 'span', 'thread-event', sc ? '醒目留言' : member ? '大航海' : '送出'));
      const price = sc ? item.price : item.giftTotalPrice;
      if (Number.isFinite(price) && price >= 0) heading.append(createTextElement(document, 'span', 'thread-amount', formatDanmakuAmount(price)));
      if (sc) {
        copy.textContent = String(item.message ?? '');
      } else if (member) {
        const action = { open: '开通', renew: '续费' }[item.guardAction] || '支持';
        const quantity = item.giftCount > 1 ? ` × ${item.giftCount}` : '';
        copy.textContent = `${action}${member}${quantity}`;
      } else {
        copy.textContent = `${item.giftName || '礼物'} × ${item.giftCount ?? 1}`;
      }
    }

    const rail = createTextElement(document, 'span', 'thread-rail');
    rail.setAttribute('aria-hidden', 'true');
    rail.append(createTextElement(document, 'span', 'thread-jewel'));
    root.replaceChildren(rail, body);
    return root;
  };
}
