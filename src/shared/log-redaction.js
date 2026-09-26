'use strict';

const { isSensitiveFieldName } = require('./sensitive-field-name');

const REDACTED_PLACEHOLDER = '[REDACTED]';
const MAX_REDACTION_DEPTH = 32;

/**
 * Redacts sensitive credentials from various value types.
 * @param {*} value - String, object, Error, URL, or other value to redact
 * @returns {*} Redacted value (same type as input)
 */
function redactCredentials(value) {
  return redactValue(value, new WeakSet(), 0);
}

function redactValue(value, ancestors, depth) {
  if (value == null) return value;

  const valueType = typeof value;

  if (valueType === 'string') {
    return redactString(value);
  }

  if (valueType === 'object') {
    if (ancestors.has(value)) return '[Circular]';
    if (depth >= MAX_REDACTION_DEPTH) return '[Truncated]';
    ancestors.add(value);
    try {
      if (value instanceof Error) {
        return redactError(value, ancestors, depth);
      }
      if (value instanceof URL) {
        return redactUrl(value);
      }
      if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, ancestors, depth + 1));
      }
      return redactObject(value, ancestors, depth);
    } finally {
      ancestors.delete(value);
    }
  }

  return value;
}

/**
 * Redacts credentials from a string.
 * @param {string} str - Input string
 * @returns {string} Redacted string
 */
function redactString(str) {
  let result = str;

  // Redact Authorization headers (Bearer, Basic)
  result = result.replace(
    /\b(Authorization|authorization):\s*(Bearer|Basic)\s+[A-Za-z0-9+/=_\-\.]+/gi,
    `$1: $2 ${REDACTED_PLACEHOLDER}`,
  );

  // Redact Cookie header values
  result = result.replace(/\b(Cookie|cookie):\s*[^\r\n]+/gi, `$1: ${REDACTED_PLACEHOLDER}`);

  // Redact credential-like URL query parameters.  Match the parameter name
  // broadly, then apply the same normalized-key policy used for objects so
  // variants such as private_key_pem and accessToken cannot bypass logging
  // redaction.
  result = result.replace(/([?&])([^=?&#\s]+)=([^&#\s]*)/g, (match, separator, key, value) =>
    isSensitiveKey(key) ? `${separator}${key}=${REDACTED_PLACEHOLDER}` : match,
  );

  // Match each authority once, including incomplete URLs, instead of retrying every suffix.
  result = result.replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^\s/?#]*)/gi, (match, scheme, authority) => {
    const userInfoEnd = authority.lastIndexOf('@');
    return userInfoEnd < 0 ? match : `${scheme}${REDACTED_PLACEHOLDER}@${authority.slice(userInfoEnd + 1)}`;
  });

  return result;
}

function isSensitiveKey(key) {
  let decodedKey = String(key);
  try {
    decodedKey = decodeURIComponent(decodedKey);
  } catch (error) {
    // Malformed percent-encoding should not prevent logging; retain the raw key.
    decodedKey = String(key);
  }
  return isSensitiveFieldName(decodedKey);
}

/**
 * Redacts credentials from an object (recursively).
 * @param {object} obj - Input object
 * @returns {object} New object with redacted fields
 */
function redactObject(obj, ancestors, depth) {
  const result = {};

  for (const key of Object.keys(obj)) {
    // Check if key matches sensitive patterns
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_PLACEHOLDER;
    } else {
      result[key] = redactValue(obj[key], ancestors, depth + 1);
    }
  }

  return result;
}

/**
 * Redacts credentials from an Error object.
 * @param {Error} error - Input error
 * @returns {Error} New error with redacted message and stack
 */
function redactError(error, ancestors, depth) {
  const redacted = new Error(redactString(error.message));

  if (error.stack) {
    redacted.stack = redactString(error.stack);
  }

  // Copy other enumerable properties (redacted)
  for (const key of Object.keys(error)) {
    if (key !== 'message' && key !== 'stack') {
      redacted[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redactValue(error[key], ancestors, depth + 1);
    }
  }

  return redacted;
}

/**
 * Redacts credentials from a URL object.
 * @param {URL} url - Input URL
 * @returns {string} Redacted URL string
 */
function redactUrl(url) {
  const redactedUrl = new URL(url.toString());
  const hadUserInfo = Boolean(redactedUrl.username || redactedUrl.password);

  // Redact userinfo
  if (hadUserInfo) {
    redactedUrl.username = '';
    redactedUrl.password = '';
  }

  // Redact sensitive query parameters (case-insensitive param names)
  for (const param of [...redactedUrl.searchParams.keys()]) {
    if (isSensitiveKey(param) || param.toLowerCase().replace(/[_-]/g, '') === 'key') {
      redactedUrl.searchParams.set(param, REDACTED_PLACEHOLDER);
    }
  }

  if (hadUserInfo) {
    return `${redactedUrl.protocol}//${REDACTED_PLACEHOLDER}@${redactedUrl.host}${redactedUrl.pathname}${redactedUrl.search}${redactedUrl.hash}`;
  }
  return redactedUrl.toString();
}

module.exports = { redactCredentials };
