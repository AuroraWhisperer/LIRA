// Bilibili price_configs: background_color / background_bottom_color / background_price_color.
// Live packet colors take precedence; 2-yuan messages share the 30-yuan fallback.
const SUPERCHAT_PALETTES = [
  [0, '#EDF5FF', '#2A60B2', '#7497CD'],
  [50, '#DBFFFD', '#427D9E', '#7DA4BD'],
  [100, '#FFF1C5', '#E2B52B', '#ECCF75'],
  [500, '#FFEAD2', '#E09443', '#E8AF79'],
  [1000, '#FFE7E4', '#E54D4D', '#EE8B8B'],
  [2000, '#FFD8D8', '#AB1A32', '#C86A7A'],
];

export function getSuperChatColors(item) {
  const tier = SUPERCHAT_PALETTES.findLast(([minimum]) => Number(item.price) >= minimum)
    || SUPERCHAT_PALETTES[0];
  const colors = {};
  ['backgroundColor', 'accentColor', 'priceColor'].forEach((key, index) => {
    const value = item.colors?.[key];
    colors[key] = typeof value === 'string' && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toUpperCase() : tier[index + 1];
  });
  return colors;
}

function superChatForeground(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#000000' : '#FFFFFF';
}

export function createSuperChatCard(document, item, style, resolveAvatarUrl, classNames) {
  const colors = getSuperChatColors(item);
  const root = document.createElement('article');
  root.className = `${classNames.item} is-superchat`;
  root.style.setProperty('--danmaku-delay', '0ms');
  root.style.setProperty('--sc-surface', colors.backgroundColor);
  root.style.setProperty('--sc-accent', colors.accentColor);
  root.style.setProperty('--sc-price', colors.priceColor);
  root.style.setProperty('--sc-on-surface', superChatForeground(colors.backgroundColor));
  root.style.setProperty('--sc-on-accent', superChatForeground(colors.accentColor));
  const card = node('div', `sc-message sc-${style}`);
  const copy = node('p', 'sc-copy', String(item.message ?? ''));
  const name = String(item.name || '观众').trim() || '观众';
  const price = Number(item.price).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const amount = node('span', 'sc-money');
  amount.append(node('span', 'sc-currency', '¥'), node('span', 'sc-value', price));
  root.setAttribute('aria-label', `醒目留言，¥${price}`);

  if (style === 'ranked') {
    const header = node('div', 'sc-classic-head');
    const person = node('div', 'sc-person');
    person.append(avatar(), node('span', 'sc-name', name));
    header.append(person, amount);
    card.append(header, copy);
  } else if (style === 'bubble') {
    amount.className += ' sc-bubble-price';
    const footer = node('div', 'sc-bubble-foot');
    footer.append(avatar(), node('span', 'sc-name', name));
    card.append(amount, copy, footer);
  } else if (style === 'signal') {
    amount.className += ' sc-signal-amount';
    card.append(amount, main());
  } else if (style === 'minimal') {
    const left = node('span', 'sc-bow-edge sc-bow-edge-left');
    const right = node('span', 'sc-bow-edge sc-bow-edge-right');
    left.setAttribute('aria-hidden', 'true');
    right.setAttribute('aria-hidden', 'true');
    amount.className += ' sc-bow-price';
    card.append(left, right, node('span', 'sc-name', name), copy, amount);
  } else if (style === 'transparent') {
    card.append(amount, main());
  } else if (style === 'identity') {
    const profile = node('div', 'sc-identity-profile');
    profile.append(avatar(), amount);
    card.append(profile, node('span', 'sc-name', name), copy);
  }
  root.append(card);
  return root;

  // Two-column designs keep the sender and the original text in one column.
  function main() {
    const column = node('div', 'sc-main');
    column.append(node('span', 'sc-name', name), copy);
    return column;
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function avatar() {
    const element = node('span', 'sc-avatar');
    element.setAttribute('aria-hidden', 'true');
    const source = String(resolveAvatarUrl(item.avatarUrl) || '');
    if (!source) {
      element.textContent = Array.from(name)[0] || '观';
      return element;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      image.remove();
      element.textContent = Array.from(name)[0] || '观';
    });
    image.src = source;
    element.append(image);
    return element;
  }
}
