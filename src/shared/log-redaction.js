'use strict';

const REDACTED_PLACEHOLDER = '[REDACTED]';

/**
 * Redacts sensitive credentials from various value types.
 * @param {*} value - String, object, Error, URL, or other value to redact
 * @returns {*} Redacted value (same type as input)
 */
function redactCredentials(value) {
  if (value == null) return value;

  const valueType = typeof value;

  if (valueType === 'string') {
    return redactString(value);
  }

  if (valueType === 'object') {
    if (value instanceof Error) {
      return redactError(value);
    }
    if (value instanceof URL) {
      return redactUrl(value);
    }
    if (Array.isArray(value)) {
      return value.map(item => redactCredentials(item));
    }
    return redactObject(value);
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
    `$1: $2 ${REDACTED_PLACEHOLDER}`
  );

  // Redact Cookie header values
  result = result.replace(
    /\b(Cookie|cookie):\s*[^\r\n]+/gi,
    `$1: ${REDACTED_PLACEHOLDER}`
  );

  // Redact URL patterns with credentials in query params
  result = result.replace(
    /([?&])(key|token|secret|apiKey|password)=([^&\s]+)/gi,
    `$1$2=${REDACTED_PLACEHOLDER}`
  );

  // Redact URL userinfo (user:pass@host)
  result = result.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^:@\s]+:[^@\s]+@)/gi,
    `$1${REDACTED_PLACEHOLDER}@`
  );

  return result;
}

/**
 * Redacts credentials from an object (recursively).
 * @param {object} obj - Input object
 * @returns {object} New object with redacted fields
 */
function redactObject(obj) {
  const result = {};

  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase();

    // Check if key matches sensitive patterns
    if (
      lowerKey === 'password' ||
      lowerKey === 'passwd' ||
      lowerKey.endsWith('apikey') ||
      lowerKey.endsWith('secret') ||
      lowerKey.endsWith('token')
    ) {
      result[key] = REDACTED_PLACEHOLDER;
    } else if (lowerKey === 'authorization' || lowerKey === 'cookie') {
      result[key] = REDACTED_PLACEHOLDER;
    } else {
      result[key] = redactCredentials(obj[key]);
    }
  }

  return result;
}

/**
 * Redacts credentials from an Error object.
 * @param {Error} error - Input error
 * @returns {Error} New error with redacted message and stack
 */
function redactError(error) {
  const redacted = new Error(redactString(error.message));

  if (error.stack) {
    redacted.stack = redactString(error.stack);
  }

  // Copy other enumerable properties (redacted)
  for (const key of Object.keys(error)) {
    if (key !== 'message' && key !== 'stack') {
      redacted[key] = redactCredentials(error[key]);
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

  // Redact userinfo
  if (redactedUrl.username || redactedUrl.password) {
    redactedUrl.username = '';
    redactedUrl.password = '';
    const originalStr = url.toString();
    const atIndex = originalStr.indexOf('@');
    if (atIndex !== -1) {
      const protocolEnd = originalStr.indexOf('://');
      return originalStr.substring(0, protocolEnd + 3) + REDACTED_PLACEHOLDER + '@' + redactedUrl.host + redactedUrl.pathname + redactedUrl.search + redactedUrl.hash;
    }
  }

  // Redact sensitive query parameters
  const sensitiveParams = ['key', 'token', 'secret', 'apikey', 'password'];
  for (const param of sensitiveParams) {
    if (redactedUrl.searchParams.has(param)) {
      redactedUrl.searchParams.set(param, REDACTED_PLACEHOLDER);
    }
  }

  return redactedUrl.toString();
}

module.exports = { redactCredentials };
