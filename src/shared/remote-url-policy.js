'use strict';

const net = require('node:net');

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function isDnsHostname(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const hostname = unwrapped.endsWith('.') ? unwrapped.slice(0, -1) : unwrapped;
  if (!hostname || hostname === 'localhost' || hostname.length > 253 || net.isIP(hostname) !== 0) {
    return false;
  }
  return hostname.split('.').every((label) => DNS_LABEL_PATTERN.test(label));
}

function normalizeRemoteRootOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' || !isDnsHostname(parsed.hostname) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

module.exports = { isDnsHostname, normalizeRemoteRootOrigin };
