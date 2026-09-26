'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { redactCredentials } = require('../shared/log-redaction');
const { truncateUtf8 } = require('../shared/log-size-limit');

const SUMMARY_WINDOW_MS = 15 * 60 * 1000;
const NORMAL_ENTRY_BYTES = 2 * 1024;
const ERROR_ENTRY_BYTES = 16 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RUNTIME_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_GROUPS = 128;
const MAX_QUEUE_ENTRIES = 2000;
const MAX_QUEUE_BYTES = 4 * 1024 * 1024;
const ERROR_RESERVED_ENTRIES = 200;
const ERROR_RESERVED_BYTES = 512 * 1024;

function createAiRequestLogger(options = {}) {
  const logDir = options.logDir ? path.resolve(options.logDir) : '';
  const compatibilityFilePath = path.resolve(options.filePath || path.join(process.cwd(), 'logs', 'ai.log'));
  const targetPaths = logDir
    ? {
        runtime: path.join(logDir, 'runtime', 'ai.jsonl'),
        errors: path.join(logDir, 'errors', 'ai.jsonl'),
      }
    : {
        runtime: compatibilityFilePath,
        errors: compatibilityFilePath,
      };
  const filePath = targetPaths.runtime;
  const now = options.now || (() => new Date());
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const summaryWindowMs = positiveNumber(options.summaryWindowMs, SUMMARY_WINDOW_MS);
  const maxSummaryGroups = positiveNumber(options.maxSummaryGroups, MAX_SUMMARY_GROUPS);
  const maxQueueEntries = positiveNumber(options.maxQueueEntries, MAX_QUEUE_ENTRIES);
  const maxQueueBytes = positiveNumber(options.maxQueueBytes, MAX_QUEUE_BYTES);
  const runtimeFileBytes = positiveNumber(options.maxFileBytes, logDir ? RUNTIME_FILE_BYTES : MAX_FILE_BYTES);
  const errorFileBytes = positiveNumber(options.maxFileBytes, MAX_FILE_BYTES);
  const appendLine = options.appendLine || appendToCompatibilityFile;
  const summaries = new Map();
  const health = {
    queuedEntries: 0,
    queuedBytes: 0,
    droppedQueueEntries: 0,
    droppedCapacityEntries: 0,
    writeFailureEntries: 0,
    overflowGroupEvents: 0,
  };
  let pendingWrite = Promise.resolve();
  let summaryTimer = null;

  function log(event = {}, logOptions = {}) {
    const timestamp = toIsoString(now());
    if (event.type === 'request_succeeded') {
      recordSummary(event, timestamp, true, logOptions.secrets);
      return Promise.resolve(true);
    }
    if (event.type !== 'request_failed') return Promise.resolve(false);

    recordSummary(event, timestamp, false, logOptions.secrets);
    const record = createFailureRecord(event, timestamp, logOptions.secrets);
    return enqueue('errors', encodeRecord(record, ERROR_ENTRY_BYTES));
  }

  function recordSummary(event, timestamp, succeeded, secrets) {
    const dimensions = summaryDimensions(event, secrets);
    let key = JSON.stringify(dimensions);
    if (!summaries.has(key) && summaries.size >= maxSummaryGroups - 1) {
      key = 'other';
      health.overflowGroupEvents += 1;
    }
    let summary = summaries.get(key);
    if (!summary) {
      const group = key === 'other' ? otherDimensions() : dimensions;
      summary = {
        windowStart: timestamp,
        windowEnd: timestamp,
        ...group,
        successCount: 0,
        failureCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        functionCallCount: 0,
        durationMaxMs: 0,
        durationBuckets: emptyDurationBuckets(),
      };
      summaries.set(key, summary);
    }

    summary.windowEnd = timestamp;
    if (succeeded) summary.successCount = boundedAdd(summary.successCount, 1);
    else summary.failureCount = boundedAdd(summary.failureCount, 1);
    summary.inputTokens = boundedAdd(summary.inputTokens, nonNegativeInteger(event.inputTokens));
    summary.outputTokens = boundedAdd(summary.outputTokens, nonNegativeInteger(event.outputTokens));
    summary.functionCallCount = boundedAdd(summary.functionCallCount, nonNegativeInteger(event.functionCallCount));
    const durationMs = nonNegativeNumber(event.durationMs);
    summary.durationMaxMs = Math.max(summary.durationMaxMs, durationMs);
    incrementDurationBucket(summary.durationBuckets, durationMs);
    scheduleSummaryFlush();
  }

  function scheduleSummaryFlush() {
    if (summaryTimer) return;
    summaryTimer = setTimer(() => {
      summaryTimer = null;
      void flushSummaries();
    }, summaryWindowMs);
    summaryTimer?.unref?.();
  }

  async function flushSummaries() {
    const summariesToFlush = Array.from(summaries.values());
    summaries.clear();
    const writes = summariesToFlush.map((summary) => {
      const record = {
        schemaVersion: 1,
        timestamp: summary.windowEnd,
        level: 'info',
        category: 'runtime',
        service: 'client',
        module: 'ai',
        event: 'ai.requestSummary',
        windowStart: summary.windowStart,
        windowEnd: summary.windowEnd,
        provider: summary.provider,
        model: summary.model,
        purpose: summary.purpose,
        protocol: summary.protocol,
        requestCount: summary.successCount + summary.failureCount,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        functionCallCount: summary.functionCallCount,
        durationMaxMs: summary.durationMaxMs,
        durationBuckets: summary.durationBuckets,
      };
      return enqueue('runtime', encodeRecord(record, NORMAL_ENTRY_BYTES));
    });
    await Promise.all(writes);
  }

  function enqueue(stream, line) {
    const bytes = Buffer.byteLength(line, 'utf8');
    const isError = stream === 'errors';
    const normalEntryLimit = Math.max(1, maxQueueEntries - Math.min(ERROR_RESERVED_ENTRIES, maxQueueEntries - 1));
    const normalByteLimit = Math.max(0, maxQueueBytes - Math.min(ERROR_RESERVED_BYTES, maxQueueBytes / 8));
    const entryLimit = isError ? maxQueueEntries : normalEntryLimit;
    const byteLimit = isError ? maxQueueBytes : normalByteLimit;
    if (health.queuedEntries >= entryLimit || health.queuedBytes + bytes > byteLimit) {
      health.droppedQueueEntries += 1;
      return Promise.resolve(false);
    }

    health.queuedEntries += 1;
    health.queuedBytes += bytes;
    const write = pendingWrite
      .catch(() => {})
      .then(() =>
        appendLine(stream, line, {
          filePath: targetPaths[stream],
          maxFileBytes: stream === 'errors' ? errorFileBytes : runtimeFileBytes,
        }),
      )
      .then((written) => {
        if (written === false) health.droppedCapacityEntries += 1;
        return written !== false;
      })
      .catch(() => {
        health.writeFailureEntries += 1;
        return false;
      })
      .finally(() => {
        health.queuedEntries -= 1;
        health.queuedBytes -= bytes;
      });
    pendingWrite = write.then(() => undefined);
    return write;
  }

  async function flush() {
    if (summaryTimer) {
      clearTimer(summaryTimer);
      summaryTimer = null;
    }
    await flushSummaries();
    await pendingWrite;
  }

  function getHealth() {
    return { ...health };
  }

  async function appendToCompatibilityFile(_stream, line, writeOptions) {
    await fs.mkdir(path.dirname(writeOptions.filePath), { recursive: true });
    let currentBytes = 0;
    try {
      const stat = await fs.lstat(writeOptions.filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) return false;
      currentBytes = stat.size;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentBytes + Buffer.byteLength(line, 'utf8') > writeOptions.maxFileBytes) {
      return false;
    }
    await fs.appendFile(writeOptions.filePath, line, 'utf8');
    return true;
  }

  return { filePath, log, flush, getHealth };
}

