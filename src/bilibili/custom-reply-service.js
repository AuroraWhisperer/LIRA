// 编写人：Aurora
// 自定义关键词回复：识别用户配置的关键词，并生成可发送的自动回复。
'use strict';

const { cleanText, truncateText } = require('../shared/utils');
const { toSimplifiedChinese } = require('../shared/chinese-text');
const { fixedReplyParameters } = require('../shared/fixed-reply-contract');

const MAX_CUSTOM_REPLY_RULES = 30;
const CUSTOM_REPLY_KEYWORD_LIMIT = 30;
const CUSTOM_REPLY_TEXT_LIMIT = 120;

function createCustomReplyService(dependencies = {}) {
  const { settings } = dependencies;
  let cloudTriggers = new Set();
  let cloudRevision = -1;
  let cachedRuleText = null;
  let cachedRules = [];

  function findCurrentRule(simplified) {
    const current = typeof settings === 'function' ? settings() : {};
    const text = cleanText(simplified);
    if (!text || current.enableCustomReplyBot !== 'true') return null;
    const value = current.customReplyRules;
    if (typeof value !== 'string') return matchCustomReplyRule(text, compileCustomReplyRules(value));
    if (value !== cachedRuleText) {
      cachedRules = compileCustomReplyRules(value);
      cachedRuleText = value;
    }
    return matchCustomReplyRule(text, cachedRules);
  }

  return {
    setCloudExactReplySettings(value, revision) {
      if (!value) {
        cloudTriggers.clear();
        cloudRevision = -1;
        return;
      }
      if (!Number.isSafeInteger(revision) || revision < cloudRevision) return;
      let projected;
      try {
        projected = fixedReplyParameters({
          customExactReplyEnabled: value.customExactReplyEnabled ?? false,
          customExactReplies: value.customExactReplies ?? [],
        });
      } catch {
        return;
      }
      cloudRevision = revision;
      cloudTriggers = new Set(projected.customExactReplyEnabled
        ? ['菜单', ...projected.customExactReplies.map((rule) => toSimplifiedChinese(rule.trigger))] : []);
    },

    isCloudOwnedCommand(message, simplified = toSimplifiedChinese(String(message || '').trim())) {
      return cloudTriggers.has(simplified);
    },

    handleDanmaku(danmaku = {}, simplified = toSimplifiedChinese(danmaku.message)) {
      const matchedRule = findCurrentRule(simplified);
      if (!matchedRule) {
        return { accepted: false, reason: 'not-custom-reply' };
      }

      const uid = cleanText(danmaku.uid);
      const userName = cleanText(danmaku.userName) || '观众';
      return {
        accepted: true,
        command: { type: 'custom-reply', keyword: matchedRule.keyword },
        rule: { ...matchedRule },
        autoReply: {
          message: matchedRule.reply,
          target: { uid, name: userName },
        },
      };
    },

    isCommandText(message, simplified = toSimplifiedChinese(String(message || '').trim())) {
      return cloudTriggers.has(simplified) || Boolean(findCurrentRule(simplified));
    },
  };
}

function compileCustomReplyRules(value) {
  return parseCustomReplyRules(value)
    .filter((rule) => rule.enabled)
    .map((rule) => ({ rule, keyword: toSimplifiedChinese(rule.keyword).toLocaleLowerCase() }));
}

function matchCustomReplyRule(text, rules) {
  const normalizedText = text.toLocaleLowerCase();
  return rules.find(({ keyword }) => normalizedText.includes(keyword))?.rule || null;
}

function parseCustomReplyRules(value) {
  let parsed = value;
  if (!Array.isArray(parsed)) {
    try {
      parsed = JSON.parse(String(value || '[]'));
    } catch (_) {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(normalizeCustomReplyRule)
    .filter((rule) => rule.keyword && rule.reply)
    .slice(0, MAX_CUSTOM_REPLY_RULES);
}

function normalizeCustomReplyRule(item = {}) {
  return {
    keyword: truncateText(cleanText(item.keyword), CUSTOM_REPLY_KEYWORD_LIMIT),
    reply: truncateText(cleanText(item.reply), CUSTOM_REPLY_TEXT_LIMIT),
    enabled: !(item.enabled === false || String(item.enabled).toLowerCase() === 'false'),
  };
}

module.exports = {
  createCustomReplyService,
  parseCustomReplyRules,
  normalizeCustomReplyRule,
  MAX_CUSTOM_REPLY_RULES,
  CUSTOM_REPLY_KEYWORD_LIMIT,
  CUSTOM_REPLY_TEXT_LIMIT,
};
