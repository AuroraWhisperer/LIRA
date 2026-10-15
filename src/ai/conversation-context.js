'use strict';

const { checkLocalInput } = require('./safety');

const MAX_EXCHANGES = 20;
const MAX_PART_CHARACTERS = 500;
const MAX_HISTORY_CHARACTERS = 12000;

function normalizeConversationContext(value) {
  if (!value || typeof value !== 'object') return null;
  const source = Array.isArray(value.exchanges) ? value.exchanges : [value];
  if (!source.length) return null;
  let truncated = value.truncated === true || source.length > MAX_EXCHANGES;
  const selected = source.length > MAX_EXCHANGES ? [source[0], ...source.slice(-(MAX_EXCHANGES - 1))] : source;
  const exchanges = [];
  for (const exchange of selected) {
    if (typeof exchange?.question !== 'string' || typeof exchange?.answer !== 'string') return null;
    if (!checkLocalInput(exchange.question).allowed || !checkLocalInput(exchange.answer).allowed) return null;
    const question = Array.from(exchange.question.trim());
    const answer = Array.from(exchange.answer.trim());
    if (!question.length || !answer.length) return null;
    truncated ||= question.length > MAX_PART_CHARACTERS || answer.length > MAX_PART_CHARACTERS;
    exchanges.push({ question: question.slice(0, MAX_PART_CHARACTERS).join(''), answer: answer.slice(0, MAX_PART_CHARACTERS).join('') });
  }
  const length = () => exchanges.reduce((total, exchange) => total + Array.from(exchange.question + exchange.answer).length, 0);
  while (exchanges.length > 2 && length() > MAX_HISTORY_CHARACTERS) {
    exchanges.splice(1, 1);
    truncated = true;
  }
  return {
    version: 2,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId.slice(0, 80) : '',
    exchanges,
    truncated,
  };
}

function appendConversationExchange(context, question, answer, sessionId) {
  const previous = normalizeConversationContext(context);
  return normalizeConversationContext({
    sessionId: previous?.sessionId || sessionId,
    exchanges: [...(previous?.exchanges || []), { question, answer }],
    truncated: previous?.truncated,
  });
}

module.exports = { normalizeConversationContext, appendConversationExchange };
