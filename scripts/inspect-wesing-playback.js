'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { performance } = require('node:perf_hooks');
const {
  createPowerShellWeSingMonitor,
} = require('../src/music/wesing-capture');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MAX_LOG_LINE_CHARS = 8000;
const MARKERS = Object.freeze({
  1: '点击 K 歌 / 开始录制',
  2: '点击暂停',
  3: '点击继续',
  4: '退出本次录制',
  5: '重新进入同一首歌 K 歌',
  6: '此刻歌词状态不正确',
});

function defaultCachePath(environment = process.env) {
  return environment.APPDATA
    ? path.join(environment.APPDATA, 'Tencent', 'WeSing', 'WeSingCache')
    : '';
}

function defaultOutputPath(projectRoot = PROJECT_ROOT, date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return path.join(
    projectRoot,
    'logs',
    `wesing-playback-diagnostic-${timestamp}.jsonl`,
  );
}

/**
 * Parse the diagnostic command-line options without mutating argv.
 *
 * @param {string[]} argv command-line arguments after the script name
 * @param {{ environment?: NodeJS.ProcessEnv, projectRoot?: string, now?: Date }} context defaults for tests and CLI use
 * @returns {{ cachePath: string, outputPath: string, durationMs: number, help: boolean }}
 */
function parseArguments(argv, context = {}) {
  const environment = context.environment ?? process.env;
  const projectRoot = context.projectRoot ?? PROJECT_ROOT;
  const now = context.now ?? new Date();
  let cachePath = defaultCachePath(environment);
  let outputPath = defaultOutputPath(projectRoot, now);
  let durationMs = 0;
  let help = false;
  let cachePathFromArgument = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (
      argument === '--cache' ||
      argument === '--output' ||
      argument === '--duration'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--'))
        throw new Error(`${argument} 缺少参数。`);
      index += 1;
      if (argument === '--cache') {
        cachePath = path.resolve(value);
        cachePathFromArgument = true;
      }
      if (argument === '--output') outputPath = path.resolve(value);
      if (argument === '--duration') {
        const durationSeconds = Number(value);
        if (
          !Number.isFinite(durationSeconds) ||
          durationSeconds <= 0 ||
          durationSeconds > 3600
        ) {
          throw new Error('--duration 必须是 1 到 3600 之间的秒数。');
        }
        durationMs = Math.round(durationSeconds * 1000);
      }
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  return { cachePath, outputPath, durationMs, help, cachePathFromArgument };
}

function markerForKey(keyName) {
  return MARKERS[String(keyName || '')] ?? null;
}

function printHelp() {
  console.log(`全民 K 歌播放状态诊断

用法：
  node scripts/inspect-wesing-playback.js [选项]

选项：
  --cache <目录>      指定 WeSingCache 目录（默认读取当前软件配置）
  --output <文件>     指定 JSONL 日志文件
  --duration <秒>     到时自动结束，最多 3600 秒
  -h, --help          显示帮助
`);
}

async function readRunningCachePath(options = {}) {
  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const environment = options.environment ?? process.env;
  const readFile = options.readFile ?? fs.promises.readFile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dataDirectory = environment.SONG_PLUGIN_DATA_DIR
    ? path.resolve(environment.SONG_PLUGIN_DATA_DIR)
    : path.join(projectRoot, 'data');

  try {
    const [runtimeText, token] = await Promise.all([
      readFile(path.join(dataDirectory, '.server-runtime.json'), 'utf8'),
      readFile(path.join(dataDirectory, '.session-token'), 'utf8'),
    ]);
    const runtime = JSON.parse(runtimeText);
    const host = String(runtime.host || '127.0.0.1').toLowerCase();
    const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    const port = Number(runtime.port);
    if (
      !allowedHosts.has(host) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return '';
    const requestHost = host === '::1' ? '[::1]' : host;
    const response = await fetchImpl(
      `http://${requestHost}:${port}/api/music/wesing/status`,
      {
        headers: { Authorization: `Bearer ${String(token).trim()}` },
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) return '';
    const payload = await response.json();
    return typeof payload?.data?.cachePath === 'string'
      ? payload.data.cachePath
      : '';
  } catch (_) {
    return '';
  }
}

async function createJsonlWriter(outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await fs.promises.open(outputPath, 'w');
  let pending = Promise.resolve();
  let failure = null;
  let closing = null;

  return {
    write(record) {
      const line = `${JSON.stringify(record)}\n`;
      pending = pending
        .then(async () => {
          if (failure) return;
          await handle.appendFile(line, 'utf8');
        })
        .catch((error) => {
          failure ??= error;
        });
      return pending.then(() => {
        if (failure) throw failure;
      });
    },
    close() {
      closing ??= (async () => {
        await pending;
        try {
          await handle.close();
        } catch (error) {
          failure ??= error;
        }
        if (failure) throw failure;
      })();
      return closing;
    },
  };
}

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

function summarizeSample(sample = {}) {
  const source = sample && typeof sample === 'object' ? sample : {};
  return {
    detected: source.detected === true,
    title: String(source.title || ''),
    currentSec: Number(source.currentSec),
    totalSec: Number(source.totalSec),
    loading: source.loading === true,
    audioActive: source.audioActive ?? null,
    audioPeak: Number(source.audioPeak),
    windowHandle: Number(source.windowHandle),
    processIds: Array.isArray(source.processIds) ? source.processIds : [],
    controlCount: Array.isArray(source.controls) ? source.controls.length : 0,
    error: source.error ? String(source.error) : '',
  };
}

async function runDiagnostic(configuration) {
  const writer = await createJsonlWriter(configuration.outputPath);
  const startedAt = performance.now();
  let latestSample = null;
  let lastConsoleAt = 0;
  let lastSignature = '';
  let finishPromise = null;
  let failure = null;
  let acceptingRecords = true;
  let finishResolve;
  let durationTimer = null;
  const finishedPromise = new Promise((resolve) => {
    finishResolve = resolve;
  });

  async function writeRecord(record) {
    return writer.write({
      observedAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - startedAt),
      ...record,
    });
  }

  function showSample(sample) {
    const summary = summarizeSample(sample);
    const signature = [
      summary.detected,
      summary.title,
      summary.currentSec,
      summary.totalSec,
      summary.loading,
      summary.audioActive,
      summary.windowHandle,
      summary.error,
    ].join('|');
    const timestamp = performance.now();
    if (signature === lastSignature && timestamp - lastConsoleAt < 1000) return;
    lastSignature = signature;
    lastConsoleAt = timestamp;
    console.log(
      `[采样] 标题=${summary.title || '-'} 进度=${summary.currentSec}/${summary.totalSec} ` +
        `Active=${String(summary.audioActive)} Peak=${summary.audioPeak} ` +
        `窗口=${summary.windowHandle || '-'} 控件=${summary.controlCount}`,
    );
  }

  let monitor = null;
  let logProbe = null;
  let rawModeEnabled = false;
  let inputResumed = false;
  const previousRawMode = process.stdin.isRaw === true;
  const inputWasPaused = process.stdin.isPaused();
  const readlineListeners = [];
  let keypressHandler = null;
  let sigintHandler = null;

  function recordEvent(record) {
    if (!acceptingRecords) return;
    void writeRecord(record).catch((error) => {
      finish('error', error);
    });
  }

  function finish(reason, error) {
    failure ??= error;
    if (finishPromise) return finishPromise;
    finishPromise = Promise.resolve().then(async () => {
      async function cleanUp(action) {
        try {
          await action();
        } catch (cleanupError) {
          failure ??= cleanupError;
        }
      }

      await cleanUp(() => clearTimeout(durationTimer));
      await cleanUp(() => monitor?.stop());
      await cleanUp(() => logProbe?.stop());
      acceptingRecords = false;
      await cleanUp(() => writeRecord({
        event: 'diagnostic-stop',
        reason,
        latestSample: summarizeSample(latestSample),
      }));
      await cleanUp(() => {
        if (keypressHandler) process.stdin.off('keypress', keypressHandler);
      });
      for (const [event, listener] of readlineListeners) {
        await cleanUp(() => process.stdin.off(event, listener));
      }
      await cleanUp(() => {
        if (rawModeEnabled) process.stdin.setRawMode(previousRawMode);
      });
      await cleanUp(() => {
        if (inputResumed && inputWasPaused) process.stdin.pause();
      });
      await cleanUp(() => {
        if (sigintHandler) process.off('SIGINT', sigintHandler);
      });
      await cleanUp(() => writer.close());
      if (failure) throw failure;
      console.log(`\n诊断已结束，日志已保存：\n${configuration.outputPath}`);
    });
    // Observe every event-triggered finish, including before startup completes.
    finishPromise.then(() => finishResolve(null), finishResolve);
    return finishPromise;
  }

  async function start() {
    monitor = createPowerShellWeSingMonitor(
      (sample) => {
        latestSample = sample;
        recordEvent({ event: 'monitor-sample', sample });
        showSample(sample);
      },
      { includeDiagnostics: true, pollIntervalMs: 250 },
    );

    logProbe = createWeSingLogProbe(configuration.cachePath, (event) => {
      recordEvent(event);
      if (event.startKSong) {
        console.log(
          `[全民日志] StartKSong：${event.startKSong.songName || '-'} (${event.startKSong.mid || '-'})`,
        );
      }
    });

    await writeRecord({
      event: 'diagnostic-start',
      cachePath: configuration.cachePath,
      outputPath: configuration.outputPath,
      nodeVersion: process.version,
      platform: process.platform,
    });
    await logProbe.start();
    if (finishPromise) return;
    await monitor.start();
    if (finishPromise) return;

    console.log(`
诊断已经开始。请先在全民 K 歌里执行动作，动作完成后马上按对应数字键打标：

  1  点击 K 歌 / 开始录制
  2  点击暂停
  3  点击继续
  4  退出本次录制
  5  重新进入同一首歌 K 歌
  6  此刻歌词状态不正确
  Q  结束并保存日志

WeSingCache：${configuration.cachePath}
日志文件：${configuration.outputPath}
`);

    if (process.stdin.isTTY) {
      const previousListeners = new Map(['data', 'newListener'].map((event) => [
        event, new Set(process.stdin.listeners(event)),
      ]));
      try {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        rawModeEnabled = true;
        process.stdin.resume();
        inputResumed = true;
        keypressHandler = (text, key = {}) => {
          if (key.ctrl && key.name === 'c') {
            return finish('ctrl-c');
          }
          if (String(key.name || text || '').toLowerCase() === 'q') {
            return finish('q');
          }
          const marker = markerForKey(key.name || text);
          if (!marker) return;
          recordEvent({
            event: 'user-marker',
            key: String(key.name || text),
            marker,
            latestSample: summarizeSample(latestSample),
          });
          console.log(`\n[操作标记] ${marker}`);
        };
        process.stdin.on('keypress', keypressHandler);
      } finally {
        for (const [event, previous] of previousListeners) {
          for (const listener of process.stdin.listeners(event)) {
            if (!previous.has(listener)) readlineListeners.push([event, listener]);
          }
        }
      }
    } else {
      console.log('当前终端不支持数字键标记，可用 Ctrl+C 或 --duration 结束。');
    }

    sigintHandler = () => finish('sigint');
    process.on('SIGINT', sigintHandler);
    if (configuration.durationMs > 0) {
      durationTimer = setTimeout(() => finish('duration'), configuration.durationMs);
    }
  }

  try {
    await start();
  } catch (error) {
    finish('error', error);
  }
  const finishError = await finishedPromise;
  if (finishError) throw finishError;
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const configuredCachePath = parsed.cachePathFromArgument
    ? ''
    : await readRunningCachePath();
  const configuration = {
    ...parsed,
    cachePath: configuredCachePath || parsed.cachePath,
  };
  if (configuration.help) {
    printHelp();
    return;
  }
  await runDiagnostic(configuration);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `诊断脚本运行失败：${error.stack || error.message || String(error)}`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  createWeSingLogProbe,
  defaultCachePath,
  defaultOutputPath,
  markerForKey,
  parseArguments,
  parseStartKSongLine,
  readRunningCachePath,
  summarizeSample,
};
