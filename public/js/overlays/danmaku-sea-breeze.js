import { getSuperChatColors } from './danmaku-superchat-renderer.js';

const GUARDS = { 1: ['governor', '总督'], 2: ['admiral', '提督'], 3: ['captain', '舰长'] };

function node(document, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `CNY ¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
}

// Both layouts reuse the safe message/emote nodes; the feed owns placement and lifetime.
export function createSeaBreezeMessageRenderer({ document, classNames }, render) {
  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const bought = gift && GUARDS[Number(item.giftGuardLevel)];
    const guard = bought || GUARDS[Number(item.roomGuardLevel)];
    const root = render({ ...item, kind: sc || gift ? 'danmaku' : item.kind,
      guardLevel: 0, medalName: '', medalLevel: 0, emotes: sc || gift ? [] : item.emotes }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    heading.classList.add('sea-breeze-name');
    copy.classList.add('sea-breeze-copy');
    body.classList.add('sea-breeze-surface');
    root.classList.add('sea-breeze-item');
    root.dataset.seaBreezeKind = sc ? 'sc' : bought ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.seaBreezeRole = sc || gift && !bought ? 'gift' : item.isStreamer === true ? 'streamer' : guard?.[0] || 'visitor';
    root.style.setProperty('--danmaku-delay', '0ms');

    const tags = node(document, 'div', 'sea-breeze-tags');
    const medal = item.roomMedal;
    if (Number.isSafeInteger(medal?.level) && medal.level > 0 && medal.name) {
      const badge = node(document, 'span', 'sea-breeze-medal', `${medal.name}${medal.level}`);
      if (/^#[\da-f]{6}$/iu.test(medal.colorStart || '')) badge.style.setProperty('--sea-breeze-medal-color', medal.colorStart);
      tags.append(badge);
    }
    const label = sc || gift && !bought ? '赐礼天使' : item.isStreamer === true ? '主播大人' : guard ? `${guard[1]}大人` : '游客大人';
    tags.append(node(document, 'span', 'sea-breeze-role', label));

    if (sc) {
      copy.textContent = String(item.message ?? '');
      root.style.setProperty('--sc-accent', getSuperChatColors(item).accentColor);
    } else if (bought) {
      const title = item.guardAction === 'open' ? `欢迎${bought[1]}加入本月航程`
        : item.guardAction === 'renew' ? `感谢${bought[1]}续费本月航程` : `感谢${bought[1]}支持本月航程`;
      copy.textContent = title + (Number(item.giftCount) > 1 ? ` ×${item.giftCount}` : '');
    } else if (gift) {
      copy.replaceChildren(node(document, 'span', 'sea-breeze-gift-action', '投喂 '),
        node(document, 'span', 'sea-breeze-gift-name', String(item.giftName || '礼物')),
        node(document, 'span', 'sea-breeze-gift-count', `x${item.giftCount}`));
    }
    body.replaceChildren(tags, heading, copy);
    if (sc || gift && !bought) body.append(node(document, 'span', 'sea-breeze-amount', amount(sc ? item.price : item.giftTotalPrice)));
    root.replaceChildren(body);
    return root;
  };
}
