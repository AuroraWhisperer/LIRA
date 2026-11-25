// Each style lists its actual text nodes; font and color overrides remain optional.
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

// Use each style's actual text function when the shared role name is too broad.
const TEXT_ROLE_LABELS = {
  coffee: { timestamp: '时间', event: '上舰陪伴信息' },
  'celestial-horizontal': { amount: '醒目留言金额' },
  bubble: { badge: '粉丝牌' },
  ranked: { badge: '粉丝牌等级' },
  harbor: { badge: '在线榜单' },
  prismatic: { badge: '粉丝牌', event: '上舰与陪伴' },
  snowfox: { badge: '粉丝牌', title: '上舰标题' },
  wireframe: { event: '上舰欢迎语' },
  'christmas-letter': { event: '醒目留言标题' },
  notebook: { badge: '粉丝牌' },
  glowy: { timestamp: '时间', event: '醒目留言标题' },
  glass: { amount: '礼物与上舰金额', timestamp: '时间', event: '醒目留言与金额' },
  spooky: { badge: '大航海身份', amount: '礼物金额' },
  'flower-letter': { badge: '粉丝牌等级', amount: '礼物与 SC 金额', timestamp: '时间' },
  'dark-moon': { amount: '礼物与上舰金额' },
  moonlit: { badge: '粉丝牌等级', amount: '礼物与 SC 金额', title: '上舰标题' },
  'sea-breeze': { amount: '礼物与 SC 金额' },
  'sea-breeze-random': { amount: '礼物与 SC 金额' },
  window: { badge: '粉丝牌' },
  stardust: { event: '事件标题与金额' },
  mist: { event: '上舰陪伴信息', title: '上舰标题' },
};

