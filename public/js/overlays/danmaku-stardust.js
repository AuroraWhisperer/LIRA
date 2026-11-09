const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };

// Recompose the shared safe content; the feed still owns placement and lifetime.
export function createStardustMessageRenderer({ document, classNames }, render) {
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  return (item = {}, index = 0) => {
    const settings = document.body?.dataset || {};
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const member = gift && GUARDS[Number(item.giftGuardLevel)];
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind, emotes: sc ? [] : item.emotes }, index);
    root.classList.add('stardust-item');
    root.dataset.stardustKind = sc ? 'sc' : member ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.stardustEntrance = settings.stardustEntrance || 'on';
    root.style.setProperty('--stardust-phase', `${-(index % 9) * .7}s`);
    const highlighted = member || (gift && Number.isFinite(item.giftTotalPrice)
      && item.giftTotalPrice >= Number(settings.stardustGiftThreshold ?? .01));
    if (highlighted) {
      const top = !member;
      root.dataset.danmakuAnchor = (settings.stardustSwapAnchors === 'on' ? !top : top) ? 'top' : 'bottom';
    }
    const body = root.querySelector(`.${classNames.body}`);
    const identity = body.children[0];
    const copy = body.children[1];
    identity.classList.add('stardust-name');
    copy.classList.add('stardust-copy');
    if (gift) {
      const action = copy.querySelector('.draw-danmaku-gift-action');
      const name = copy.querySelector('.draw-danmaku-gift-name');
      const count = copy.querySelector('.draw-danmaku-gift-count');
      copy.replaceChildren(action, element('span', 'stardust-space', ' '), name, element('span', 'stardust-space', ' '), count);
      if (member) {
        copy.textContent = `${member}，感谢你的${item.guardAction === 'renew' ? '续费守护' : '守护'}`;
      }
    }
    if (sc) copy.textContent = String(item.message ?? '');
    const ornament = element('div', 'stardust-ornament');
    ornament.setAttribute('aria-hidden', 'true');
    ornament.append(element('i', 'stardust-star stardust-star-side'), element('i', 'stardust-star stardust-star-main'),
      element('i', 'stardust-star stardust-star-side'));
    if (sc || member) ornament.append(element('i', 'stardust-orbit'));
    const parts = [ornament];
    if (gift || sc) {
      const amount = sc ? item.price : item.giftTotalPrice;
      const price = Number.isFinite(amount) && amount >= 0
        ? ` · ¥${amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '';
      parts.push(element('div', 'stardust-event', member ? '星海相伴' : `${sc ? '醒目留言' : '星光礼物'}${price}`));
    }
    const tail = element('div', 'stardust-tail');
    tail.setAttribute('aria-hidden', 'true');
    tail.append(element('i', 'stardust-star'));
    body.replaceChildren(...parts, copy, identity, ...(member ? [tail] : []));
    root.replaceChildren(body);
    return root;
  };
}