function createFailureRecord(event, timestamp, secrets) {
  const error = event.error && typeof event.error === 'object' ? event.error : {};
  return {
    schemaVersion: 1,
    timestamp,
    level: 'error',
    category: 'error',
    service: 'client',
    module: 'ai',
    event: 'ai.requestFailed',
    requestId: safeText(event.requestId, 128, secrets),
    provider: safeText(event.provider, 64, secrets),
    model: safeText(event.model, 128, secrets),
    purpose: safeText(event.purpose, 64, secrets),
    protocol: safeText(event.protocol, 32, secrets),
    status: nonNegativeInteger(event.status),
    durationMs: nonNegativeNumber(event.durationMs),
    outcome: 'failed',
    error: {
      code: safeText(error.code, 128, secrets),
      name: safeText(error.name || 'Error', 128, secrets),
      message: safeText(error.message, 4 * 1024, secrets),
      stack: safeText(error.stack, 12 * 1024, secrets),
    },
  };
}

function encodeRecord(record, maxBytes) {
  let candidate = record;
  let line = `${JSON.stringify(candidate)}\n`;
  if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line;

  if (candidate.error) {
    candidate = {
      ...candidate,
      truncated: true,
      error: {
        ...candidate.error,
        message: truncateUtf8(candidate.error.message, 1024),
        stack: truncateUtf8(candidate.error.stack, 8 * 1024),
      },
    };
    line = `${JSON.stringify(candidate)}\n`;
    while (Buffer.byteLength(line, 'utf8') > maxBytes && candidate.error.stack) {
      const nextLimit = Math.max(0, Buffer.byteLength(candidate.error.stack, 'utf8') - 512);
      candidate.error.stack = truncateUtf8(candidate.error.stack, nextLimit);
      line = `${JSON.stringify(candidate)}\n`;
    }
  }

  if (Buffer.byteLength(line, 'utf8') <= maxBytes) return line;
  const minimal = {
    schemaVersion: record.schemaVersion,
    timestamp: record.timestamp,
    level: record.level,
    category: record.category,
    service: record.service,
    module: record.module,
    event: record.event,
    requestId: record.requestId,
    outcome: record.outcome,
    error: record.error
      ? {
          code: record.error.code,
          name: record.error.name,
          message: truncateUtf8(record.error.message, 512),
        }
      : undefined,
    truncated: true,
  };
  return `${JSON.stringify(minimal)}\n`;
}

