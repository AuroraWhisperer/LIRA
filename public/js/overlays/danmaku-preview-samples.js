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
      '好耶，贴贴！',
      '单推打卡！今天也被可爱到了',
      '新衣装好可爱，猫耳和小辫子都想夸一遍！',
      '这段我能循环一整晚，能再来一次吗',
      '出道纪念快乐！\n下次歌回也会准时来的',
      '从初见到现在，每次歌回都舍不得走，小偶像今天也闪闪发光，今后还要一起看好多次星星',
      '最喜欢你了'.repeat(8),
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
      '晚上好',
      '刚下班赶上了，今天唱得真好听',
      '这首歌叫什么呀，想加进通勤歌单',
      '今天终于把考试考完了，来听两首歌放松一下',
      '生日快乐！\n忙完才来，还好赶上了',
      '今天加班到现在才到家，打开直播刚好唱到我喜欢的歌，谢谢你的陪伴，也记得喝水休息呀',
      '再来一首'.repeat(10),
    ],
  },
};

const EMOTE = { text: '[打call]', url: '/img/overlays/danmaku-previews/dacall.png', kind: 'inline', width: 96, height: 96 };
const AVATAR = '/img/overlays/danmaku-ranked/viewer.webp';
const SC_PRICES = [2, 30, 50, 100, 500, 1000, 2000];
// The current Bilibili account editor caps nicknames at 16 characters.
const VIEWER_NAMES = {
  anime: ['小凛', '团子酱ovo', '猫猫单推人', '咕咕咕_咕咕', '今天也想和猫耳少女一起抬头看星星', 'Misaki-0721'],
  everyday: ['阿哲', '想吃火锅不想洗碗', '摸鱼小王_233', 'bili_804672193', '下班以后只想窝在沙发上听两首老歌', 'LateNightFM_2026'],
};

export const DANMAKU_PREVIEW_ENTRY = Object.freeze({
  id: 'preview-entry', kind: 'entry', name: '路过的咸鱼_07', message: '进入了直播间',
});

// Amounts are synthetic RMB totals for layout coverage, not a current price list.
const GIFTS = [
  { id: '10', giftName: '小花花', giftCount: 10, giftTotalPrice: 1 },
  { id: 'cheer', giftName: '牛哇牛哇', giftCount: 1, giftTotalPrice: 0.1 },
  { id: 'call', giftName: '打call', giftCount: 66, giftTotalPrice: 13.2 },
  { id: 'crystal', giftName: '水晶球', giftCount: 1, giftTotalPrice: 100 },
  { id: 'spaceship', giftName: '小电视飞船', giftCount: 1, giftTotalPrice: 1245 },
];
const GUARDS = [
  { giftGuardLevel: 3, name: VIEWER_NAMES.anime[5], giftName: '舰长', giftTotalPrice: 138, guardAction: 'renew', guardAccompanyDays: 360 },
  { giftGuardLevel: 2, name: VIEWER_NAMES.everyday[5], giftName: '提督', giftTotalPrice: 1998, guardAction: 'open', guardAccompanyDays: 1 },
  { giftGuardLevel: 1, name: VIEWER_NAMES.anime[4], giftName: '总督', giftTotalPrice: 19998, guardAction: 'open', guardAccompanyDays: 1 },
];

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
    { id: 'preview-emote', name: '小眠Mio', isStreamer: true, message: EMOTE.text, emotes: [{ ...EMOTE, kind: 'sticker' }] },
    ...GIFTS.map(({ id, ...gift }, index) => ({
      ...gift, id: `preview-gift-${id}`, kind: 'gift', name: VIEWER_NAMES.everyday[index],
      message: `送出 ${gift.giftName} × ${gift.giftCount}`, giftImageUrl: '/img/gift-placeholder.png',
    })),
    ...GUARDS.map((gift) => ({
      ...gift, id: `preview-guard-${gift.giftGuardLevel}`, kind: 'gift', giftCount: 1, avatarUrl: AVATAR,
      message: `${gift.guardAction === 'renew' ? '续费' : '开通'}了${gift.giftName}`,
    })),
    ...Object.entries(TEXT_POOLS).flatMap(([tone, pool]) => pool.superchat.map((message, index) => ({
      id: `preview-superchat-${SC_PRICES[index]}-${tone}`, kind: 'superchat',
      name: VIEWER_NAMES[tone][index % VIEWER_NAMES[tone].length], avatarUrl: AVATAR, message, price: SC_PRICES[index],
    }))),
  ];
  if (style !== 'prismatic') return samples;
  const palettes = {
    1: [50, '#A773F199', '#D47AFF'], 2: [38, '#4C7DFF99', '#58A1F8'],
    3: [28, '#3FB4F699', '#5FC7F4'], 0: [9, '#5762A799', '#5762A7'],
  };
  return samples.map((item, index) => {
    const roomGuardLevel = item.guardLevel || 0;
    const [level, color, border] = palettes[roomGuardLevel];
    return {
      ...item, avatarUrl: item.avatarUrl || AVATAR,
      honorLevel: [70, 45, 32, 19, 28][index % 5], roomGuardLevel,
      ...(item.medalLevel ? { roomMedal: { name: item.medalName, level, guardLevel: roomGuardLevel, isLight: true,
        colorStart: color, colorEnd: color, colorBorder: border, colorText: '#FFFFFF' } } : {}),
    };
  });
}
