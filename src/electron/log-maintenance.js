'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendBoundedLinesSync, maintainBoundedFilesSync, LEGACY_TEXT_ERROR, logTimestamp,
  NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS } = require('../shared/log-size-limit');
const { redactCredentials } = require('../shared/log-redaction');

const MIB = 1024 * 1024;

function maintainDesktopLogs(logDir, now = Date.now()) {
  for (const name of ['ai.log', 'desktop.log', 'terminal.log']) {
    const source = path.join(logDir, name);
    const isAi = name === 'ai.log';
    const target = path.join(logDir, 'errors', isAi ? 'ai.jsonl' : name);
    const prepared = maintainBoundedFilesSync(source, { maxFileBytes: MIB, maxAgeMs: ERROR_LOG_AGE_MS, now });
    if (!prepared.written || (!isAi && !prepared.needsMixedLogPass)) continue;

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
        for (const [index, line] of lines.entries()) {
          if (!isAi && !LEGACY_TEXT_ERROR.test(line)) continue;
          const timestamp = logTimestamp(line, stat.mtimeMs);
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
          maxEntryBytes: 16 * 1024, maxFileBytes: 3 * MIB, maxAgeMs: ERROR_LOG_AGE_MS, now,
        });
        for (let i = 0; i < count; i++) lines[sourceIndexes[i]] = '';
        pending ||= count < entries.length;
        const kept = lines.join('');
        if (!kept && isAi) fs.unlinkSync(file);
        else if (kept !== content) fs.writeFileSync(file, kept, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') pending = true;
      }
    }
    if (!isAi && !pending) {
      maintainBoundedFilesSync(source, { maxFileBytes: MIB, maxAgeMs: NORMAL_LOG_AGE_MS, now });
    }
  }
  for (const [relative, isError] of [
    ['runtime/ai.jsonl', false], ['errors/desktop.log', true], ['errors/terminal.log', true], ['errors/ai.jsonl', true],
  ]) {
    maintainBoundedFilesSync(path.join(logDir, relative), {
      maxFileBytes: isError ? 3 * MIB : MIB,
      maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS, now,
    });
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