function summaryDimensions(event, secrets) {
  return {
    provider: safeText(event.provider || 'unknown', 64, secrets),
    model: safeText(event.model || 'unknown', 128, secrets),
    purpose: safeText(event.purpose || 'model_request', 64, secrets),
    protocol: safeText(event.protocol || 'unknown', 32, secrets),
  };
}

function otherDimensions() {
  return {
    provider: 'other',
    model: 'other',
    purpose: 'other',
    protocol: 'other',
  };
}

function emptyDurationBuckets() {
  return { le250: 0, le1000: 0, le5000: 0, le15000: 0, over15000: 0 };
}

function incrementDurationBucket(buckets, durationMs) {
  if (durationMs <= 250) buckets.le250 += 1;
  else if (durationMs <= 1000) buckets.le1000 += 1;
  else if (durationMs <= 5000) buckets.le5000 += 1;
  else if (durationMs <= 15000) buckets.le15000 += 1;
  else buckets.over15000 += 1;
}

function safeText(value, maxBytes, secrets = []) {
  let result = String(redactCredentials(String(value || '')) || '');
  for (const secret of normalizeSecrets(secrets)) {
    result = result.replaceAll(secret, '[REDACTED]');
  }
  return truncateUtf8(result, maxBytes);
}

function normalizeSecrets(values) {
  return Array.from(
    new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '')).filter(Boolean)),
  );
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, number)) : 0;
}

function nonNegativeInteger(value) {
  return Math.trunc(nonNegativeNumber(value));
}

function boundedAdd(left, right) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

module.exports = { createAiRequestLogger };
