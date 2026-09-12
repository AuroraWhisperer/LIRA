'use strict';

const { redactCredentials } = require('../src/shared/log-redaction');

// Release tools can echo raw arguments or decoded proxy credentials in any output.
function redactReleaseOutput(value, environment) {
  const secrets = new Set([environment.WINDOWS_CERT_PASSWORD]);
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    const proxy = environment[key]?.trim();
    if (!proxy) continue;
    try {
      const url = new URL(proxy.includes('://') ? proxy : `http://${proxy}`);
      for (const part of [url.username, url.password]) {
        secrets.add(part);
        try {
          secrets.add(decodeURIComponent(part));
        } catch {
          // Preserve the encoded form when the URL contains invalid escapes.
        }
      }
    } catch {
      // A malformed proxy must not bypass redaction by failing URL parsing.
      secrets.add(proxy);
    }
  }

  let output = String(value ?? '');
  for (const secret of [...secrets].filter(Boolean).sort((left, right) => right.length - left.length)) {
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      output = output.split(form).join('[REDACTED]');
    }
  }
  return redactCredentials(output).replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/gi,
    '$1[REDACTED]@',
  );
}

function sanitizeCommandError(error, environment) {
  const redact = (value) => redactReleaseOutput(value, environment);
  const sanitized = new Error(redact(error.message || error));
  if (error.stack) sanitized.stack = redact(error.stack);
  for (const key of ['code', 'signal']) {
    if (error[key] != null) sanitized[key] = redact(error[key]);
  }
  if (typeof error.status === 'number' || error.status === null) sanitized.status = error.status;
  for (const key of ['stdout', 'stderr']) {
    if (error[key] != null) sanitized[key] = redact(error[key]);
  }
  if (Array.isArray(error.output)) {
    sanitized.output = error.output.map((part) => part == null ? null : redact(part));
  }
  // Do not retain raw spawnargs, causes, or arbitrary child-process properties.
  return sanitized;
}

function checkCommandResult(result, command, environment) {
  if (!result.error && result.status === 0) return;
  const error = new Error(
    result.error?.message || `${command} failed (exit ${result.status}, signal ${result.signal || 'none'})` +
      (result.stderr?.length ? `\n${result.stderr}` : ''),
  );
  Object.assign(error, {
    code: result.error?.code,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output,
  });
  throw sanitizeCommandError(error, environment);
}

module.exports = { redactReleaseOutput, sanitizeCommandError, checkCommandResult };
