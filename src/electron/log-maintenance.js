'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendBoundedFileSync, maintainBoundedFilesSync, logTimestamp,
  NORMAL_LOG_AGE_MS, ERROR_LOG_AGE_MS } = require('../shared/log-size-limit');
const { redactCredentials } = require('../shared/log-redaction');

const MIB = 1024 * 1024;

function maintainDesktopLogs(logDir, now = Date.now()) {
  extractLegacyAiErrors(logDir, now);
  const pendingExtraction = new Set();
  for (const name of ['desktop.log', 'terminal.log']) {
    const source = path.join(logDir, name);
    const target = path.join(logDir, 'errors', name);
    // Bound legacy input before reading it, keeping the newest complete records.
    const prepared = maintainBoundedFilesSync(source, { maxFileBytes: MIB, maxAgeMs: ERROR_LOG_AGE_MS, now });
    if (!prepared.written) continue;
    // Extract still-relevant failures before pruning the former mixed log.
    for (const suffix of ['.2', '.1', '']) {
      try {
        const stat = fs.lstatSync(source + suffix);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const content = fs.readFileSync(source + suffix, 'utf8');
        const kept = content.split(/(?<=\n)/).filter((line) => {
          if (!/\[(?:terminal:(?:warn|error)|desktop:[^\]]*(?:warn|warning|error|failed|failure|fatal))\]/i.test(line)) return true;
          if (logTimestamp(line, stat.mtimeMs) < now - ERROR_LOG_AGE_MS) return false;
          const result = appendBoundedFileSync(target, redactCredentials(line), {
            maxEntryBytes: 16 * 1024, maxFileBytes: 3 * MIB, maxAgeMs: ERROR_LOG_AGE_MS, now,
          });
          if (!result.written) pendingExtraction.add(name);
          return !result.written;
        }).join('');
        if (kept !== content) fs.writeFileSync(source + suffix, kept, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') pendingExtraction.add(name);
      }
    }
  }
  for (const [relative, isError] of [
    ['desktop.log', false], ['terminal.log', false], ['runtime/ai.jsonl', false],
    ['errors/desktop.log', true], ['errors/terminal.log', true], ['errors/ai.jsonl', true],
  ]) {
    if (pendingExtraction.has(relative)) continue;
    maintainBoundedFilesSync(path.join(logDir, relative), {
      maxFileBytes: isError ? 3 * MIB : MIB,
      maxAgeMs: isError ? ERROR_LOG_AGE_MS : NORMAL_LOG_AGE_MS, now,
    });
  }
}

function extractLegacyAiErrors(logDir, now) {
  const source = path.join(logDir, 'ai.log');
  const prepared = maintainBoundedFilesSync(source, { maxFileBytes: MIB, maxAgeMs: ERROR_LOG_AGE_MS, now });
  if (!prepared.written) return;
  for (const suffix of ['.2', '.1', '']) {
    const file = source + suffix;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const content = fs.readFileSync(file, 'utf8');
      const kept = content.split(/(?<=\n)/).filter((line) => {
        const timestamp = logTimestamp(line, stat.mtimeMs);
        let record;
        try { record = JSON.parse(line); } catch { return timestamp >= now - NORMAL_LOG_AGE_MS; }
        if (record?.type !== 'request_failed' && record?.level !== 'error') return timestamp >= now - NORMAL_LOG_AGE_MS;
        if (timestamp < now - ERROR_LOG_AGE_MS) return false;
        const error = record.error || {};
        const safe = {
          schemaVersion: 1, timestamp: new Date(timestamp).toISOString(), level: 'error', event: 'ai.legacyFailure',
          error: { code: String(error.code || '').slice(0, 128), message: String(error.message || '').slice(0, 512),
            stack: String(error.stack || '').slice(0, 1024) },
        };
        const result = appendBoundedFileSync(path.join(logDir, 'errors', 'ai.jsonl'), `${JSON.stringify(redactCredentials(safe))}\n`, {
          maxEntryBytes: 16 * 1024, maxFileBytes: 3 * MIB, maxAgeMs: ERROR_LOG_AGE_MS, now,
        });
        return !result.written;
      }).join('');
      if (!kept) fs.unlinkSync(file);
      else if (kept !== content) fs.writeFileSync(file, kept, 'utf8');
    } catch {
      // Preserve this source and let the next archive continue independently.
      continue;
    }
  }
}

function installLogMaintenance(logDir) {
  maintainDesktopLogs(logDir);
  const timer = setInterval(() => maintainDesktopLogs(logDir), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { maintainDesktopLogs, installLogMaintenance };
