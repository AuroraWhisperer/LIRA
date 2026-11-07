const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const SC_TIERS = [[10000, 'red'], [5000, 'magenta'], [2000, 'orange'], [1000, 'yellow'],
  [500, 'green'], [200, 'cyan'], [0, 'blue']];
const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';
}

// Keep the safe renderer's nodes, including emotes, and reveal complete graphemes.
// CSS owns playback; the feed owns placement, expiry and removal.
function prepareTyping(document, copy, maxDurationMs, typingStepMs) {
  let order = 0;
  function prepare(node) {
    if (node.tagName === 'IMG') {
      node.classList.add('glass-bubble-glyph');
      node.style.setProperty('--glass-glyph-order', String(order++));
    } else if (node.children.length) {
      Array.from(node.children).forEach(prepare);
    } else {
      const text = node.textContent;
      node.textContent = '';
      for (const { segment } of graphemes.segment(text)) {
        const glyph = document.createElement('span');
        glyph.className = 'glass-bubble-glyph';
        glyph.textContent = segment;
        glyph.style.setProperty('--glass-glyph-order', String(order++));
        node.append(glyph);
      }
    }
  }
  prepare(copy);
  copy.style.setProperty('--glass-typing-step', `${Math.min(typingStepMs, maxDurationMs / Math.max(1, order))}ms`);
}

export function createGlassBubbleMessageRenderer(options, render) {
  const { document, classNames } = options;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  return (item = {}, index = 0) => {
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const member = gift && GUARDS[Number(item.giftGuardLevel)];
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind, emotes: sc ? [] : item.emotes }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const name = body.children[0].children[0];
    const copy = body.children[1];
    if (sc) {
      root.classList.add('is-superchat');
      copy.classList.add('sc-copy');
      copy.textContent = String(item.message ?? '');
    }
    const header = element('div', `${classNames.identity} glass-bubble-header`);
    name.classList.add('glass-bubble-name');
    header.append(name);
    root.classList.add('glass-bubble-item');
    root.dataset.glassBubbleReveal = document.body?.dataset.glassBubbleReveal || 'typing';
    root.dataset.glassBubbleKind = sc ? 'sc' : member ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.glassBubbleTier = sc
      ? SC_TIERS.find(([minimum]) => Number(item.price) >= minimum)?.[1] || 'blue'
      : member ? 'member' : gift ? 'gift' : 'chat';
    root.style.setProperty('--danmaku-delay', '0ms');
    if (options.fullscreen) root.style.setProperty('visibility', 'hidden');
    if (sc || gift) {
      const price = amount(sc ? item.price : item.giftTotalPrice);
      header.append(element('span', 'glass-bubble-amount', price));
      root.setAttribute('aria-label', `${sc ? '醒目留言' : member ? '大航海' : '礼物'}，${price}`);
    }
    copy.classList.add('glass-bubble-copy');
    if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      if (member) {
        const action = item.guardAction === 'open' ? '开通' : item.guardAction === 'renew' ? '续费' : '支持';
        copy.replaceChildren(element('span', 'glass-bubble-event', `${member} · ${action}`),
          element('span', 'glass-bubble-thanks', `感谢守护 × ${item.giftCount}`));
      } else {
        const giftCopy = copy.querySelector('.draw-danmaku-gift-copy');
        const count = copy.querySelector('.draw-danmaku-gift-count');
        copy.replaceChildren(giftCopy, count);
      }
    }
    // Snapshot the entry rhythm so later edits never replay existing messages.
    // Chat must finish before a 2s stay with a 1s exit starts fading.
    const typingStepMs = Number(document.body?.dataset.glassBubbleTypingSpeed) || 26;
    prepareTyping(document, copy, sc || gift ? 1400 : 420, typingStepMs);
    const surface = element('div', 'glass-bubble-surface');
    surface.setAttribute('aria-hidden', 'true');
    surface.append(element('span', 'glass-bubble-sheen'));
    body.classList.add('glass-bubble-content');
    body.replaceChildren(copy);
    root.replaceChildren(surface, header, body);
    return root;
  };
}
