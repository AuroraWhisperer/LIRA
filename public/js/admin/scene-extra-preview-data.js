const giftFeedAvatars = ['viewer', 'captain', 'admiral'];
const giftFeedGifts = [
  { giftId: '31036', giftName: '小花花', unitPrice: 0.1, artwork: 'flower' },
  { giftId: '31039', giftName: '牛哇牛哇', unitPrice: 0.1, artwork: 'cheer' },
  { giftId: '35534', giftName: '打call', unitPrice: 0.2, artwork: 'call' },
];

export function sceneExtraPreviewData(type) {
  const session = (game, state) => ({ game, sessionId: `preview-${game}`, eventRevision: 1, state, danmaku: [] });
  const examples = {
    opening: null,
    songlist: { songs: Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `示例歌曲 ${index + 1}`, artist: '示例歌手', category_name: '流行', language: '国语', name_initial: 'S' })) },
    lyrics: { lyricTimeline: { trackTitle: '示例歌曲', lines: [
      { startMs: 0, endMs: 10000, text: '把此刻唱成一首歌', translation: 'Sing this moment into a song' },
      { startMs: 10000, endMs: 20000, text: '让旋律陪伴每一刻', translation: '' },
    ] }, lyricState: { trackTitle: '示例歌曲', lineText: '把此刻唱成一首歌', currentMs: 3000, durationMs: 20000, playing: false, status: 'ready' } },
    games: { sessions: {
      'number-bomb': session('number-bomb', { min: 25, max: 78, lastGuess: 25, turn: 'host', winner: null }),
      gomoku: session('gomoku', { size: 15, board: Array.from({ length: 15 }, (_, y) => Array.from({ length: 15 }, (_, x) => y === 7 && [6, 7, 8].includes(x) ? (x === 7 ? 2 : 1) : 0)), turn: 'host', winner: null }),
      'draw-guess': session('draw-guess', { phase: 'drawing', round: 1, totalRounds: 5, wordLength: 3, remainingMs: 60000, serverNowMs: Date.now(), answerRevealed: false, correct: [], scores: [], canvas: { revision: 1, totalPoints: 0, strokes: [] } }),
    } },
    wheel: { entries: [{ label: '唱一首歌', weight: 1 }, { label: '聊聊天', weight: 1 }, { label: '再来一次', weight: 1 }, { label: '谢谢参与', weight: 1 }], spin: null, lastResult: null },
    interactions: { sessions: {
      poll: { sessionId: 'preview-poll', kind: 'poll', phase: 'active', participants: 100, endsAt: Date.now() + 60000, options: [{ text: '流行歌曲', votes: 65, percentage: 65 }, { text: '经典老歌', votes: 35, percentage: 35 }] },
      rating: { sessionId: 'preview-rating', kind: 'rating', phase: 'finished', participants: 100, average: 8.6 },
    } },
    blindbox: { summary: { boxCount: 12, totalCost: 120, totalProfit: 36 }, perUser: [{ userName: '示例观众', boxCount: 8, totalProfit: 42 }, { userName: '另一位观众', boxCount: 4, totalProfit: -6 }] },
    'gift-feed': {
      items: [[0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [2, 0]].map(([viewer, giftIndex], index) => {
        const { artwork, ...gift } = giftFeedGifts[giftIndex];
        return { eventId: `preview-${index}`, artworkPath: `/img/overlays/gift-feed/${artwork}.webp`, gift: {
          ...gift, userName: `示例观众 ${viewer + 1}`,
          avatarUrl: `/img/overlays/danmaku-ranked/${giftFeedAvatars[viewer]}.webp`,
          coinType: 'gold', num: index + 1, createdAt: new Date().toISOString(), guardLevel: 0,
        } };
      }),
      profiles: [], catalog: [], day: new Date(Date.now() + 28800000).toISOString().slice(0, 10),
    },
    'gift-frame': { preview: true, events: [{ type: 'gift:frame', eventId: 'canvas-frame-preview',
      userName: '观众A', giftName: '林间花信', num: 2, totalPriceCents: 52000, themeId: 'woodland-bloom' }] },
    'guard-thanks': { preview: true, events: [{ type: 'gift:guard-thanks', eventId: 'canvas-guard-preview',
      userName: '观众A', tier: 'captain', months: 1, textMode: 'bilingual' }] },
    'gift-wishes': { items: [{ id: 'preview-wish', period: 'day', giftId: '1', giftName: '小花花', target: 100, count: 36, todayCount: 36, remaining: 64, progress: 36, completed: false, label: '今日小心愿', displayStyle: 'card', textTemplate: '{礼物} {已收}/{目标}', textImagePosition: 'none', textImageFormat: 'static' }], session: { state: 'live', stale: false } },
  };
  return examples[type];
}
