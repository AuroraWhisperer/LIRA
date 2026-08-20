'use strict';

const DEFAULT_TOTAL_ROUNDS = 5;
const ROUND_DURATION_MS = 90 * 1000;
const SCORE_BY_RANK = [10, 7, 5];
const LATER_CORRECT_SCORE = 3;
const DRAW_COLORS = new Set(['#222034', '#6c5ce7', '#ef476f', '#118ab2', '#06d6a0', '#f6bd60', '#ffffff']);
const DRAW_WIDTHS = new Set([2, 4, 8, 12]);
const MAX_STROKES = 160;
const MAX_POINTS_PER_STROKE = 500;
const MAX_POINTS_PER_OPERATION = 32;
const MAX_TOTAL_POINTS = 6000;

const DEFAULT_WORDS = [
  { word: '苹果', category: '食物' },
  { word: '冰淇淋', category: '食物', aliases: ['冰激凌'] },
  { word: '火锅', category: '食物' },
  { word: '汉堡包', category: '食物', aliases: ['汉堡'] },
  { word: '生日蛋糕', category: '食物', aliases: ['蛋糕'] },
  { word: '西瓜', category: '食物' },
  { word: '奶茶', category: '食物' },
  { word: '饺子', category: '食物' },
  { word: '长颈鹿', category: '动物' },
  { word: '大熊猫', category: '动物', aliases: ['熊猫'] },
  { word: '企鹅', category: '动物' },
  { word: '章鱼', category: '动物' },
  { word: '刺猬', category: '动物' },
  { word: '袋鼠', category: '动物' },
  { word: '海豚', category: '动物' },
  { word: '猫头鹰', category: '动物' },
  { word: '月亮', category: '自然' },
  { word: '彩虹', category: '自然' },
  { word: '火山', category: '自然' },
  { word: '龙卷风', category: '自然' },
  { word: '向日葵', category: '自然' },
  { word: '仙人掌', category: '自然' },
  { word: '雪人', category: '自然' },
  { word: '瀑布', category: '自然' },
  { word: '摩天轮', category: '地点与设施' },
  { word: '红绿灯', category: '地点与设施' },
  { word: '游泳池', category: '地点与设施' },
  { word: '电影院', category: '地点与设施' },
  { word: '图书馆', category: '地点与设施' },
  { word: '过山车', category: '地点与设施' },
  { word: '宇宙飞船', category: '物品', aliases: ['飞船'] },
  { word: '降落伞', category: '物品' },
  { word: '灭火器', category: '物品' },
  { word: '望远镜', category: '物品' },
  { word: '吉他', category: '物品' },
  { word: '闹钟', category: '物品' },
  { word: '雨伞', category: '物品' },
  { word: '耳机', category: '物品' },
  { word: '打篮球', category: '动作' },
  { word: '钓鱼', category: '动作' },
  { word: '刷牙', category: '动作' },
  { word: '放风筝', category: '动作' },
  { word: '滑雪', category: '动作' },
  { word: '拍照', category: '动作' },
  { word: '睡懒觉', category: '动作' },
  { word: '唱歌', category: '动作' },
  { word: '孙悟空', category: '角色' },
  { word: '美人鱼', category: '角色' },
  { word: '圣诞老人', category: '角色' },
  { word: '宇航员', category: '角色' },
  { word: '魔术师', category: '角色' },
  { word: '超级英雄', category: '角色' }
];

function createDrawGuessState(options = {}) {
  const words = normalizeWords(options.words || DEFAULT_WORDS);
  if (!words.length) throw new Error('你画我猜词库不能为空。');
  const totalRounds = normalizeTotalRounds(options.totalRounds);
  const nowMs = normalizeNow(options.nowMs);
  const selected = selectWord(words, [], options.random);
  return {
    phase: 'drawing',
    round: 1,
    totalRounds,
    roundDurationMs: ROUND_DURATION_MS,
    words,
    usedWords: [selected.word],
    answer: selected.word,
    answerAliases: selected.aliases,
    category: selected.category,
    wordLength: Array.from(selected.word).length,
    revealedAnswer: '',
    roundStartedAtMs: nowMs,
    roundDeadlineMs: nowMs + ROUND_DURATION_MS,
    correct: [],
    scores: [],
    canvas: createCanvasState()
  };
}

