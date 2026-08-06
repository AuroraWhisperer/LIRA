'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SENSITIVE_KEY_PATTERN = /(?:authorization|proxy-authorization|api[-_]?key|access[-_]?token|secret)/i;
const MAX_LOG_STRING_LENGTH = 4000;

function createAiRequestLogger(options = {}) {
  const filePath = path.resolve(options.filePath || path.join(process.cwd(), 'logs', 'ai.log'));
  const now = options.now || (() => new Date());
  const sessionStartedAt = now().toISOString();
  let pending = fs.mkdir(path.dirname(filePath), { recursive: true })
    .then(() => fs.writeFile(
      filePath,
      `===== AI 日志会话 ${sessionStartedAt} =====\n\n`,
      'utf8'
    ));

  function log(event = {}, logOptions = {}) {
    const entry = limitValue(redactValue({
      timestamp: now().toISOString(),
      ...event
    }, normalizeSecrets(logOptions.secrets)));
    const summary = formatSummary(entry);
    const line = `${summary}\n${JSON.stringify(entry, null, 2)}\n\n`;
    pending = pending
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, line, 'utf8');
      });
    return pending;
  }

  return { filePath, log };
}

function formatSummary(entry) {
  const timestamp = String(entry.timestamp || '');
  const type = String(entry.type || 'event');
  const requestId = entry.requestId ? ` requestId=${String(entry.requestId)}` : '';
  return `[${timestamp}] ${type}${requestId}`;
}

function limitValue(value) {
  if (Array.isArray(value)) return value.map(limitValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, childValue]) => [key, limitValue(childValue)]));
  }
  if (typeof value !== 'string' || value.length <= MAX_LOG_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`;
}

function redactValue(value, secrets, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, secrets, childKey)
      ])
    );
  }
  if (typeof value !== 'string') return value;
  return secrets.reduce(
    (result, secret) => result.replaceAll(secret, '[redacted]'),
    value
  );
}

function normalizeSecrets(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || ''))
      .filter(Boolean)
  ));
}

module.exports = { createAiRequestLogger };
