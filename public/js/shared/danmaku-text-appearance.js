// Independent text paint/font targets. Values are read from the actual renderer, not duplicated here.
// The first part is the remainder of its role after the explicitly selected parts.
const BODY_TEXT_TARGETS = {
  starveil: '.draw-danmaku-item:not(.is-gift) .draw-danmaku-body > p',
  stargazer: '.stargazer-item:is([data-stargazer-kind="chat"], [data-stargazer-kind="system"], [data-stargazer-kind="superchat"]) .stargazer-copy',
};
const DANMAKU_TEXT_APPEARANCE = {
  'coffee': {
    nicknameColor: [
      ['礼物', ''],
      ['SC', '.is-superchat strong'],
      ['聊天', '[data-coffee-kind="chat"][data-coffee-role="0"] strong, [data-streamer="true"] strong'],
      ['舰长', '[data-coffee-kind="chat"][data-coffee-role="3"] strong'],
      ['提督', '[data-coffee-kind="chat"][data-coffee-role="2"] strong'],
      ['总督', '[data-coffee-kind="chat"][data-coffee-role="1"] strong'],
      ['舰长上舰', '[data-coffee-membership="3"] strong'],
      ['提督上舰', '[data-coffee-membership="2"] strong'],
      ['总督上舰', '[data-coffee-membership="1"] strong'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.is-superchat span'],
      ['舰长上舰', '[data-coffee-role="3"] span'],
      ['提督上舰', '[data-coffee-role="2"] span'],
      ['总督上舰', '[data-coffee-role="1"] span'],
    ],
    eventColor: [
      ['舰长上舰', ''],
      ['提督上舰', '[data-coffee-role="2"] span'],
      ['总督上舰', '[data-coffee-role="1"] span'],
    ],
  },
  'horizontal-charm': {
    nicknameColor: [
      ['礼物、上舰、SC', ''],
      ['聊天', '.charm-identity strong'],
    ],
    badgeColor: [
      ['舰长', ''],
      ['提督', '[data-identity="admiral"] span'],
      ['总督', '[data-identity="governor"] span'],
      ['主播', '[data-streamer="true"] span'],
    ],
  },
  'neon-glass': {
    nicknameColor: [
      ['礼物、上舰、SC', '.neon-glass-item:not([data-neon-glass-kind="chat"]) strong'],
      ['观众、提督', '[data-neon-glass-kind="chat"][data-neon-glass-role="viewer"] strong, [data-neon-glass-kind="chat"][data-neon-glass-role="admiral"] strong', null, ['neonGlassNameColors', 'identity']],
      ['粉丝', '[data-neon-glass-kind="chat"][data-neon-glass-role="fan"] strong', null, ['neonGlassNameColors', 'identity']],
      ['舰长', '[data-neon-glass-kind="chat"][data-neon-glass-role="captain"] strong', null, ['neonGlassNameColors', 'identity']],
      ['总督', '[data-neon-glass-kind="chat"][data-neon-glass-role="governor"] strong', null, ['neonGlassNameColors', 'identity']],
      ['主播', '[data-neon-glass-kind="chat"][data-neon-glass-role="streamer"] strong', null, ['neonGlassNameColors', 'identity']],
      ...Array.from({ length: 5 }, (_, index) => [`色系 ${index + 1}`, `[data-neon-glass-kind="chat"][data-neon-glass-palette="${index}"] strong`, null, ['neonGlassNameColors', 'original']]),
      ['聊天', '[data-neon-glass-kind="chat"] strong', null, ['neonGlassNameColors', 'text']],
    ],
  },
  'bubble': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
      ['聊天', '[data-identity="viewer"]:not(.is-gift):not(.is-superchat) strong, [data-identity="fan"] strong'],
      ['舰长', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong'],
      ['提督', '[data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong'],
      ['总督', '[data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
    badgeFontFamily: [
      ['灯牌等级', ''],
      ['灯牌名称', 'b'],
    ],
    badgeColor: [
      ['灯牌等级', ''],
      ['灯牌名称', 'b'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC 50–1999', '[data-sc-tier="50"] span, [data-sc-tier="100"] span, [data-sc-tier="500"] span, [data-sc-tier="1000"] span'],
      ['SC ＜50 / ≥2000', '[data-sc-tier="0"] span, [data-sc-tier="2000"] span'],
    ],
  },
  'signal': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
      ['聊天', '[data-identity="viewer"]:not(.is-gift):not(.is-superchat) strong'],
      ['粉丝', '[data-identity="fan"] strong'],
      ['舰长', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong'],
      ['提督', '[data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong'],
      ['总督', '[data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
    badgeFontFamily: [
      ['灯牌等级', ''],
      ['灯牌名称', 'b'],
    ],
    badgeColor: [
      ['灯牌等级', ''],
      ['灯牌名称', '.draw-danmaku-medal-name'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC 50–1999', '[data-sc-tier="50"] span, [data-sc-tier="100"] span, [data-sc-tier="500"] span, [data-sc-tier="1000"] span'],
      ['SC ＜50 / ≥2000', '[data-sc-tier="0"] span, [data-sc-tier="2000"] span'],
    ],
  },
  'minimal': {
    amountFontFamily: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC ＜50', '[data-sc-tier="0"] span'],
      ['SC 50–99', '[data-sc-tier="50"] span'],
      ['SC 100–499', '[data-sc-tier="100"] span'],
      ['SC 500–999', '[data-sc-tier="500"] span'],
      ['SC 1000–1999', '[data-sc-tier="1000"] span'],
      ['SC ≥2000', '[data-sc-tier="2000"] span'],
    ],
  },
  'ranked': {
    nicknameFontFamily: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
      ['SC', 'span'],
    ],
    nicknameColor: [
      ['聊天、SC ＜50 / ≥2000', ''],
      ['礼物、上舰', '.is-gift strong'],
      ['SC 50–1999', '[data-sc-tier="50"] span, [data-sc-tier="100"] span, [data-sc-tier="500"] span, [data-sc-tier="1000"] span'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC 50–1999', '[data-sc-tier="50"] span, [data-sc-tier="100"] span, [data-sc-tier="500"] span, [data-sc-tier="1000"] span'],
      ['SC ＜50 / ≥2000', '[data-sc-tier="0"] span, [data-sc-tier="2000"] span'],
    ],
  },
  'transparent': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
      ['舰长', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong'],
      ['提督', '[data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong'],
      ['总督', '[data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC ＜50', '[data-sc-tier="0"] span'],
      ['SC 50–99', '[data-sc-tier="50"] span'],
      ['SC 100–499', '[data-sc-tier="100"] span'],
      ['SC 500–999', '[data-sc-tier="500"] span'],
      ['SC 1000–1999', '[data-sc-tier="1000"] span'],
      ['SC ≥2000', '[data-sc-tier="2000"] span'],
    ],
  },
  'identity': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
      ['聊天', '[data-identity="viewer"]:not(.is-gift):not(.is-superchat) strong, [data-identity="fan"] strong'],
      ['舰长、提督、总督', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong, [data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong, [data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC 50–1999', '[data-sc-tier="50"] span, [data-sc-tier="100"] span, [data-sc-tier="500"] span, [data-sc-tier="1000"] span'],
      ['SC ＜50 / ≥2000', '[data-sc-tier="0"] span, [data-sc-tier="2000"] span'],
    ],
  },
  'sketch': {
    amountFontFamily: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
    ],
  },
  'harbor': {
    nicknameFontFamily: [
      ['上舰、SC', ''],
      ['礼物', '.draw-danmaku-body strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['SC', 'span'],
    ],
    badgeColor: [
      ['第一名', ''],
      ['第二名', '[data-rank="2"]'],
      ['第三名', '[data-rank="3"]'],
    ],
    amountFontFamily: [
      ['礼物、SC', ''],
      ['上舰', '.is-gift span'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC', '.sc-money'],
    ],
  },
  'prismatic': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['聊天', ''],
      ['礼物', '[data-room-guard="0"].is-gift strong'],
      ['SC', 'span'],
      ['舰长上舰', '[data-guard="3"] strong'],
      ['提督上舰', '[data-guard="2"] strong'],
      ['总督上舰', '[data-guard="1"] strong'],
    ],
    badgeFontFamily: [
      ['灯牌等级', ''],
      ['灯牌名称', 'b'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.sc-money'],
      ['上舰', '.is-gift span'],
    ],
    eventColor: [
      ['舰长上舰', ''],
      ['提督上舰', '[data-guard="2"] p'],
      ['总督上舰', '[data-guard="1"] p'],
    ],
  },
  'snowfox': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong, .snowfox-member-name'],
    ],
    nicknameColor: [
      ['聊天、礼物、SC', ''],
      ['上舰', '.snowfox-member-name'],
    ],
    amountFontFamily: [
      ['礼物', ''],
      ['SC', 'span'],
    ],
  },
  'ripploid': {
    nicknameFontFamily: [
      ['聊天', ''],
      ['上舰与 SC', '.ripploid-event-root strong'],
      ['票根署名', 'div'],
    ],
    nicknameColor: [
      ['聊天', ''],
      ['上舰与 SC', '.ripploid-event-root strong'],
      ['票根署名', 'div'],
    ],
    badgeFontFamily: [
      ['身份文字', ''],
      ['灯牌名称', 'b'],
    ],
    amountFontFamily: [
      ['礼物', ''],
      ['SC', '.sc-money span'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.sc-money span'],
    ],
    giftFontFamily: [
      ['礼物名称', ''],
      ['礼物数量', 'span'],
    ],
    giftColor: [
      ['礼物名称', ''],
      ['礼物数量', 'span'],
    ],
    eventFontFamily: [
      ['会员标签', ''],
      ['会员称谓', '.ripploid-member-role'],
      ['系统提示', '.ripploid-system span'],
    ],
    eventColor: [
      ['会员标签', ''],
      ['会员称谓', '.ripploid-member-role'],
      ['系统提示', '.ripploid-system span'],
    ],
    titleFontFamily: [
      ['事件标识', ''],
      ['礼物票根', '.is-gift span'],
      ['SC 标题', '.sc-message span'],
    ],
    titleColor: [
      ['礼物票根', ''],
      ['SC 描边', '.ripploid-sc-title-outline', 'stroke'],
      ['SC 主标题', '.ripploid-sc-title-fill'],
      ['NEW', '.ripploid-member-new'],
      ['礼物＜50', '[data-ripploid-palette="gift-color0"] strong'],
      ['礼物50–99', '[data-ripploid-palette="gift-color50"] strong'],
      ['礼物100–499', '[data-ripploid-palette="gift-color100"] strong'],
      ['礼物500–999', '[data-ripploid-palette="gift-color500"] strong'],
      ['礼物1000–1999', '[data-ripploid-palette="gift-color1000"] strong'],
      ['礼物≥2000', '[data-ripploid-palette="gift-color2000"] strong'],
      ['舰长 MEMBER', '[data-guard="3"] .ripploid-member-title'],
      ['提督 MEMBER', '[data-guard="2"] .ripploid-member-title'],
      ['总督 MEMBER', '[data-guard="1"] .ripploid-member-title'],
    ],
    captionFontFamily: [
      ['票根与护照', ''],
      ['SC 注记', '.sc-message span'],
    ],
    captionColor: [
      ['护照注记', ''],
      ['票根署名', 'small'],
      ['SC 页脚', '.ripploid-sc-footer-copy'],
      ['SC 署名＜50', '[data-sc-tier="0"] .ripploid-sc-sender-label'],
      ['SC 署名50–99', '[data-sc-tier="50"] .ripploid-sc-sender-label'],
      ['SC 署名100–499', '[data-sc-tier="100"] .ripploid-sc-sender-label'],
      ['SC 署名500–999', '[data-sc-tier="500"] .ripploid-sc-sender-label'],
      ['SC 署名1000–1999', '[data-sc-tier="1000"] .ripploid-sc-sender-label'],
      ['SC 署名≥2000', '[data-sc-tier="2000"] .ripploid-sc-sender-label'],
    ],
  },
  'christmas': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    nicknameColor: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong'],
    ],
    amountColor: [
      ['礼物、上舰', ''],
      ['SC', '.is-superchat span'],
    ],
    eventColor: [
      ['礼物、上舰、SC', ''],
      ['礼物、上舰', '.christmas-copy span'],
    ],
  },
  'stargazer': {
    textColor: [
      ['聊天·色系 1', '[data-stargazer-kind="chat"][data-stargazer-tone="0"] p, [data-stargazer-kind="system"][data-stargazer-tone="0"] p'],
      ['聊天·色系 2', '[data-stargazer-kind="chat"]:not([data-stargazer-tone="0"]) p, [data-stargazer-kind="system"]:not([data-stargazer-tone="0"]) p'],
      ['SC·色系 1', '[data-stargazer-kind="superchat"][data-stargazer-tone="0"] p'],
      ['SC·色系 2', '[data-stargazer-kind="superchat"]:not([data-stargazer-tone="0"]) p'],
    ],
    nicknameColor: [
      ['事件金色', ''],
      ['聊天金色', '[data-stargazer-kind="chat"][data-stargazer-tone="1"] strong, [data-stargazer-kind="chat"][data-stargazer-tone="3"] strong, [data-stargazer-kind="system"][data-stargazer-tone="1"] strong, [data-stargazer-kind="system"][data-stargazer-tone="3"] strong'],
      ['事件深色', '[data-stargazer-tone="0"] .stargazer-sender'],
      ['事件紫色', '[data-stargazer-tone="2"] .stargazer-sender'],
      ['聊天深色', '[data-stargazer-kind="chat"][data-stargazer-tone="0"] strong, [data-stargazer-kind="system"][data-stargazer-tone="0"] strong'],
      ['聊天紫色', '[data-stargazer-kind="chat"][data-stargazer-tone="2"] strong, [data-stargazer-kind="system"][data-stargazer-tone="2"] strong'],
    ],
    badgeColor: [
      ['聊天紫色', ''],
      ['会员紫色', '[data-stargazer-kind="member"][data-stargazer-tone="1"] span, [data-stargazer-kind="member"][data-stargazer-tone="2"] span, [data-stargazer-kind="member"][data-stargazer-tone="3"] span'],
      ['聊天金色', '[data-stargazer-kind="chat"][data-stargazer-tone="0"] span'],
      ['会员金色', '[data-stargazer-kind="member"][data-stargazer-tone="0"] span'],
    ],
    amountColor: [
      ['礼物与上舰', ''],
      ['SC 金色', '[data-stargazer-kind="superchat"][data-stargazer-tone="1"] span, [data-stargazer-kind="superchat"][data-stargazer-tone="3"] span'],
      ['礼物与上舰深色', '[data-stargazer-kind="gift"][data-stargazer-tone="0"] span, [data-stargazer-kind="member"][data-stargazer-tone="0"] span'],
      ['SC 深色', '[data-stargazer-kind="superchat"][data-stargazer-tone="0"] span'],
      ['SC 紫色', '[data-stargazer-kind="superchat"][data-stargazer-tone="2"] span'],
    ],
    eventColor: [
      ['礼物与上舰', ''],
      ['SC 金色', '[data-stargazer-tone="1"] strong, [data-stargazer-tone="3"] strong'],
      ['SC 图标深色', '[data-stargazer-tone="1"] .stargazer-icon, [data-stargazer-tone="2"] .stargazer-icon'],
      ['礼物与上舰深色', '[data-stargazer-tone="0"] .stargazer-action'],
      ['SC 深色', '[data-stargazer-tone="0"] strong'],
      ['SC 图标金色', '[data-stargazer-tone="0"] .stargazer-icon'],
      ['SC 紫色', '[data-stargazer-tone="2"] strong'],
      ['SC 图标紫色', '[data-stargazer-tone="3"] .stargazer-icon'],
    ],
  },
  'wireframe': {
    badgeFontFamily: [
      ['舰长、提督、总督、上舰', ''],
      ['粉丝、主播', '.wireframe-medal'],
    ],
  },
  'christmas-letter': {
    nicknameColor: [
      ['礼物', ''],
      ['SC', '.is-superchat strong'],
      ['普通观众、粉丝、房管', '[data-role="viewer"][data-letter-kind="chat"] strong, [data-role="fan"] strong'],
      ['舰长', '[data-role="captain"][data-letter-kind="chat"] strong'],
      ['提督', '[data-role="admiral"][data-letter-kind="chat"] strong'],
      ['总督', '[data-role="governor"][data-letter-kind="chat"] strong'],
      ['主播', '[data-streamer="true"] strong'],
      ['舰长上舰', '[data-letter-tier="captain"] strong'],
      ['提督上舰', '[data-letter-tier="admiral"] strong'],
      ['总督上舰', '[data-letter-tier="governor"] strong'],
    ],
    badgeColor: [
      ['粉丝', ''],
      ['舰长', '[data-role="captain"][data-letter-kind="chat"] span'],
      ['提督', '[data-role="admiral"][data-letter-kind="chat"] span'],
      ['总督', '[data-role="governor"][data-letter-kind="chat"] span'],
      ['主播', '[data-streamer="true"] span'],
      ['舰长上舰', '[data-letter-tier="captain"] span'],
      ['提督上舰', '[data-letter-tier="admiral"] span'],
      ['总督上舰', '[data-letter-tier="governor"] span'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.is-superchat strong'],
      ['舰长上舰', '[data-role="captain"] strong'],
      ['提督上舰', '[data-role="admiral"] strong'],
      ['总督上舰', '[data-role="governor"] strong'],
    ],
  },
  'notebook': {
    nicknameColor: [
      ['礼物、SC', ''],
      ['聊天', '[data-notebook-role="ordinary"][data-notebook-kind="chat"] strong'],
      ['舰长、舰长上舰', '[data-identity="captain"] strong'],
      ['提督、提督上舰', '[data-identity="admiral"] strong'],
      ['总督、总督上舰', '[data-identity="governor"] strong'],
    ],
  },
  'glowy': {
    nicknameColor: [
      ['礼物', ''],
      ['SC', '.is-superchat strong'],
      ['聊天', '[data-glowy-kind="chat"][data-glowy-role="0"] strong'],
      ['舰长、舰长上舰', '[data-glowy-role="3"] strong'],
      ['提督、提督上舰', '[data-glowy-role="2"] strong'],
      ['总督、总督上舰', '[data-glowy-role="1"] strong'],
      ['主播', '[data-streamer="true"] strong'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.is-superchat span'],
      ['舰长上舰', '[data-glowy-role="3"] span'],
      ['提督上舰', '[data-glowy-role="2"] span'],
      ['总督上舰', '[data-glowy-role="1"] span'],
    ],
  },
  'animated-gradient': {
    nicknameColor: [
      ['系统、礼物、上舰、SC', ''],
      ['聊天', '.gradient-heading strong'],
    ],
  },
  'spooky': {
    eventColor: [
      ['礼物、上舰', ''],
      ['SC', '.spooky-sc p'],
    ],
  },
  'twitter': {
    eventColor: [
      ['礼物、SC', ''],
      ['上舰', 'p'],
      ['舰长上舰', '[data-guard="3"] span'],
      ['提督上舰', '[data-guard="2"] span'],
      ['总督上舰', '[data-guard="1"] span'],
    ],
    profileInfoColor: [
      ['账号与未选标签', ''],
      ['关注按钮', '.twitter-profile span'],
      ['当前标签', '.is-active'],
    ],
  },
  'flower-letter': {
    nicknameColor: [
      ['聊天、礼物、SC', ''],
      ['上舰', '.flower-join span'],
    ],
  },
  'dark-moon': {
    nicknameColor: [
      ['礼物、上舰、SC', ''],
      ['聊天', '[data-moon-kind="chat"] strong'],
    ],
  },
  'moonlit': {
    nicknameFontFamily: [
      ['聊天、SC', ''],
      ['礼物、上舰', '.is-gift strong, div'],
    ],
    nicknameColor: [
      ['礼物、SC', ''],
      ['聊天、上舰', '.moonlit-chat strong, div'],
    ],
    badgeColor: [
      ['粉丝', ''],
      ['舰长', '[data-identity="captain"] b'],
      ['提督', '[data-identity="admiral"] b'],
      ['总督', '[data-identity="governor"] b'],
    ],
  },
  'sea-breeze': {
    nicknameColor: [
      ['聊天、礼物、上舰', ''],
      ['SC ＜50', '[data-sc-tier="0"] strong'],
      ['SC 50–99', '[data-sc-tier="50"] strong'],
      ['SC 100–499', '[data-sc-tier="100"] strong'],
      ['SC 500–999', '[data-sc-tier="500"] strong'],
      ['SC 1000–1999', '[data-sc-tier="1000"] strong'],
      ['SC ≥2000', '[data-sc-tier="2000"] strong'],
    ],
    badgeColor: [
      ['聊天、礼物、上舰、SC', ''],
      ['聊天、上舰', '.sea-breeze-medal'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC ＜50', '[data-sc-tier="0"] span'],
      ['SC 50–99', '[data-sc-tier="50"] span'],
      ['SC 100–499', '[data-sc-tier="100"] span'],
      ['SC 500–999', '[data-sc-tier="500"] span'],
      ['SC 1000–1999', '[data-sc-tier="1000"] span'],
      ['SC ≥2000', '[data-sc-tier="2000"] span'],
    ],
  },
  'sea-breeze-random': {
    nicknameColor: [
      ['聊天、礼物、上舰', ''],
      ['SC ＜50', '[data-sc-tier="0"] strong'],
      ['SC 50–99', '[data-sc-tier="50"] strong'],
      ['SC 100–499', '[data-sc-tier="100"] strong'],
      ['SC 500–999', '[data-sc-tier="500"] strong'],
      ['SC 1000–1999', '[data-sc-tier="1000"] strong'],
      ['SC ≥2000', '[data-sc-tier="2000"] strong'],
    ],
    badgeColor: [
      ['聊天、礼物、上舰、SC', ''],
      ['聊天、上舰', '.sea-breeze-medal'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC ＜50', '[data-sc-tier="0"] span'],
      ['SC 50–99', '[data-sc-tier="50"] span'],
      ['SC 100–499', '[data-sc-tier="100"] span'],
      ['SC 500–999', '[data-sc-tier="500"] span'],
      ['SC 1000–1999', '[data-sc-tier="1000"] span'],
      ['SC ≥2000', '[data-sc-tier="2000"] span'],
    ],
  },
  'outline': {
    nicknameFontFamily: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['聊天', '[data-identity="viewer"]:not(.is-gift):not(.is-superchat) strong, [data-identity="fan"] strong'],
      ['舰长', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong'],
      ['提督', '[data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong'],
      ['总督', '[data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
  },
  'window': {
    badgeFontFamily: [
      ['灯牌等级', ''],
      ['灯牌名称', 'b'],
    ],
  },
  'glass-bubble': {
    amountColor: [
      ['礼物', ''],
      ['上舰', '[data-glass-bubble-kind="member"] span'],
      ['SC ＜50 / 50–99 / 100–499', '[data-glass-bubble-tier="blue"] span'],
      ['SC 500–999', '[data-sc-tier="500"] span'],
      ['SC 1000–1999', '[data-sc-tier="1000"] span'],
      ['SC ≥2000', '[data-sc-tier="2000"] span'],
    ],
  },
  'mist': {
    nicknameColor: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
      ['SC', 'span'],
    ],
    amountFontFamily: [
      ['礼物、SC', ''],
      ['上舰', '.is-gift span'],
    ],
    amountColor: [
      ['礼物', ''],
      ['SC', '.sc-money'],
      ['上舰', '.is-gift span'],
    ],
  },
  'cream': {
    nicknameFontFamily: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['聊天', '[data-identity="viewer"]:not(.is-gift):not(.is-superchat) strong, [data-identity="fan"] strong'],
      ['舰长', '[data-identity="captain"]:not(.is-gift):not(.is-superchat) strong'],
      ['提督', '[data-identity="admiral"]:not(.is-gift):not(.is-superchat) strong'],
      ['总督', '[data-identity="governor"]:not(.is-gift):not(.is-superchat) strong'],
    ],
  },
  'startrail': {
    nicknameColor: [
      ['聊天、礼物', ''],
      ['舰长、舰长上舰', '[data-identity="captain"] strong'],
      ['提督、提督上舰', '[data-identity="admiral"] strong'],
      ['总督、总督上舰', '[data-identity="governor"] strong'],
    ],
  },
  'starveil': {
    textColor: Array.from({ length: 6 }, (_, index) => [`色系 ${index + 1}`, `[data-palette="${index}"] p`]),
    nicknameColor: [
      ['色系 1', ''],
      ['色系 2', '[data-palette="1"] strong'],
      ['色系 3', '[data-palette="2"] strong'],
      ['色系 4', '[data-palette="3"] strong'],
      ['色系 5', '[data-palette="4"] strong'],
      ['色系 6', '[data-palette="5"] strong'],
    ],
    amountColor: [
      ['色系 3', ''],
      ['色系 4', '[data-palette="3"] b'],
      ['色系 5', '[data-palette="4"] b'],
      ['色系 6', '[data-palette="5"] b'],
      ['色系 1', '[data-palette="0"] b'],
      ['色系 2', '[data-palette="1"] b'],
    ],
    eventColor: [
      ['色系 3', ''],
      ['色系 4', '[data-palette="3"] span'],
      ['色系 5', '[data-palette="4"] span'],
      ['色系 6', '[data-palette="5"] span'],
      ['色系 1', '[data-palette="0"] span'],
      ['色系 2', '[data-palette="1"] span'],
    ],
  },
  'glow': {
    nicknameFontFamily: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
    ],
    nicknameColor: [
      ['礼物、上舰', ''],
      ['聊天', '.draw-danmaku-item:not(.is-gift):not(.is-superchat) strong'],
    ],
    eventColor: [
      ['礼物', ''],
      ['舰长上舰', '[data-identity="captain"] span'],
      ['提督上舰', '[data-identity="admiral"] span'],
      ['总督上舰', '[data-identity="governor"] span'],
    ],
  },
};

function danmakuTextAppearanceFields(style) {
  const fields = {};
  for (const [parent, parts] of Object.entries(DANMAKU_TEXT_APPEARANCE[style] || {})) {
    const type = parent.endsWith('Color') ? 'color' : 'font';
    const suffix = type === 'color' ? 'Color' : 'FontFamily';
    const role = parent === 'textColor' ? 'body' : parent.slice(0, -suffix.length);
    fields[parent] = { appearanceParts: true };
    parts.forEach(([label, selector, colorProperty, appearanceWhen], index) => {
      fields[`${role}Part${index + 1}${suffix}`] = {
        textRole: role, group: `text:${role}`, type, label, default: 'default',
        ...(type === 'color' ? { alpha: true, allowDefault: true } : {}),
        appearanceParent: parent, appearanceLabel: label,
        ...(role === 'body' ? { appearanceTarget: BODY_TEXT_TARGETS[style] } : {}),
        appearanceSelector: selector || `:not(:is(${parts.slice(1).map(part => part[1]).join(', ')}))`,
        ...(colorProperty ? { colorProperty } : {}),
        ...(appearanceWhen ? { appearanceWhen } : {}),
      };
    });
  }
  return fields;
}

export { DANMAKU_TEXT_APPEARANCE, danmakuTextAppearanceFields };
