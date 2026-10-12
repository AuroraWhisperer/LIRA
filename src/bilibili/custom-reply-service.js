// 编写人：Aurora
// 自定义关键词回复：识别用户配置的关键词，并生成可发送的自动回复。
'use strict';

const { cleanText, truncateText } = require('../shared/utils');
const { fixedReplyParameters } = require('../shared/fixed-reply-contract');

const MAX_CUSTOM_REPLY_RULES = 30;
const CUSTOM_REPLY_KEYWORD_LIMIT = 30;
const CUSTOM_REPLY_TEXT_LIMIT = 120;

function createCustomReplyService(dependencies = {}) {
  const { settings } = dependencies;
  let cloudTriggers = new Set();
  let cloudRevision = -1;

  function currentSettings() {
    return typeof settings === 'function' ? settings() : {};
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
        ? ['菜单', ...projected.customExactReplies.map((rule) => rule.trigger)] : []);
    },

    isCloudOwnedCommand(message) {
      return cloudTriggers.has(String(message || '').trim());
    },

    handleDanmaku(danmaku = {}) {
      const text = cleanText(danmaku.message);
      const matchedRule = findCustomReplyRule(text, currentSettings());
      if (!matchedRule) {
        return { accepted: false, reason: 'not-custom-reply' };
      }

      const uid = cleanText(danmaku.uid);
      const userName = cleanText(danmaku.userName) || '观众';
      return {
        accepted: true,
        command: { type: 'custom-reply', keyword: matchedRule.keyword },
        rule: matchedRule,
        autoReply: {
          message: matchedRule.reply,
          target: { uid, name: userName },
        },
      };
    },

    isCommandText(message) {
      return cloudTriggers.has(String(message || '').trim()) || Boolean(findCustomReplyRule(message, currentSettings()));
    },
  };
}

function findCustomReplyRule(message, settings = {}) {
  const text = cleanText(message);
  if (!text || settings.enableCustomReplyBot !== 'true') return null;

  const normalizedText = text.toLocaleLowerCase();
  return (
    parseCustomReplyRules(settings.customReplyRules).find(
      (rule) => rule.enabled !== false && normalizedText.includes(rule.keyword.toLocaleLowerCase()),
    ) || null
  );
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
  findCustomReplyRule,
  parseCustomReplyRules,
  normalizeCustomReplyRule,
  MAX_CUSTOM_REPLY_RULES,
  CUSTOM_REPLY_KEYWORD_LIMIT,
  CUSTOM_REPLY_TEXT_LIMIT,
};