const NAME = '.draw-danmaku-identity > strong, .sc-name';
const AMOUNT = '.draw-danmaku-gift-amount, .sc-money';
const MEDAL = '.draw-danmaku-medal-name, .draw-danmaku-medal-level';
const SEA_BREEZE = {
  nickname: '.sea-breeze-name > strong', badge: '.sea-breeze-medal, .sea-breeze-role', amount: '.sea-breeze-amount',
};
const DANMAKU_TEXT_TARGETS = Object.freeze({
  'pastel-scrapbook': { nickname: '.scrapbook-name', amount: '.scrapbook-amount' },
  coffee: { nickname: '.coffee-heading > strong',
    amount: '.coffee-price', timestamp: '.coffee-time', event: '.coffee-event-note' },
  astral: { nickname: '.astral-name', badge: '.astral-role', amount: '.astral-amount', event: '.astral-event-label' },
  'charm-thread': { nickname: '.thread-name', amount: '.thread-amount', event: '.thread-event' },
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
    event: '.stargazer-action, .stargazer-title, .stargazer-item[data-stargazer-kind="superchat"] .stargazer-icon' },
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

// Authored CSS sizes, measured on real message types and rounded to a tenth of a pixel.
const TEXT_SIZE_DEFAULTS = {
  'pastel-scrapbook': { nickname: 27, amount: 27 },
  coffee: { nickname: 20, amount: 16, timestamp: 13, event: 16 },
  astral: { nickname: 21, badge: 15, amount: 17.8, event: 16.7 },
  'charm-thread': { nickname: 17, amount: 15, event: 14 },
  'celestial-horizontal': { nickname: 23, amount: 26 },
  'horizontal-charm': { nickname: 19, badge: 14, amount: 20.4, event: 14 },
  'neon-glass': { nickname: 24, amount: 20.4 },
  bubble: { nickname: 30, badge: 16, amount: 30, event: 14 },
  signal: { nickname: 30, badge: 16, amount: 30, event: 14 },
  minimal: { nickname: 20, amount: 30, event: 14 },
  ranked: { nickname: 30, badge: 16, amount: 30, event: 14 },
  transparent: { nickname: 21, amount: 30, event: 14 },
  identity: { nickname: 20, amount: 30, event: 14 },
  sketch: { nickname: 31.2, amount: 33.6 },
  harbor: { nickname: 25.5, badge: 18.9, amount: 26.4, event: 24.8 },
  prismatic: { nickname: 28, badge: 24, amount: 23.4, event: 25.5 },
  snowfox: { nickname: 32, badge: 21.3, amount: 26.4, title: 31.5 },
  ripploid: { nickname: 19.5, badge: 15.2, amount: 17.3, gift: 24, event: 15.2, title: 25, caption: 5.5 },
  christmas: { nickname: 23.3, badge: 17.5, amount: 18.7, event: 16.3 },
  stargazer: { nickname: 25.7, badge: 17.5, amount: 18, event: 21.4 },
  wireframe: { nickname: 22, badge: 15, amount: 22.9, event: 18.2 },
  'christmas-letter': { nickname: 23.3, badge: 16.3, amount: 28, event: 16.3 },
  notebook: { nickname: 24, badge: 18.7, amount: 24 },
  glowy: { nickname: 20, badge: 14, amount: 16, timestamp: 13, event: 14 },
  glass: { nickname: 30.5, amount: 36, timestamp: 20.3, event: 24 },
  'animated-gradient': { nickname: 22.7, badge: 16.3, amount: 22.4, event: 16.3 },
  spooky: { nickname: 19.9, badge: 15.5, amount: 17.7, event: 17.7, frameTitle: 11 },
  twitter: { nickname: 28.7, amount: 22, timestamp: 18.8, event: 22, profileName: 24, profileInfo: 18, footer: 16 },
  'flower-letter': { nickname: 42.1, badge: 33.2, amount: 43, timestamp: 28.8, caption: 28.8 },
  starlight: { nickname: 24.9, amount: 33 },
  'dark-moon': { nickname: 28, badge: 20, amount: 23.9, event: 28.2 },
  moonlit: { nickname: 26.7, badge: 21.4, amount: 21.3, title: 52 },
  'sea-breeze': { nickname: 26, badge: 16, amount: 20 },
  'sea-breeze-random': { nickname: 26, badge: 16, amount: 20 },
  outline: { nickname: 20, amount: 30, event: 14 },
  comic: { nickname: 19, badge: 14, amount: 17, event: 14 },
  window: { nickname: 20, badge: 14, amount: 16, event: 14 },
  stardust: { nickname: 21, event: 16 },
  'glass-bubble': { nickname: 23, amount: 21 },
  mist: { nickname: 24, amount: 25.8, title: 34.5, event: 18.6 },
  whiteframe: { nickname: 25.5, amount: 39 },
  cream: { nickname: 20, amount: 30, event: 14 },
  floating: { nickname: 22 },
  comet: { nickname: 25 },
  aurora: { nickname: 21, amount: 26 },
  startrail: { nickname: 21, amount: 28 },
  sinking: { nickname: 22, amount: 18, event: 18 },
  starveil: { nickname: 24, amount: 30, event: 14 },
  glow: { nickname: 26, amount: 30, event: 14 },
};

// Existing keys retain each use's authored size and legacy whole-role inheritance.
// [key suffix, use label, default px, selector within the role]
const TEXT_SIZE_VARIANTS = {
  'horizontal-charm': { amount: [['', '礼物'], ['Superchat', '醒目留言', 16, '.charm-event-heading .charm-amount']] },
  bubble: { amount: [['', '礼物'], ['Superchat', '醒目留言', 24, '.sc-money']] },
  signal: { amount: [['', '礼物'], ['Superchat', '醒目留言', 28, '.sc-money']] },
  minimal: { nickname: [['', '弹幕与礼物'], ['Superchat', '醒目留言', 18, '.sc-name']],
    amount: [['', '礼物'], ['Superchat', '醒目留言', 28, '.sc-money']] },
  ranked: { nickname: [['', '弹幕、礼物与上舰'], ['Superchat', '醒目留言', 16, '.sc-name']],
    amount: [['', '礼物'], ['Superchat', '醒目留言', 28, '.sc-money']] },
  transparent: { nickname: [['', '弹幕、礼物与上舰'], ['Superchat', '醒目留言', 17, '.sc-name']],
    amount: [['', '礼物与上舰'], ['Superchat', '醒目留言', 44, '.sc-money']] },
  identity: { nickname: [['', '弹幕、礼物与上舰'], ['Superchat', '醒目留言', 15, '.sc-name']],
    amount: [['', '礼物与上舰'], ['Superchat', '醒目留言', 18, '.sc-money']] },
  sketch: { nickname: [['', '弹幕与礼物'], ['Superchat', '醒目留言', 29.8, '.sc-name']],
    amount: [['', '礼物与上舰'], ['Superchat', '醒目留言', 25.8, '.sc-money']] },
  harbor: { nickname: [['', '礼物'], ['Guard', '上舰', 30, '.harbor-guard-name'], ['Superchat', '醒目留言', 24, '.sc-name']],
    amount: [['', '礼物'], ['Guard', '上舰', 30, '.harbor-guard-amount'], ['Superchat', '醒目留言', 23.4, '.sc-money']],
    event: [['', '送礼说明'], ['Guard', '上舰说明', 31, '.harbor-guard-copy']] },
  prismatic: { nickname: [['', '弹幕'], ['Gift', '礼物与上舰', 26.7, '.is-gift .draw-danmaku-identity > strong, .prismatic-guard-name'], ['Superchat', '醒目留言', 27, '.sc-name']],
    amount: [['', '礼物'], ['Guard', '上舰', 42.1, '.prismatic-guard-amount'], ['Superchat', '醒目留言', 24.6, '.sc-money']] },
  snowfox: { nickname: [['', '弹幕'], ['Gift', '礼物与醒目留言', 29.3, '.is-gift .draw-danmaku-identity > strong, .sc-name'], ['Guard', '上舰', 30, '.snowfox-member-name']],
    amount: [['', '礼物'], ['Superchat', '醒目留言', 25.8, '.sc-money']] },
  ripploid: { amount: [['', '金额数字与礼物单位'], ['Currency', 'SC 货币单位', 9, '.sc-currency']],
    gift: [['', '礼物名称'], ['Count', '礼物数量', 28, '.ripploid-gift-count']],
    event: [['', '会员标签'], ['Guard', '会员等级', 22, '.ripploid-member-role'], ['System', '系统提示', 12, '.ripploid-system-label']],
    title: [['', '礼物标题'], ['Ticket', '票据标题', 20, '.ripploid-ticket-title > span'], ['Guard', '会员标题', 38, '.ripploid-member-new, .ripploid-member-title'],
      ['SuperchatOutline', 'SC 描边标题', 56, '.ripploid-sc-title-outline'], ['Superchat', 'SC 实心标题', 38, '.ripploid-sc-title-fill']],
    caption: [['', '票据署名标签'], ['Passport', '会员票面', 6, '.ripploid-passport-number, .ripploid-passport-copy, .ripploid-passport-ticket'],
      ['SuperchatSender', 'SC 发送者标记', 6, '.ripploid-sc-sender-label'], ['SuperchatFooter', 'SC 底部标记', 7, '.ripploid-sc-footer-copy']] },
  christmas: { amount: [['', '礼物'], ['Superchat', '醒目留言', 20, '.christmas-event-meta .christmas-amount']] },
  stargazer: { nickname: [['', '弹幕与礼物'], ['Superchat', '醒目留言', 23.3, '[data-stargazer-kind="superchat"] .stargazer-sender']],
    amount: [['', '礼物'], ['Superchat', '醒目留言', 18.7, '.stargazer-heading .stargazer-amount']],
    event: [['', '送礼与上舰'], ['Superchat', '醒目留言标题', 22, '.stargazer-title'], ['Tag', 'SC 角标', 16.3, '.stargazer-icon']] },
  wireframe: { badge: [['', '昵称旁等级'], ['Guard', '上舰两侧等级', 13, '.wireframe-member-rank'], ['Medal', '身份标签', 14, '.wireframe-medal']] },
  'christmas-letter': { nickname: [['', '昵称牌'], ['Gift', '礼物发送者', 28, '.xletter-gift-sender']],
    badge: [['', '大航海与灯牌'], ['Other', '其他身份与粉丝牌', 11, '.xletter-role-label:not(.xletter-guard-label.xletter-medal)']] },
  spooky: { event: [['', '送礼动作'], ['Notice', '上舰与醒目留言（含金额）', 17.7, '.spooky-sc .spooky-event-copy, .spooky-member-copy']] },
  twitter: { amount: [['', '礼物与醒目留言'], ['Guard', '上舰', 27, '.draw-danmaku-gift.twitter-post-content > .draw-danmaku-gift-amount']],
    event: [['', '打赏说明'], ['Guard', '上舰说明', 17.7, '.twitter-guard-label'], ['Companion', '陪伴天数', 15.5, '.twitter-guard-companion']],
    profileInfo: [['', '账号'], ['Follow', '关注状态', 14, '.twitter-profile-follow'], ['Tabs', '导航标签', 16, '.twitter-tabs > span']] },
  'flower-letter': { caption: [['', '信笺问候与落款'], ['Signature', '普通弹幕落款', 24, '.flower-ordinary .flower-signature'], ['From', '发送者前缀', 31, '.flower-from > span:not(.flower-nickname)']] },
  starlight: { nickname: [['', '弹幕与礼物'], ['Superchat', '醒目留言', 22.5, '.sc-name']] },
  'dark-moon': { nickname: [['', '弹幕'], ['Gift', '礼物', 28.2, '.is-gift .dark-moon-name'], ['Superchat', '醒目留言', 25, '.is-superchat .dark-moon-name']],
    event: [['', '礼物与上舰'], ['Superchat', '醒目留言（含金额）', 25, '.is-superchat .dark-moon-event-label']] },
  mist: { nickname: [['', '弹幕与礼物'], ['Guard', '上舰', 21.6, '.mist-guard-name'], ['Superchat', '醒目留言', 21, '.sc-name']],
    amount: [['', '礼物'], ['Guard', '上舰', 18.6, '.mist-guard-amount'], ['Superchat', '醒目留言', 27, '.sc-money']] },
};

// Cluster text by its message layout; unlisted uses remain independently adjustable.
// [anchor suffix, control label, linked suffixes]
const TEXT_SIZE_CLUSTERS = {
  'horizontal-charm': { amount: [['', '等比联动', ['Superchat']]] },
  bubble: { amount: [['', '等比联动', ['Superchat']]] },
  signal: { amount: [['', '等比联动', ['Superchat']]] },
  minimal: { nickname: [['', '等比联动', ['Superchat']]], amount: [['', '等比联动', ['Superchat']]] },
  ranked: { amount: [['', '等比联动', ['Superchat']]] },
  sketch: { nickname: [['', '等比联动', ['Superchat']]] },
  harbor: { nickname: [['', '礼物与醒目留言', ['Superchat']]], amount: [['', '礼物与醒目留言', ['Superchat']]] },
  prismatic: { nickname: [['', '弹幕与醒目留言', ['Superchat']]], amount: [['', '礼物与醒目留言', ['Superchat']]] },
  snowfox: { nickname: [['', '弹幕与打赏', ['Gift']]], amount: [['', '等比联动', ['Superchat']]] },
  ripploid: {
    amount: [['', '等比联动', ['Currency']]], gift: [['', '等比联动', ['Count']]],
    event: [['', '会员信息', ['Guard']]],
    title: [['', '礼物票据', ['Ticket']], ['Guard', '会员卡', []], ['Superchat', '醒目留言', ['SuperchatOutline']]],
    caption: [['', '票面小字', ['Passport']], ['SuperchatSender', '醒目留言', ['SuperchatFooter']]],
  },
  christmas: { amount: [['', '等比联动', ['Superchat']]] },
  stargazer: { nickname: [['', '等比联动', ['Superchat']]], amount: [['', '等比联动', ['Superchat']]],
    event: [['Superchat', '醒目留言', ['Tag']]] },
  wireframe: { badge: [['', '昵称旁标识', ['Medal']]] },
  'christmas-letter': { badge: [['', '等比联动', ['Other']]] },
  twitter: { event: [['Guard', '上舰信息', ['Companion']]], profileInfo: [['', '账号与关注', ['Follow']]] },
  'flower-letter': { caption: [['', '问候与落款', ['Signature']], ['From', '打赏署名', []]] },
  starlight: { nickname: [['', '等比联动', ['Superchat']]] },
  'dark-moon': { nickname: [['', '弹幕、礼物与上舰', ['Gift']]] },
  mist: { nickname: [['', '弹幕与打赏', ['Superchat']]], amount: [['', '礼物与醒目留言', ['Superchat']]] },
};

function danmakuTextSizeFields(style) {
  return Object.fromEntries(Object.entries(TEXT_SIZE_DEFAULTS[style] || {}).flatMap(([role, size]) => {
    const variants = TEXT_SIZE_VARIANTS[style]?.[role] || [['', '']];
    const minimum = Math.min(8, Math.floor(size));
    const fields = Object.fromEntries(variants.map(([suffix, sizeLabel, value = size, sizeSelector], sizeOrder) => [`${role}${suffix}FontSize`, {
      default: value,
      min: Math.min(8, Math.floor(value), Number((minimum * value / size).toFixed(2))),
      max: Math.max(96, Number((96 * value / size).toFixed(2))),
      sizeLabel, sizeSelector, sizeOrder,
      textRoleLabel: TEXT_ROLE_LABELS[style]?.[role] || DANMAKU_TEXT_GROUPS[role],
      ...(suffix ? { legacySizeKey: `${role}FontSize` } : {}),
    }]));
    for (const [anchor, label, members] of TEXT_SIZE_CLUSTERS[style]?.[role] || []) {
      const key = `${role}${anchor}FontSize`;
      const control = fields[key];
      control.sizeLabel = label;
      for (const suffix of members) {
        const field = fields[`${role}${suffix}FontSize`];
        field.linkedSizeKey = key;
        // Keep saved limits valid while accepting the cluster's proportional outputs.
        field.min = Math.min(field.min, Number((control.min * field.default / control.default).toFixed(2)));
        field.max = Math.max(field.max, Number((control.max * field.default / control.default).toFixed(2)));
      }
    }
    return Object.entries(fields);
  }));
}

function danmakuTextFields() {
  const fields = Object.fromEntries(Object.entries(DANMAKU_TEXT_GROUPS).flatMap(([role, label]) => {
    const common = { textRole: role, group: `text:${role}` };
    return [
      [`${role}FontFamily`, { ...common, label: `${label}字体`, type: 'font', default: 'default' }],
      [`${role}FontSize`, { ...common, label: `${label}字号`, type: 'number', min: 8, max: 96, step: .01, optional: true }],
      [`${role}Color`, { ...common, label: `${label}颜色`, type: 'color', alpha: true, allowDefault: true, default: 'default' }],
    ];
  }));
  for (const groups of Object.values(TEXT_SIZE_VARIANTS)) {
    for (const [role, variants] of Object.entries(groups)) {
      for (const [suffix, label] of variants.slice(1)) {
        fields[`${role}${suffix}FontSize`] = { ...fields[`${role}FontSize`], label: `${DANMAKU_TEXT_GROUPS[role]}·${label}字号` };
      }
    }
  }
  return fields;
}

export { DANMAKU_TEXT_GROUPS, DANMAKU_TEXT_TARGETS, danmakuTextFields, danmakuTextSizeFields };
