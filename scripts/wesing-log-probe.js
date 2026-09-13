'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_LOG_LINE_CHARS = 8000;

function parseStartKSongLine(line) {
  if (!String(line || '').includes('"StartKSong"')) return null;
  const midMatch = line.match(/"mid"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  const songMatch = line.match(/"songname"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
  return {
    mid: midMatch ? decodeJsonString(midMatch[1]) : '',
    songName: songMatch ? decodeJsonString(songMatch[1]) : '',
  };
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch (_) {
    return String(value || '');
  }
}

async function findLatestLogFile(logDirectory) {
  let entries;
  try {
    entries = await fs.promises.readdir(logDirectory, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.log'),
      )
      .map(async (entry) => {
        const filePath = path.join(logDirectory, entry.name);
        try {
          const stat = await fs.promises.stat(filePath);
          return { filePath, modifiedMs: stat.mtimeMs, size: stat.size };
        } catch (_) {
          return null;
        }
      }),
  );
  return (
    candidates
      .filter(Boolean)
      .sort((left, right) => right.modifiedMs - left.modifiedMs)[0] ?? null
  );
}

/**
 * Tail the active UTF-16LE WeSing log and report only bytes written after startup.
 *
 * @param {string} cachePath WeSingCache directory
 * @param {(event: object) => void} onEvent event receiver
 * @param {{ pollIntervalMs?: number }} options polling options
 * @returns {{ start: () => Promise<void>, stop: () => Promise<void> }}
 */
function createWeSingLogProbe(cachePath, onEvent, options = {}) {
  const logDirectory = path.join(cachePath, 'Log', 'WeSing');
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 250);
  let activeFilePath = '';
  let offset = 0;
  let pendingText = '';
  let oddByte = Buffer.alloc(0);
  let timer = null;
  let stopped = false;
  let inFlight = Promise.resolve();

  function emit(event) {
    onEvent({ observedAt: new Date().toISOString(), ...event });
  }

  function processText(text, filePath) {
    const rows = `${pendingText}${text}`.split(/\r?\n/);
    pendingText = rows.pop() ?? '';
    for (const row of rows) {
      if (!row) continue;
      const clipped = row.slice(-MAX_LOG_LINE_CHARS);
      emit({
        event: 'wesing-log-line',
        file: path.basename(filePath),
        line: clipped,
        startKSong: parseStartKSongLine(clipped),
      });
    }
  }

  async function readNewBytes(candidate) {
    if (candidate.filePath !== activeFilePath) {
      activeFilePath = candidate.filePath;
      offset = 0;
      pendingText = '';
      oddByte = Buffer.alloc(0);
      emit({
        event: 'wesing-log-file',
        status: 'switched',
        file: path.basename(activeFilePath),
      });
    }
    if (candidate.size < offset) {
      offset = 0;
      pendingText = '';
      oddByte = Buffer.alloc(0);
      emit({
        event: 'wesing-log-file',
        status: 'truncated',
        file: path.basename(activeFilePath),
      });
    }
    if (candidate.size === offset) return;

    const length = candidate.size - offset;
    const buffer = Buffer.alloc(length);
    const handle = await fs.promises.open(activeFilePath, 'r');
    let bytesRead = 0;
    try {
      const result = await handle.read(buffer, 0, length, offset);
      bytesRead = result.bytesRead;
    } finally {
      await handle.close();
    }
    offset += bytesRead;
    let combined = Buffer.concat([oddByte, buffer.subarray(0, bytesRead)]);
    if (combined.length % 2 === 1) {
      oddByte = combined.subarray(combined.length - 1);
      combined = combined.subarray(0, combined.length - 1);
    } else {
      oddByte = Buffer.alloc(0);
    }
    if (combined.length)
      processText(combined.toString('utf16le'), activeFilePath);
  }

  async function poll() {
    const candidate = await findLatestLogFile(logDirectory);
    if (!candidate) return;
    await readNewBytes(candidate);
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = poll()
        .catch((error) =>
          emit({
            event: 'wesing-log-error',
            message: error.message || String(error),
          }),
        )
        .finally(schedule);
    }, pollIntervalMs);
  }

  return {
    async start() {
      const initial = await findLatestLogFile(logDirectory);
      if (initial) {
        activeFilePath = initial.filePath;
        offset = initial.size;
        emit({
          event: 'wesing-log-file',
          status: 'ready',
          file: path.basename(activeFilePath),
          initialSize: offset,
        });
      } else {
        emit({
          event: 'wesing-log-file',
          status: 'not-found',
          directory: logDirectory,
        });
      }
      schedule();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      if (pendingText) processText('\n', activeFilePath);
    },
  };
}

module.exports = { createWeSingLogProbe, parseStartKSongLine };