function submitGuess(state, danmaku = {}, nowMs = 0) {
  if (!state || state.phase !== 'drawing') return reject('当前不在答题阶段。', state);
  const uid = String(danmaku.uid || '').trim();
  if (!uid) return reject('无法识别观众身份。', state);
  if (state.correct.some(item => item.uid === uid)) return reject('本局已经答对。', state);
  const guess = normalizeGuessText(danmaku.message);
  if (!guess || !state.answerAliases.some(answer => normalizeGuessText(answer) === guess)) {
    return reject('答案不匹配。', state);
  }

  const rank = state.correct.length + 1;
  const points = SCORE_BY_RANK[rank - 1] || LATER_CORRECT_SCORE;
  const name = String(danmaku.userName || '观众').trim().slice(0, 80) || '观众';
  const guessedAt = normalizeNow(nowMs);
  const award = { uid, name, rank, points, guessedAt };
  const scores = updateScores(state.scores, award);
  return {
    accepted: true,
    award,
    state: {
      ...state,
      correct: [...state.correct, award],
      scores
    }
  };
}

function finishRound(state, nowMs = 0) {
  if (!state || state.phase !== 'drawing') return state;
  return {
    ...state,
    phase: state.round >= state.totalRounds ? 'finished' : 'round-result',
    revealedAnswer: state.answer,
    roundDeadlineMs: null,
    roundFinishedAtMs: normalizeNow(nowMs)
  };
}

function startNextRound(state, options = {}) {
  if (!state || state.phase !== 'round-result' || state.round >= state.totalRounds) return state;
  const nowMs = normalizeNow(options.nowMs);
  const selected = selectWord(state.words, state.usedWords, options.random);
  return {
    ...state,
    phase: 'drawing',
    round: state.round + 1,
    usedWords: [...state.usedWords, selected.word],
    answer: selected.word,
    answerAliases: selected.aliases,
    category: selected.category,
    wordLength: Array.from(selected.word).length,
    revealedAnswer: '',
    roundStartedAtMs: nowMs,
    roundDeadlineMs: nowMs + state.roundDurationMs,
    roundFinishedAtMs: null,
    correct: [],
    canvas: createCanvasState()
  };
}

function applyDrawOperation(state, input = {}) {
  if (!state || state.phase !== 'drawing') return reject('当前不在作画阶段。', state);
  const clientId = normalizeIdentifier(input.clientId);
  if (!clientId) return reject('绘画客户端标识无效。', state);
  if (input.action === 'clear') {
    const revision = state.canvas.revision + 1;
    return {
      accepted: true,
      operation: { action: 'clear', clientId, revision },
      state: { ...state, canvas: { revision, totalPoints: 0, strokes: [] } }
    };
  }
  if (input.action !== 'append') return reject('不支持这个绘画操作。', state);

  const strokeId = normalizeIdentifier(input.strokeId);
  const color = String(input.color || '').toLowerCase();
  const width = Number(input.width);
  const points = normalizePoints(input.points);
  if (!strokeId) return reject('笔画标识无效。', state);
  if (!DRAW_COLORS.has(color)) return reject('画笔颜色无效。', state);
  if (!DRAW_WIDTHS.has(width)) return reject('画笔粗细无效。', state);
  if (!points) return reject(`每次请提交 1-${MAX_POINTS_PER_OPERATION} 个有效坐标。`, state);

  const strokeIndex = state.canvas.strokes.findIndex(stroke => stroke.id === strokeId);
  const existing = strokeIndex >= 0 ? state.canvas.strokes[strokeIndex] : null;
  if (!existing && state.canvas.strokes.length >= MAX_STROKES) return reject('本局笔画数量已达上限。', state);
  if (existing && (existing.color !== color || existing.width !== width)) return reject('同一笔画的样式不能改变。', state);
  if ((existing?.points.length || 0) + points.length > MAX_POINTS_PER_STROKE) return reject('单笔坐标数量已达上限。', state);
  if (state.canvas.totalPoints + points.length > MAX_TOTAL_POINTS) return reject('本局画布坐标数量已达上限。', state);

  const strokes = state.canvas.strokes.map(stroke => ({ ...stroke, points: [...stroke.points] }));
  if (existing) strokes[strokeIndex].points.push(...points);
  else strokes.push({ id: strokeId, color, width, points: [...points] });
  const revision = state.canvas.revision + 1;
  const operation = { action: 'append', clientId, strokeId, color, width, points, revision };
  return {
    accepted: true,
    operation,
    state: {
      ...state,
      canvas: {
        revision,
        totalPoints: state.canvas.totalPoints + points.length,
        strokes
      }
    }
  };
}

