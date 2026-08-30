'use strict';

const { cleanText, splitTextIntoCharacters } = require('../shared/utils');
const { DANMAKU_MESSAGE_LIMIT } = require('../bilibili/danmaku/contract');
const { ANSWER_QUALITY_POLICY, buildTools } = require('./prompt');

const MIN_REPLY_INTERVAL_MS = 500;
const MAX_REPLY_INTERVAL_MS = 2000;
const MIN_CHUNK_INTERVAL_MS = 200;
const MAX_CHUNK_INTERVAL_MS = 600;
const MODEL_OUTPUT_TOKENS = 3072;
const REASONING_OUTPUT_TOKENS = 4096;
const MAX_REPLY_MESSAGES = 3;

function randomReplyIntervalMs(random) {
  return randomIntervalMs(random, MIN_REPLY_INTERVAL_MS, MAX_REPLY_INTERVAL_MS);
}

function randomIntervalMs(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function buildAvailableTools(config, excludedToolNames) {
  return buildTools(config).filter(
    (tool) => !tool.name || !excludedToolNames.has(tool.name),
  );
}

function extractTriggeredQuestion(message, trigger) {
  const text = cleanText(message);
  const keyword = cleanText(trigger);
  const index = keyword ? text.indexOf(keyword) : -1;
  if (index < 0) return null;
  const question = cleanText(
    `${text.slice(0, index)} ${text.slice(index + keyword.length)}`,
  ).replace(/^[，,。.!！?？:：、\s]+|[\s]+$/g, '');
  return question || '和大家打个招呼';
}

function normalizeDanmaku(danmaku, uid) {
  return { uid, userName: cleanText(danmaku.userName) || '观众' };
}

function buildConversationInput(question, context) {
  if (!context?.question || !context?.answer) return question;
  return `短期上下文（仅用于理解省略，不要逐字复述）：观众上次问“${context.question}”，回答“${context.answer}”。\n本次问题：${question}`;
}

/**
 * Append a runtime length contract so old/custom persona text cannot turn the
 * configured maximum into a target that every answer tries to fill.
 */
function buildReplyInstructions(
  systemPrompt,
  replyMaxChars,
  excludedToolNames = new Set(),
  webSearchEnabled = true,
  mentionName = '',
) {
  const budget = getReplyLengthBudget(mentionName, replyMaxChars);
  let instructions = `${String(systemPrompt || '').trim()}\n\n<runtime_task_policy>\n${ANSWER_QUALITY_POLICY}\n</runtime_task_policy>\n\n本次回复长度规则以此处为准：加上 @用户名后，1 条弹幕可放 ${budget.oneMessage} 个字符，2 条共 ${budget.twoMessages} 个字符，3 条共 ${budget.threeMessages} 个字符。优先只用 1 条；信息较多时可用 2 条；只有确有必要完整说明时才使用第 3 条，禁止超过 3 条。${budget.preferred} 个字符只是长度偏好，不是必须达到或严格截断的位置。问候、招呼、简单聊天和简单事实回答，正文写约 18–22 个汉字；默认尽量在正文后添加一个简短的标点组合或颜文字。颜文字按语气自然轮换：开心/亲切可用“ฅ^•ﻌ•^ฅ”“(｡･ω･｡)”“(๑•̀ㅂ•́)و✧”；惊讶/好奇可用“Σ(ﾟдﾟ)”“(⊙o⊙)”“(°ロ°) !”；害羞/感谢可用“(*´∀｀*)”“(⁄ ⁄•⁄ω⁄•⁄ ⁄)”“ヾ(≧▽≦*)o”；无奈/犯困可用“(´-ω-｀)”“( ˘ω˘ )”“ヽ(￣д￣;)ノ”；鼓励/得意可用“٩(ˊᗜˋ*)و”“( •̀∀•́ )✧”“٩(๑•̀ω•́๑)۶”。根据上下文选择，不要每次都用同一个，也不要连续回复重复同一个颜文字；不适合时只用“～”或省略。如果会超出上限、属于必要的简短拒答，或事实信息已经较多，可以省略；不要堆叠多个颜文字。天气、路线等需要多项事实时按信息量自然增长。不要为了接近长度偏好补充废话或复述问题。`;
  if (excludedToolNames.size) {
    instructions += webSearchEnabled
      ? '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用。涉及这些函数的查询必须改用 web_search，不要凭记忆回答。'
      : '\n本月部分第三方 API 已达到安全用量上限，相关函数已停用且 web_search 未启用。请简短说明路线服务没有返回结果，不要编造路线。';
  }
  return instructions;
}

function getReplyLengthBudget(mentionName, preferredChars) {
  const name = cleanText(mentionName);
  const mentionLength = name ? splitTextIntoCharacters(`@${name} `).length : 0;
  const oneMessage = Math.max(1, DANMAKU_MESSAGE_LIMIT - mentionLength);
  return {
    oneMessage,
    twoMessages: oneMessage * 2,
    threeMessages: oneMessage * MAX_REPLY_MESSAGES,
    preferred: Math.max(10, Math.min(50, Number(preferredChars) || 50)),
  };
}

function cleanModelText(value) {
  return cleanText(value)
    .replace(/^```[\s\S]*?\n|```$/g, '')
    .replace(/https?:\/\/\S+/g, '');
}

function truncateReply(text, limit) {
  const chars = splitTextIntoCharacters(cleanText(text));
  if (chars.length <= limit) return chars.join('');
  return `${chars.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function addUsage(target, usage = {}) {
  target.inputTokens += Number(usage.inputTokens) || 0;
  target.outputTokens += Number(usage.outputTokens) || 0;
}

function getModelOutputTokens(config = {}) {
  return config.reasoningEnabled
    ? REASONING_OUTPUT_TOKENS
    : MODEL_OUTPUT_TOKENS;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createShutdownError() {
  return codedError('AI_SHUTDOWN', 'AI service is shutting down.');
}

function isShutdownError(error) {
  return error?.code === 'AI_SHUTDOWN';
}

function publicError(error) {
  return String(error?.message || 'AI 处理失败').slice(0, 160);
}

function failureReply(error) {
  const code = String(error?.code || '');
  if (code === 'UPSTREAM_TIMEOUT') return '查询超时了，稍后再试一次～';
  if (code.startsWith('WEB_SEARCH_'))
    return '联网搜索暂时失败，换个关键词或稍后再问我～';
  if (code === 'AMAP_NOT_CONFIGURED')
    return '路线服务还没配置好，请先接入地图服务。';
  if (code === 'QWEATHER_NOT_CONFIGURED')
    return '天气服务还没配置好，请先接入天气服务。';
  if (code === 'AI_NOT_CONFIGURED')
    return 'AI 服务还没配置好，请先检查接口地址和 Key。';
  if (code.startsWith('QWEATHER_'))
    return '天气服务暂时没返回结果，换个城市再问我～';
  if (code.startsWith('AMAP_'))
    return '路线数据没返回完整，换个地点或方式再问我～';
  return '这次查询没完成，换个问法或稍后再试～';
}

module.exports = {
  MIN_CHUNK_INTERVAL_MS,
  MAX_CHUNK_INTERVAL_MS,
  randomReplyIntervalMs,
  randomIntervalMs,
  buildAvailableTools,
  extractTriggeredQuestion,
  normalizeDanmaku,
  buildConversationInput,
  buildReplyInstructions,
  getReplyLengthBudget,
  cleanModelText,
  truncateReply,
  addUsage,
  getModelOutputTokens,
  codedError,
  createShutdownError,
  isShutdownError,
  publicError,
  failureReply,
};
