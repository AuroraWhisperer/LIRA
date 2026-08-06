'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SENSITIVE_KEY_PATTERN = /(?:authorization|proxy-authorization|api[-_]?key|access[-_]?token|secret)/i;

function createAiRequestLogger(options = {}) {
  const filePath = path.resolve(options.filePath || path.join(process.cwd(), 'logs', 'ai.log'));
  const now = options.now || (() => new Date());
  let pending = Promise.resolve();

  function log(event = {}, logOptions = {}) {
    const entry = redactValue({
      timestamp: now().toISOString(),
      ...event
    }, normalizeSecrets(logOptions.secrets));
    const line = `${JSON.stringify(entry)}\n`;
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
