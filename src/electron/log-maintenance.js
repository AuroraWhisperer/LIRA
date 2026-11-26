'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendBoundedLinesSync, maintainBoundedFilesSync, markLogMaintenanceComplete, LEGACY_TEXT_ERROR, logTimestamp,
  NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS, ERROR_ENTRY_BYTES, NORMAL_FILE_BYTES, ERROR_FILE_BYTES,
  RUNTIME_LOG_DIRECTORY, ERROR_LOG_DIRECTORY } = require('../shared/log-size-limit');
const { redactCredentials } = require('../shared/log-redaction');

function maintainDesktopLogs(logDir, now = Date.now()) {
  for (const [relative, isError] of [
    [path.join(RUNTIME_LOG_DIRECTORY, 'ai.jsonl'), false],
    ...['desktop.log', 'terminal.log', 'ai.jsonl'].map(name => [path.join(ERROR_LOG_DIRECTORY, name), true]),
  ]) {
    const file = path.join(logDir, relative);
    const result = maintainBoundedFilesSync(file, {
      maxFileBytes: isError ? ERROR_FILE_BYTES : NORMAL_FILE_BYTES,
      maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS, now,
    });
    if (result.written) markLogMaintenanceComplete(file, now);
  }
  for (const name of ['ai.log', 'desktop.log', 'terminal.log']) {
    const source = path.join(logDir, name);
    const isAi = name === 'ai.log';
    const target = path.join(logDir, ERROR_LOG_DIRECTORY, isAi ? 'ai.jsonl' : name);
    const prepared = maintainBoundedFilesSync(source, { maxFileBytes: NORMAL_FILE_BYTES, maxAgeMs: ERROR_LOG_AGE_MS, now });
    if (!prepared.written) continue;
    if (!isAi && !prepared.needsMixedLogPass) {
      markLogMaintenanceComplete(source, now);
      continue;
    }

    let pending = false;
    for (const suffix of ['.2', '.1', '']) {
      const file = source + suffix;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split(/(?<=\n)/);
        const entries = [];
        const sourceIndexes = [];
        const expiredInfo = [];
        for (const [index, line] of lines.entries()) {
          const timestamp = logTimestamp(line, stat.mtimeMs);
          if (!isAi && !LEGACY_TEXT_ERROR.test(line)) {
            if (timestamp < now - NORMAL_LOG_AGE_MS) expiredInfo.push(index);
            continue;
          }
          if (timestamp < now - ERROR_LOG_AGE_MS) {
            lines[index] = '';
            continue;
          }
          const failure = isAi ? legacyAiErrorLine(line, timestamp) : redactCredentials(line);
          if (failure) {
            entries.push(failure);
            sourceIndexes.push(index);
          } else if (timestamp < now - NORMAL_LOG_AGE_MS) {
            lines[index] = '';
          }
        }
        const { count } = appendBoundedLinesSync(target, entries, {
          maxEntryBytes: ERROR_ENTRY_BYTES, maxFileBytes: ERROR_FILE_BYTES, maxAgeMs: ERROR_LOG_AGE_MS, now,
        });
        for (let i = 0; i < count; i++) lines[sourceIndexes[i]] = '';
        pending ||= count < entries.length;
        if (!pending) for (const index of expiredInfo) lines[index] = '';
        const kept = lines.join('');
        if (!kept) fs.unlinkSync(file);
        else if (kept !== content) fs.writeFileSync(file, kept, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') pending = true;
      }
    }
    if (!isAi && !pending) markLogMaintenanceComplete(source, now);
  }
}

function legacyAiErrorLine(line, timestamp) {
  let record;
  try { record = JSON.parse(line); } catch { return; }
  if (record?.type !== 'request_failed' && record?.level !== 'error') return;
  const error = record.error || {};
  const safe = {
    schemaVersion: 1, timestamp: new Date(timestamp).toISOString(), level: 'error', event: 'ai.legacyFailure',
    error: { code: String(error.code || '').slice(0, 128), message: String(error.message || '').slice(0, 512),
      stack: String(error.stack || '').slice(0, 1024) },
  };
  return `${JSON.stringify(redactCredentials(safe))}\n`;
}

function installLogMaintenance(logDir) {
  maintainDesktopLogs(logDir);
  const timer = setInterval(() => maintainDesktopLogs(logDir), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { maintainDesktopLogs, installLogMaintenance };
