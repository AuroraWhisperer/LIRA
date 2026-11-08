// Synthetic preview content; no live messages, viewer profiles or gift catalog requests.
const TEXT_POOLS = {
  anime: {
    chat: [
      '好耶！',
      'kksk',
      '可爱捏，猫耳刚刚是不是动了一下',
      '这段直接循环！今天的快乐是小偶像给的',
      '本来只想路过听一首，结果从开场坐到现在，猫猫再唱一首嘛，唱完这首我就真去睡觉啦！',
      '可爱捏'.repeat(13),
    ],
    mixed: ['这个转音，耳朵怀孕了[打call]', '好耶好耶' + '[打call]'.repeat(5)],
    superchat: [
      [2, '好耶，贴贴！'],
      [50, '新衣装好可爱，猫耳和小辫子都想夸一遍！'],
      [500, '出道纪念快乐！\n下次歌回也会准时来的'],
      [2000, '最喜欢你了'.repeat(8)],
    ],
  },
  everyday: {
    chat: [
      '来了',
      '哈哈哈哈',
      '刚下班，今天播到几点呀',
      '游戏声音有点大，人声可以再调高一点吗',
      '刚刚在地铁上没听清歌名，现在终于到家戴上耳机了，有没有好心人告诉我上一首叫什么呀',
      '哈哈'.repeat(20),
    ],
    mixed: ['刚才那波操作真给我看愣了[打call]', '今天这首唱得真好听[打call][打call]'],
    superchat: [
      [30, '刚下班赶上了，今天唱得真好听'],
      [100, '今天终于把考试考完了，来听两首歌放松一下'],
      [1000, '今天加班到现在才到家，打开直播刚好唱到我喜欢的歌，谢谢你的陪伴，也记得喝水休息呀'],
    ],
  },
};

const EMOTE = { text: '[打call]', url: '/img/overlays/danmaku-previews/dacall.png', kind: 'inline', width: 96, height: 96 };
const STICKER_EMOTES = [
  { text: '鼓掌', url: '/img/overlays/danmaku-previews/stickers/tv-clap.png', width: 162, height: 162 },
  { text: '冲鸭', url: '/img/overlays/danmaku-previews/stickers/rush-duck.png', width: 200, height: 60 },
  { text: '这个好耶', url: '/img/overlays/danmaku-previews/stickers/this-is-great.png', width: 200, height: 60 },
  { text: '笑哭', url: '/img/overlays/danmaku-previews/stickers/tv-laugh.png', width: 162, height: 162 },
];
const AVATAR = '/img/overlays/danmaku-ranked/viewer.webp';
// The current Bilibili account editor caps nicknames at 16 characters.
const VIEWER_NAMES = {
  anime: ['小凛', '团子酱ovo', '猫猫单推人', '咕咕咕_咕咕', '今天也想和猫耳少女一起抬头看星星', 'Misaki-0721'],
  everyday: ['阿哲', '想吃火锅不想洗碗', '摸鱼小王_233', 'bili_804672193', '下班以后只想窝在沙发上听两首老歌', 'LateNightFM_2026'],
};

export const DANMAKU_PREVIEW_WELCOME = Object.freeze({
  id: 'preview-welcome', kind: 'danmaku', name: 'LIRA 机器人', message: '欢迎 路过的咸鱼_07 来到直播间～', isWelcome: true,
});

// Amounts are synthetic RMB totals for layout coverage, not a current price list.
const GIFTS = [
  { id: '10', giftName: '小花花', giftCount: 10, giftTotalPrice: 1, giftImageUrl: '/img/overlays/danmaku-previews/gifts/flower.webp' },
  { id: 'cheer', giftName: '牛哇牛哇', giftCount: 1, giftTotalPrice: 0.1, giftImageUrl: '/img/overlays/danmaku-previews/gifts/cheer.webp' },
  { id: 'call', giftName: '打call', giftCount: 66, giftTotalPrice: 13.2, giftImageUrl: '/img/overlays/danmaku-previews/gifts/call.webp' },
  { id: 'crystal', giftName: '星愿水晶球', giftCount: 1, giftTotalPrice: 100, giftImageUrl: '/img/overlays/danmaku-previews/gifts/crystal.webp' },
  { id: 'spaceship', giftName: '小电视飞船', giftCount: 1, giftTotalPrice: 1245, giftImageUrl: '/img/overlays/danmaku-previews/gifts/spaceship.webp' },
  { id: 'call-crazy', giftName: '疯狂打call', giftCount: 1, giftTotalPrice: 52, giftImageUrl: '/img/overlays/danmaku-previews/gifts/call-crazy.png' },
  { id: 'golden-figure', giftName: '小金人', giftCount: 1, giftTotalPrice: 520, giftImageUrl: '/img/overlays/danmaku-previews/gifts/golden-figure.png' },
];
const GUARDS = [
  { giftGuardLevel: 3, name: VIEWER_NAMES.anime[5], giftName: '舰长', giftTotalPrice: 138, giftImageUrl: '/img/admin/gifts/bilibili-guard-captain.webp' },
  { giftGuardLevel: 2, name: VIEWER_NAMES.everyday[5], giftName: '提督', giftTotalPrice: 1998, giftImageUrl: '/img/admin/gifts/bilibili-guard-prefect.webp' },
  { giftGuardLevel: 1, name: VIEWER_NAMES.anime[4], giftName: '总督', giftTotalPrice: 19998, giftImageUrl: '/img/admin/gifts/bilibili-guard-governor.webp' },
];

