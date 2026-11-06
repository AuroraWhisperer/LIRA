'use strict';

const { DEFAULT_WORDS, getWordCategorySummaries } = require('./draw-guess-words');
const { createCanvasState, cloneCanvasState, applyCanvasOperation } = require('./draw-guess-canvas');

const DEFAULT_TOTAL_ROUNDS = 5;
const MIN_TOTAL_ROUNDS = 1;
const MAX_TOTAL_ROUNDS = 12;
const DEFAULT_ROUND_DURATION_SECONDS = 90;
const MIN_ROUND_DURATION_SECONDS = 15;
const MAX_ROUND_DURATION_SECONDS = 300;
const ROUND_DURATION_MS = 90 * 1000;
const SCORE_BY_RANK = [10, 7, 5];
const LATER_CORRECT_SCORE = 3;
function createDrawGuessState(options = {}) {
  const normalizedWords = normalizeWords(options.words || DEFAULT_WORDS);
  const requestedCategoryIds = normalizeCategoryIds(options.categoryIds, normalizedWords);
  const words =
    requestedCategoryIds === null
      ? normalizedWords
      : normalizedWords.filter((entry) => requestedCategoryIds.includes(entry.categoryId));
  if (!words.length) throw new Error('你画我猜词库不能为空。');
  const totalRounds = normalizeTotalRounds(options.totalRounds);
  const roundDurationSeconds = normalizeRoundDurationSeconds(options.roundDurationSeconds);
  const roundDurationMs = roundDurationSeconds * 1000;
  return {
    phase: 'choosing',
    round: 1,
    totalRounds,
    roundDurationMs,
    words,
    categoryIds: requestedCategoryIds || [...new Set(words.map((entry) => entry.categoryId).filter(Boolean))],
    usedWords: [],
    answer: '',
    answerAliases: [],
    category: '',
    wordLength: 0,
    revealedAnswer: '',
    answerRevealed: false,
    roundStartedAtMs: null,
    roundDeadlineMs: null,
    correct: [],
    scores: [],
    canvas: createCanvasState(),
  };
}

function submitGuess(state, danmaku = {}, nowMs = 0) {
  if (!state || state.phase !== 'drawing') return reject('当前不在答题阶段。', state);
  const uid = String(danmaku.uid || '').trim();
  if (!uid) return reject('无法识别观众身份。', state);
  if (state.correct.some((item) => item.uid === uid)) return reject('本局已经答对。', state);
  const guess = normalizeGuessText(danmaku.message);
  if (!guess || !state.answerAliases.some((answer) => normalizeGuessText(answer) === guess)) {
    return reject('答案不匹配。', state);
  }

  const rank = state.correct.length + 1;
  const points = SCORE_BY_RANK[rank - 1] || LATER_CORRECT_SCORE;
  const name =
    String(danmaku.userName || '观众')
      .trim()
      .slice(0, 80) || '观众';
  const guessedAt = normalizeNow(nowMs);
  const award = { uid, name, rank, points, guessedAt };
  const scores = updateScores(state.scores, award);
  return {
    accepted: true,
    award,
    state: {
      ...state,
      correct: [...state.correct, award],
      scores,
    },
  };
}

function finishRound(state, nowMs = 0, options = {}) {
  if (!state || state.phase !== 'drawing') return state;
  const reveal = options.reveal !== false;
  const deferFinal = options.deferFinal === true;
  return {
    ...state,
    phase: state.round >= state.totalRounds && reveal && !deferFinal ? 'finished' : 'round-result',
    revealedAnswer: reveal ? state.answer : '',
    answerRevealed: reveal,
    roundDeadlineMs: null,
    roundFinishedAtMs: normalizeNow(nowMs),
  };
}

function revealAnswer(state) {
  if (!state || state.phase !== 'round-result' || state.answerRevealed) return state;
  return {
    ...state,
    phase: state.round >= state.totalRounds ? 'finished' : 'round-result',
    revealedAnswer: state.answer,
    answerRevealed: true,
  };
}

function startNextRound(state) {
  if (!state || state.phase !== 'round-result' || state.round >= state.totalRounds) return state;
  return {
    ...state,
    phase: 'choosing',
    round: state.round + 1,
    answer: '',
    answerAliases: [],
    category: '',
    wordLength: 0,
    revealedAnswer: '',
    answerRevealed: false,
    roundStartedAtMs: null,
    roundDeadlineMs: null,
    roundFinishedAtMs: null,
    correct: [],
    canvas: createCanvasState(),
  };
}

function chooseDrawGuessWord(state, word, nowMs = 0) {
  if (!state || state.phase !== 'choosing') return reject('当前不在选词阶段。', state);
  const selected = availableWords(state).find((entry) => entry.word === word);
  if (!selected) return reject('请选择本轮可用词库中的题词。', state);
  const now = normalizeNow(nowMs);
  return {
    accepted: true,
    state: {
      ...state,
      phase: 'drawing',
      usedWords: [...state.usedWords, selected.word],
      answer: selected.word,
      answerAliases: selected.aliases,
      category: selected.category,
      wordLength: Array.from(selected.word).length,
      roundStartedAtMs: now,
      roundDeadlineMs: now + state.roundDurationMs,
    },
  };
}