function publicDrawGuessState(state, timing = {}) {
  if (!state) return null;
  const nowMs = normalizeNow(timing.nowMs);
  const drawing = state.phase === 'drawing';
  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    roundDurationMs: state.roundDurationMs,
    category: state.category,
    wordLength: state.wordLength,
    remainingMs: drawing ? Math.max(0, state.roundDeadlineMs - nowMs) : 0,
    serverNowMs: normalizeNow(timing.serverNowMs),
    revealedAnswer: drawing ? '' : state.revealedAnswer,
    correct: state.correct.map(item => ({
      uid: item.uid,
      name: item.name,
      rank: item.rank,
      points: item.points
    })),
    scores: state.scores.map(item => ({
      uid: item.uid,
      name: item.name,
      score: item.score,
      firsts: item.firsts
    })),
    canvas: {
      revision: state.canvas.revision,
      totalPoints: state.canvas.totalPoints,
      strokes: state.canvas.strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) }))
    }
  };
}

function getHostDrawGuessState(state) {
  if (!state) return null;
  return {
    game: 'draw-guess',
    word: state.answer,
    category: state.category,
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds
  };
}

function createCanvasState() {
  return { revision: 0, totalPoints: 0, strokes: [] };
}

function normalizeWords(words) {
  return words.map(entry => {
    const word = String(entry?.word || '').trim().slice(0, 24);
    const category = String(entry?.category || '综合').trim().slice(0, 24) || '综合';
    const aliases = [...new Set([word, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
      .map(value => String(value || '').trim().slice(0, 24))
      .filter(Boolean))];
    return { word, category, aliases };
  }).filter(entry => entry.word && entry.aliases.length);
}

function selectWord(words, usedWords, random = Math.random) {
  const available = words.filter(entry => !usedWords.includes(entry.word));
  const pool = available.length ? available : words;
  const sample = Number(random());
  const index = Number.isFinite(sample)
    ? Math.min(pool.length - 1, Math.max(0, Math.floor(sample * pool.length)))
    : 0;
  return pool[index];
}

function updateScores(scores, award) {
  const next = scores.map(item => ({ ...item }));
  const index = next.findIndex(item => item.uid === award.uid);
  if (index >= 0) {
    next[index].name = award.name;
    next[index].score += award.points;
    next[index].firsts += award.rank === 1 ? 1 : 0;
    next[index].lastScoreAt = award.guessedAt;
  } else {
    next.push({
      uid: award.uid,
      name: award.name,
      score: award.points,
      firsts: award.rank === 1 ? 1 : 0,
      lastScoreAt: award.guessedAt
    });
  }
  return next.sort((a, b) => b.score - a.score
    || b.firsts - a.firsts
    || a.lastScoreAt - b.lastScoreAt
    || a.name.localeCompare(b.name, 'zh-CN'));
}

function normalizeGuessText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^(?:答案(?:是)?|我猜)(?:\s*[:：]\s*|\s*)/, '')
    .replace(/^猜\s*[:：]\s*/, '')
    .replace(/[\s\u3000，。！？、,.!?;；:'"“”‘’（）()【】\[\]_-]+/g, '');
}

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length < 1 || points.length > MAX_POINTS_PER_OPERATION) return null;
  const normalized = [];
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    normalized.push({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 });
  }
  return normalized;
}

function normalizeIdentifier(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : '';
}

function normalizeTotalRounds(value) {
  const rounds = Number(value === undefined ? DEFAULT_TOTAL_ROUNDS : value);
  return Number.isInteger(rounds) && rounds >= 1 && rounds <= 12 ? rounds : DEFAULT_TOTAL_ROUNDS;
}

function normalizeNow(value) {
  const now = Number(value);
  return Number.isFinite(now) && now >= 0 ? now : 0;
}

function reject(reason, state) {
  return { accepted: false, reason, state };
}

module.exports = {
  DEFAULT_TOTAL_ROUNDS,
  DRAW_COLORS,
  DRAW_WIDTHS,
  MAX_POINTS_PER_OPERATION,
  ROUND_DURATION_MS,
  applyDrawOperation,
  createDrawGuessState,
  finishRound,
  getHostDrawGuessState,
  normalizeGuessText,
  publicDrawGuessState,
  startNextRound,
  submitGuess
};