export const DANMAKU_PREVIEW_GIFT_IMAGES = Object.freeze([...GIFTS, ...GUARDS].map((gift) => gift.giftImageUrl));

export function createDanmakuPreviewItems(style = 'signal') {
  const samples = [
    ...[
      ['1091', GUARDS[2].name, 1, 28, TEXT_POOLS.anime.mixed[0]],
      ['1822', GUARDS[1].name, 2, 23, TEXT_POOLS.everyday.mixed[0]],
      ['4714', GUARDS[0].name, 3, 18, TEXT_POOLS.anime.mixed[1]],
      ['565', VIEWER_NAMES.everyday[1], 0, 9, TEXT_POOLS.everyday.mixed[1]],
    ].map(([id, name, guardLevel, medalLevel, message]) => ({
      id: `preview-${id}`, name, message, guardLevel, medalName: '粉丝团灯牌', medalLevel, emotes: [{ ...EMOTE }],
    })),
    ...Object.entries(TEXT_POOLS).flatMap(([tone, pool]) => pool.chat.map((message, index) => ({
      id: `preview-chat-${tone}-${index}`, name: VIEWER_NAMES[tone][index], message,
    }))),
    { id: 'preview-inline', name: VIEWER_NAMES.anime[0], message: EMOTE.text, emotes: [{ ...EMOTE }] },
    { id: 'preview-inline-repeat', name: VIEWER_NAMES.anime[1], message: EMOTE.text.repeat(5), emotes: [{ ...EMOTE }] },
    ...STICKER_EMOTES.map((emote, index) => ({
      id: index === 0 ? 'preview-emote' : `preview-emote-${index + 1}`, name: '小眠Mio', isStreamer: true,
      message: emote.text, emotes: [{ ...emote, kind: 'sticker' }],
    })),
    ...GIFTS.map(({ id, ...gift }, index) => ({
      ...gift, id: `preview-gift-${id}`, kind: 'gift', name: VIEWER_NAMES.everyday[index % VIEWER_NAMES.everyday.length],
      message: `送出 ${gift.giftName} × ${gift.giftCount}`,
    })),
    ...GUARDS.flatMap((gift) => ['open', 'renew'].map((guardAction) => ({
      ...gift, id: `preview-guard-${gift.giftGuardLevel}-${guardAction}`, kind: 'gift', giftCount: 1, avatarUrl: AVATAR,
      guardAction, guardAccompanyDays: guardAction === 'renew' ? 360 : 1,
      message: `${guardAction === 'renew' ? '续费' : '开通'}了${gift.giftName}`,
    }))),
    ...Object.entries(TEXT_POOLS).flatMap(([tone, pool]) => pool.superchat.map(([price, message], index) => ({
      id: `preview-superchat-${price}-${tone}`, kind: 'superchat',
      name: VIEWER_NAMES[tone][index % VIEWER_NAMES[tone].length], avatarUrl: AVATAR, message, price,
    }))),
  ];
  if (style === 'stargazer') return samples.map((item) => ({
    ...item, roomGuardLevel: item.guardLevel || 0,
    ...(item.medalLevel ? { roomMedal: { name: item.medalName, level: item.medalLevel } } : {}),
  }));
  if (style === 'twitter') return samples.map((item, index) => ({
    ...item, uid: String(100000 + index), avatarUrl: item.avatarUrl || AVATAR,
    roomGuardLevel: item.guardLevel || 0,
  }));
  if (['glowy', 'mist', 'comic', 'wireframe'].includes(style)) return samples.map((item) => ({
    ...item, avatarUrl: item.avatarUrl || AVATAR, roomGuardLevel: item.guardLevel || 0,
  }));
  if (style === 'harbor') return samples.map((item, index) => ({
    ...item, avatarUrl: item.avatarUrl || AVATAR, roomGuardLevel: item.guardLevel || 0,
    ...(index < 3 ? { onlineRank: index + 1 } : {}),
  }));
  if (!['prismatic', 'snowfox', 'ripploid', 'flower-letter', 'notebook', 'christmas', 'christmas-letter', 'window'].includes(style)) return samples;
  const palettes = {
    1: [50, '#A773F199', '#D47AFF'], 2: [38, '#4C7DFF99', '#58A1F8'],
    3: [28, '#3FB4F699', '#5FC7F4'], 0: [9, '#5762A799', '#5762A7'],
  };
  return samples.map((item, index) => {
    const christmasMember = style === 'christmas-letter' && item.giftGuardLevel;
    const roomGuardLevel = item.guardLevel || christmasMember || 0;
    const [level, color, border] = palettes[roomGuardLevel];
    return {
      ...item, avatarUrl: item.avatarUrl || AVATAR,
      honorLevel: [70, 45, 32, 19, 28][index % 5], roomGuardLevel,
      ...(item.medalLevel || christmasMember ? { roomMedal: { name: christmasMember ? item.medalName || '小铃铛' : item.medalName, level, guardLevel: roomGuardLevel, isLight: true,
        colorStart: color, colorEnd: color, colorBorder: border, colorText: '#FFFFFF' } } : {}),
    };
  });
}