function applyDrawOperation(state, input = {}) {
  if (!state || state.phase !== 'drawing') return reject('当前不在作画阶段。', state);
  const result = applyCanvasOperation(state.canvas, input);
  if (!result.accepted) return reject(result.reason, state);
  return { accepted: true, operation: result.operation, state: { ...state, canvas: result.canvas } };
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
    revealedAnswer: state.answerRevealed ? state.revealedAnswer : '',
    answerRevealed: Boolean(state.answerRevealed),
    correct: state.correct.map((item) => ({
      uid: item.uid,
      name: item.name,
      rank: item.rank,
      points: item.points,
    })),
    scores: state.scores.map((item) => ({
      uid: item.uid,
      name: item.name,
      score: item.score,
      firsts: item.firsts,
    })),
    ...(timing.includeCanvas === false ? {} : { canvas: cloneCanvasState(state.canvas) }),
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
    totalRounds: state.totalRounds,
    categoryIds: [...state.categoryIds],
    choices: state.phase === 'choosing'
      ? availableWords(state).map(({ word, categoryId, category }) => ({ word, categoryId, category }))
      : [],
  };
}

function getDrawGuessCategories() {
  return getWordCategorySummaries();
}

function normalizeWords(words) {
  return words
    .map((entry) => {
      const word = String(entry?.word || '')
        .trim()
        .slice(0, 24);
      const categoryId = String(entry?.categoryId || '')
        .trim()
        .toLowerCase()
        .slice(0, 32);
      const category =
        String(entry?.category || '综合')
          .trim()
          .slice(0, 24) || '综合';
      const aliases = [
        ...new Set(
          [word, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
            .map((value) =>
              String(value || '')
                .trim()
                .slice(0, 24),
            )
            .filter(Boolean),
        ),
      ];
      return { word, categoryId, category, aliases };
    })
    .filter((entry) => entry.word && entry.aliases.length);
}

function normalizeCategoryIds(value, words) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1) throw new Error('请至少选择一个词库分类。');
  if (value.length > 16) throw new Error('词库分类数量过多。');
  const categoryIds = [
    ...new Set(
      value.map((item) =>
        String(item || '')
          .trim()
          .toLowerCase(),
      ),
    ),
  ];
  if (categoryIds.some((id) => !/^[a-z0-9-]{1,32}$/.test(id))) throw new Error('词库分类无效。');
  const available = new Set(words.map((entry) => entry.categoryId).filter(Boolean));
  if (categoryIds.some((id) => !available.has(id))) throw new Error('词库分类无效。');
  return categoryIds;
}

function availableWords(state) {
  const available = state.words.filter((entry) => !state.usedWords.includes(entry.word));
  return available.length ? available : state.words;
}

function updateScores(scores, award) {
  const next = scores.map((item) => ({ ...item }));
  const index = next.findIndex((item) => item.uid === award.uid);
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
      lastScoreAt: award.guessedAt,
    });
  }
  return next.sort(
    (a, b) =>
      b.score - a.score ||
      b.firsts - a.firsts ||
      a.lastScoreAt - b.lastScoreAt ||
      a.name.localeCompare(b.name, 'zh-CN'),
  );
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

function normalizeTotalRounds(value) {
  const rounds = Number(value === undefined ? DEFAULT_TOTAL_ROUNDS : value);
  return Number.isInteger(rounds) && rounds >= MIN_TOTAL_ROUNDS && rounds <= MAX_TOTAL_ROUNDS
    ? rounds
    : DEFAULT_TOTAL_ROUNDS;
}

function normalizeRoundDurationSeconds(value) {
  const seconds = Number(value === undefined ? DEFAULT_ROUND_DURATION_SECONDS : value);
  return Number.isInteger(seconds) && seconds >= MIN_ROUND_DURATION_SECONDS && seconds <= MAX_ROUND_DURATION_SECONDS
    ? seconds
    : DEFAULT_ROUND_DURATION_SECONDS;
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
  DEFAULT_ROUND_DURATION_SECONDS,
  MAX_ROUND_DURATION_SECONDS,
  MAX_TOTAL_ROUNDS,
  MIN_ROUND_DURATION_SECONDS,
  MIN_TOTAL_ROUNDS,
  ROUND_DURATION_MS,
  applyDrawOperation,
  chooseDrawGuessWord,
  createDrawGuessState,
  finishRound,
  getDrawGuessCategories,
  getHostDrawGuessState,
  normalizeGuessText,
  publicDrawGuessState,
  revealAnswer,
  startNextRound,
  submitGuess,
};
