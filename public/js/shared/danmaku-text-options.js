// Each style lists its actual text nodes. Omitted overrides leave the authored CSS intact.
const DANMAKU_TEXT_GROUPS = Object.freeze({
  nickname: '昵称',
  badge: '身份与粉丝牌',
  amount: '金额',
  timestamp: '时间与账号信息',
  event: '事件说明',
  title: '事件标题',
  caption: '装饰小字',
  gift: '礼物名称与数量',
  profileName: '顶部房主昵称',
  profileInfo: '顶部账号与标签',
  footer: '底部提示文字',
  frameTitle: '外框标题',
});

const NAME = '.draw-danmaku-identity > strong, .sc-name';
const AMOUNT = '.draw-danmaku-gift-amount, .sc-money';
const MEDAL = '.draw-danmaku-medal-name, .draw-danmaku-medal-level';
const SEA_BREEZE = {
  nickname: '.sea-breeze-name > strong', badge: '.sea-breeze-medal, .sea-breeze-role', amount: '.sea-breeze-amount',
};
const DANMAKU_TEXT_TARGETS = Object.freeze({
  coffee: { nickname: '.coffee-heading > strong',
    amount: '.coffee-price', timestamp: '.coffee-time', event: '.coffee-event-note' },
  astral: { nickname: '.astral-name', badge: '.astral-role', amount: '.astral-amount', event: '.astral-event-label' },
  'celestial-horizontal': { nickname: '.celestial-name', amount: '.celestial-amount' },
  'horizontal-charm': { nickname: '.charm-name', badge: '.charm-role', amount: '.charm-amount', event: '.charm-event-label' },
  'neon-glass': { nickname: '.neon-glass-name', amount: '.neon-glass-amount' },
  bubble: { nickname: NAME, badge: MEDAL, amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  signal: { nickname: NAME, badge: `${MEDAL}, .draw-danmaku-guard`, amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  minimal: { nickname: NAME, amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  ranked: { nickname: NAME, badge: '.draw-danmaku-medal-level', amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  transparent: { nickname: NAME, amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  identity: { nickname: NAME, amount: AMOUNT, event: '.draw-danmaku-gift-action' },
  sketch: { nickname: NAME, amount: AMOUNT },
  harbor: { nickname: `${NAME}, .harbor-guard-name`, badge: '.harbor-rank',
    amount: `${AMOUNT}, .harbor-guard-amount`, event: '.draw-danmaku-gift-action, .harbor-guard-copy' },
  prismatic: { nickname: `${NAME}, .prismatic-guard-name`, badge: '.prismatic-medal > span, .prismatic-medal-level',
    amount: `${AMOUNT}, .prismatic-guard-amount`, event: '.prismatic-guard-copy' },
  snowfox: { nickname: `${NAME}, .snowfox-member-name`, badge: '.snowfox-medal', amount: AMOUNT, title: '.snowfox-member-title' },
  ripploid: { nickname: '.ripploid-username, .ripploid-ticket-signature, .ripploid-member-name, .ripploid-sc-sender',
    badge: `${MEDAL}, .ripploid-medal-separator, .ripploid-honor-label, .ripploid-guard-label`,
    amount: '.ripploid-gift-price-value, .ripploid-gift-price-unit-text, .sc-value, .sc-currency',
    gift: '.ripploid-gift-name, .ripploid-gift-count',
    event: '.ripploid-member-tag, .ripploid-member-role, .ripploid-system-label',
    title: '.ripploid-gift-label, .ripploid-ticket-title > span, .ripploid-member-new, .ripploid-member-title, .ripploid-sc-title-outline, .ripploid-sc-title-fill',
    caption: '.ripploid-ticket-from-label, .ripploid-passport-number, .ripploid-passport-copy, .ripploid-passport-ticket, .ripploid-sc-sender-label, .ripploid-sc-footer-copy' },
  christmas: { nickname: '.christmas-name', badge: '.christmas-role', amount: '.christmas-amount',
    event: '.christmas-thanks, .christmas-gift-action, .christmas-event-label' },
  stargazer: { nickname: '.stargazer-name, .stargazer-sender', badge: '.stargazer-role', amount: '.stargazer-amount',
    event: '.stargazer-action, .stargazer-title, .stargazer-icon' },
  wireframe: { nickname: '.wireframe-name', badge: '.wireframe-rank-number, .wireframe-member-rank, .wireframe-medal',
    amount: '.wireframe-amount', event: '.wireframe-member-label' },
  'christmas-letter': { nickname: '.xletter-name, .xletter-gift-sender', badge: '.xletter-role-label',
    amount: '.xletter-gift-amount, .xletter-amount', event: '.xletter-event-title' },
  notebook: { nickname: '.notebook-name', badge: MEDAL, amount: '.notebook-amount' },
  glowy: { nickname: '.glowy-heading > strong', badge: '.glowy-role', amount: '.glowy-amount',
    timestamp: '.glowy-time', event: '.glowy-event-label' },
  glass: { nickname: '.glass-heading > strong', amount: '.glass-amount', timestamp: '.glass-time', event: '.glass-event-label' },
  'animated-gradient': { nickname: '.gradient-name', badge: '.gradient-role', amount: '.gradient-amount', event: '.gradient-event-label' },
  spooky: { nickname: '.spooky-name, .spooky-event-name', badge: '.spooky-role', amount: '.draw-danmaku-gift-amount',
    event: '.spooky-sc .spooky-event-copy, .spooky-member-copy, .draw-danmaku-gift-action', frameTitle: '.spooky-frame-title' },
  twitter: { nickname: '.twitter-name', amount: '.draw-danmaku-gift-amount, .sc-money', timestamp: '.twitter-meta',
    event: '.twitter-gift-total > span:not(.sc-money):not(.draw-danmaku-gift-amount), .twitter-guard-label, .twitter-guard-companion',
    profileName: '#twitterProfileName', profileInfo: '.twitter-profile-uid, .twitter-profile-follow, .twitter-tabs > span',
    footer: '.twitter-composer-text' },
  'flower-letter': { nickname: '.flower-nickname', badge: '.flower-medal', amount: '.flower-price', timestamp: '.flower-time',
    caption: '.flower-letter .flower-greeting, .flower-ordinary .flower-signature, .flower-salutation, .flower-from > span:not(.flower-nickname)' },
  starlight: { nickname: NAME, amount: AMOUNT },
  'dark-moon': { nickname: '.dark-moon-name', badge: '.dark-moon-role', amount: '.dark-moon-amount', event: '.dark-moon-event-label' },
  moonlit: { nickname: `${NAME}, .moonlit-guard-name`, badge: '.draw-danmaku-medal-level', amount: AMOUNT,
    title: '.moonlit-guard-title > span, .moonlit-guard-action > span' },
  'sea-breeze': SEA_BREEZE,
  'sea-breeze-random': SEA_BREEZE,
  outline: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount', event: '.draw-danmaku-gift-action' },
  comic: { nickname: '.comic-name', badge: '.comic-role', amount: '.comic-amount', event: '.comic-event' },
  window: { nickname: '.window-nameplate > strong', badge: '.window-medal-name, .window-medal-level',
    amount: '.window-amount', event: '.window-event' },
  stardust: { nickname: '.stardust-name > strong', event: '.stardust-event' },
  'glass-bubble': { nickname: '.glass-bubble-name', amount: '.glass-bubble-amount' },
  mist: { nickname: `${NAME}, .mist-guard-name`, amount: `${AMOUNT}, .mist-guard-amount`,
    title: '.mist-guard-title', event: '.mist-guard-companion' },
  whiteframe: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount' },
  cream: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount', event: '.draw-danmaku-gift-action' },
  floating: { nickname: '.draw-danmaku-identity > strong' },
  comet: { nickname: '.draw-danmaku-identity > strong' },
  aurora: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount' },
  startrail: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount' },
  sinking: { nickname: '.draw-danmaku-identity > strong', amount: '.sinking-amount', event: '.sinking-event-label' },
  starveil: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount', event: '.draw-danmaku-gift-action' },
  glow: { nickname: '.draw-danmaku-identity > strong', amount: '.draw-danmaku-gift-amount', event: '.draw-danmaku-gift-action' },
});

function danmakuTextFields() {
  return Object.fromEntries(Object.entries(DANMAKU_TEXT_GROUPS).flatMap(([role, label]) => {
    const common = { textRole: role, group: `text:${role}` };
    return [
      [`${role}FontFamily`, { ...common, label: `${label}字体`, type: 'font', default: 'default' }],
      [`${role}FontSize`, { ...common, label: `${label}字号`, type: 'number', min: 8, max: 96, optional: true,
        help: '留空保留本款原有字号；输入数值后只调整这组文字，恢复默认可还原。' }],
      [`${role}Color`, { ...common, label: `${label}颜色`, type: 'color', alpha: true, allowDefault: true, default: 'default' }],
    ];
  }));
}

export { DANMAKU_TEXT_GROUPS, DANMAKU_TEXT_TARGETS, danmakuTextFields };
