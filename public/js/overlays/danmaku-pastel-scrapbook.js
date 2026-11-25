import { createTextElement } from '../shared/dom-element.js';
import { formatDanmakuAmount } from '../shared/display-format.js';
import { GUARD_LABELS } from '../shared/bilibili-guard-labels.js';

export function createScrapbookMessageRenderer({ document, classNames }, render) {
  const node = createTextElement.bind(null, document);
  function sticker(shape) {
    const element = node('span', `scrapbook-sticker scrapbook-${shape}`);
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  return (item = {}, index = 0) => {
    const gift = item.kind === 'gift';
    const sc = item.kind === 'superchat';
    const notice = gift || sc || item.kind === 'entry' || item.kind === 'system';
    const root = render(notice ? { ...item, kind: 'danmaku' } : item, index);
    const body = root.querySelector(`.${classNames.body}`);
    const copy = body.children[1];
    const sender = node('span', 'scrapbook-name', String(item.name || '观众').trim() || '观众');
    const sheet = node('div', 'scrapbook-sheet');
    root.classList.add('scrapbook-item');
    body.replaceChildren();
    copy.classList.add('scrapbook-copy');
    sheet.append(copy);
    if (notice) {
      root.classList.add('scrapbook-notice');
      if (gift || sc) {
        root.classList.add(gift ? 'is-gift' : 'is-superchat');
        const guard = gift && GUARD_LABELS[item.giftGuardLevel];
        const action = guard ? ({ open: '开通', renew: '续费' }[item.guardAction] || '支持') : '送出';
        const label = gift ? ` ${action} ${guard || item.giftName || '礼物'} ×${item.giftCount ?? 1}` : ' · 醒目留言';
        const caption = node('div', 'scrapbook-caption');
        caption.append(sender, node('span', 'scrapbook-action', label));
        const price = gift ? item.giftTotalPrice : item.price;
        if (Number.isFinite(price)) caption.append(node('span', 'scrapbook-amount', ` · ${formatDanmakuAmount(price)}`));
        if (sc) {
          copy.textContent = String(item.message ?? '');
          sheet.prepend(caption);
        }
        else sheet.replaceChildren(caption);
      } else if (item.kind === 'entry' && !copy.textContent.trim()) {
        copy.append(sender, node('span', '', ' 来到直播间'));
      }
      sheet.append(sticker('pin'), sticker('clip'));
    } else {
      const tape = node('div', 'scrapbook-tape');
      const guard = GUARD_LABELS[item.roomGuardLevel];
      const role = item.isStreamer ? 'camera' : guard ? 'star' : item.roomMedal?.name ? 'diamond' : '';
      if (role) {
        const icon = node('span', `scrapbook-role scrapbook-role-${role}`);
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', item.isStreamer ? '主播' : guard || item.roomMedal.name);
        tape.append(icon);
      }
      tape.append(sender);
      body.append(tape);
      sheet.append(sticker('flower'), sticker('star'), sticker('heart'));
    }
    body.append(sheet);
    return root;
  };
}
