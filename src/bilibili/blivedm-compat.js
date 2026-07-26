// 编写人：Aurora
// blivedm 礼物协议兼容性检查。
'use strict';

const childProcess = require('node:child_process');
const { cleanText, now, safeJsonStringify, safeParseJson } = require('../shared/utils');

const BLIVEDM_RAW_BASE = 'https://raw.githubusercontent.com/xfgryujk/blivedm/master';
const BLIVEDM_COMPAT_CHECK_TIMEOUT_MS = 20000;
const BLIVEDM_COMPAT_CACHE_KEY = 'blivedmCompatibilityCache';

function getSupportedBilibiliGiftCommands() {
  return [
    'SEND_GIFT', 'SEND_GIFT_V2', 'BLIND_GIFT', 'COMBO_SEND',
    'GUARD_BUY', 'USER_TOAST_MSG', 'USER_TOAST_MSG_V2',
    'LIVE_OPEN_PLATFORM_SEND_GIFT', 'LIVE_OPEN_PLATFORM_GUARD'
  ];
}

function extractBlivedmGiftCommands(text) {
  const commands = new Set();
  const pattern = /['"]([A-Z0-9_]*(?:GIFT|GUARD|USER_TOAST)[A-Z0-9_]*)['"]/g;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const cmd = cleanText(match[1]);
    if (cmd && isBilibiliGiftRelevantCommandName(cmd)) commands.add(cmd);
  }
  return Array.from(commands).sort();
}

function isBilibiliGiftRelevantCommandName(cmd) {
  const text = cleanText(cmd);
  if (!text) return false;
  return text.includes('GIFT') || text.includes('GUARD') || text.startsWith('USER_TOAST_MSG');
}

function isSupportedBilibiliGiftCommand(cmd, supported) {
  const text = cleanText(cmd);
  return supported.some((s) => text === s || text.startsWith(`${s}_`));
}

async function fetchTextWithTimeout(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'bilibili-live-song-plugin', 'Accept': 'text/plain, */*' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.text();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    console.warn(`[Bilibili] GitHub fetch failed, trying PowerShell fallback: ${error.message}`);
    return fetchTextWithPowerShell(url, timeoutMs);
  }
}

function fetchTextWithPowerShell(url, timeoutMs) {
  const timeoutSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  const command = [
    '$ProgressPreference = "SilentlyContinue";',
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;`,
    `$response = Invoke-WebRequest -Uri '${escapePowerShell(url)}' -UseBasicParsing -TimeoutSec ${timeoutSec};`,
    '$response.Content'
  ].join(' ');

  return new Promise((resolve, reject) => {
    childProcess.execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command
    ], {
      encoding: 'utf8', windowsHide: true,
      timeout: timeoutMs + 3000, maxBuffer: 2 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PowerShell fallback failed: ${error.message}${stderr ? ` ${stderr.trim()}` : ''}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function escapePowerShell(value) {
  return String(value || '').replace(/'/g, "''");
}

async function checkBlivedmCompatibility() {
  const handlersText = await fetchTextWithTimeout(`${BLIVEDM_RAW_BASE}/blivedm/handlers.py`, BLIVEDM_COMPAT_CHECK_TIMEOUT_MS);
  const remoteGiftCommands = extractBlivedmGiftCommands(handlersText);
  const supportedGiftCommands = getSupportedBilibiliGiftCommands();
  const missingGiftCommands = remoteGiftCommands.filter((cmd) => !isSupportedBilibiliGiftCommand(cmd, supportedGiftCommands));

  return {
    status: missingGiftCommands.length > 0 ? 'warn' : 'ok',
    checkedAt: now(),
    message: missingGiftCommands.length > 0
      ? `发现 blivedm 新礼物 CMD：${missingGiftCommands.join('、')}`
      : 'blivedm 礼物 CMD 已覆盖。',
    remoteGiftCommands, supportedGiftCommands, missingGiftCommands
  };
}

function readBlivedmCompatibilityCache(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(BLIVEDM_COMPAT_CACHE_KEY);
  if (!row || !row.value) return null;
  const parsed = safeParseJson(row.value);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    status: parsed.status || 'cached',
    checkedAt: cleanText(parsed.checkedAt),
    message: cleanText(parsed.message) || '使用上次 blivedm 检查结果。',
    remoteGiftCommands: Array.isArray(parsed.remoteGiftCommands) ? parsed.remoteGiftCommands.map(cleanText).filter(Boolean) : [],
    supportedGiftCommands: Array.isArray(parsed.supportedGiftCommands) ? parsed.supportedGiftCommands.map(cleanText).filter(Boolean) : getSupportedBilibiliGiftCommands(),
    missingGiftCommands: Array.isArray(parsed.missingGiftCommands) ? parsed.missingGiftCommands.map(cleanText).filter(Boolean) : []
  };
}

function writeBlivedmCompatibilityCache(db, result) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(BLIVEDM_COMPAT_CACHE_KEY, safeJsonStringify({
    checkedAt: result.checkedAt, message: result.message,
    remoteGiftCommands: result.remoteGiftCommands,
    supportedGiftCommands: result.supportedGiftCommands,
    missingGiftCommands: result.missingGiftCommands
  }), now());
}

module.exports = {
  checkBlivedmCompatibility,
  extractBlivedmGiftCommands,
  getSupportedBilibiliGiftCommands,
  isSupportedBilibiliGiftCommand,
  readBlivedmCompatibilityCache,
  writeBlivedmCompatibilityCache
};
