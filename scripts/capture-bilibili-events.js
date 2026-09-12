'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const {
  WebSocketConnection,
} = require('../src/bilibili/danmaku/websocket-connection');
const packetParser = require('../src/bilibili/packet-parser');
const { cleanText } = require('../src/shared/utils');

const DEFAULT_DURATION_SECONDS = 300;

function parseArguments(argv, cwd = process.cwd()) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };

  const allowedOptions = new Set([
    '--room',
    '--duration',
    '--output',
    '--gift-only',
    '--bilibili-user-data',
  ]);
  for (const argument of argv) {
    if (argument.startsWith('--') && !allowedOptions.has(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  const roomId = readRequiredOption(argv, '--room');
  const durationSeconds = Number(
    readOption(argv, '--duration') || DEFAULT_DURATION_SECONDS,
  );
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error('--duration must be a positive whole number of seconds');
  }

  const outputOption = readOption(argv, '--output');
  const bilibiliUserDataOption = readOption(argv, '--bilibili-user-data');
  return {
    help: false,
    roomId,
    durationMs: durationSeconds * 1000,
    outputPath: path.resolve(cwd, outputOption || defaultOutputName()),
    giftOnly: argv.includes('--gift-only'),
    bilibiliUserDataPath: bilibiliUserDataOption
      ? path.resolve(cwd, bilibiliUserDataOption)
      : '',
  };
}

function readRequiredOption(argv, option) {
  const value = readOption(argv, option);
  if (!value) throw new Error(`${option} is required`);
  return value;
}

function readOption(argv, option) {
  const index = argv.indexOf(option);
  if (index === -1) return '';
  const value = argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${option} requires a value`);
  return value;
}

function defaultOutputName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join('tmp', `bilibili-events-${timestamp}.ndjson`);
}

function buildCaptureRecord(message, receivedAt) {
  return {
    type: 'event',
    receivedAt,
    cmd: cleanText(message && message.cmd),
    data:
      message && message.data && typeof message.data === 'object'
        ? message.data
        : {},
  };
}

function shouldCaptureMessage(message, giftOnly) {
  if (!giftOnly) return true;
  return packetParser.isBilibiliGiftLikeCommand(
    message && message.cmd,
    new Set(),
  );
}

async function captureEvents(options) {
  const apiClient = new BilibiliApiClient(options.roomId, {
    cookieHeader: options.cookieHeader || process.env.BILIBILI_COOKIE || '',
    uid: Number(options.uid || process.env.BILIBILI_UID || 0),
  });
  const roomInfo = await apiClient.resolveRoomInfo();
  const danmuInfo = await apiClient.resolveDanmuInfo(roomInfo.roomId);
  const host = (danmuInfo.host_list || [])[0];
  if (!host)
    throw new Error('Bilibili did not provide a danmaku WebSocket host');

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const writer = fs.createWriteStream(options.outputPath, { flags: 'wx' });
  const connection = new WebSocketConnection();
  const summary = {
    type: 'summary',
    stoppedAt: '',
    reason: '',
    eventCount: 0,
    commandCounts: {},
    parseErrorCount: 0,
  };
  let timer = null;
  let connectTimer = null;
  let stopping = false;
  let connected = false;
  let failure = null;
  let requestStop;
  let pendingWrites = Promise.resolve();
  const writeWait = new AbortController();
  const stopped = new Promise((resolve) => {
    requestStop = resolve;
  });

  function stop(reason, error) {
    failure ??= error;
    if (failure) writeWait.abort();
    if (stopping) return;
    stopping = true;
    summary.stoppedAt = new Date().toISOString();
    summary.reason = reason;
    requestStop();
  }

  function onWriterError(error) {
    stop('output-error', error);
  }

  writer.on('error', onWriterError);
  // Wait for close as well as finish: closing the file descriptor can fail.
  const writerClosed = new Promise((resolve) => {
    writer.once('close', () => {
      if (!writer.writableFinished && !failure) {
        stop('output-error', new Error('Capture output closed before finishing'));
      }
      resolve();
    });
  });

  function writeRecord(record) {
    pendingWrites = pendingWrites.then(async () => {
      if (failure) return;
      if (!writer.write(`${JSON.stringify(record)}\n`)) {
        await once(writer, 'drain', { signal: writeWait.signal });
      }
    }).catch(onWriterError);
    return pendingWrites;
  }

  function onSignal() {
    stop('interrupted');
  }

  connection.on('message', (buffer) => {
    if (stopping) return;
    try {
      for (const message of packetParser.parseBilibiliPackets(buffer)) {
        if (!shouldCaptureMessage(message, options.giftOnly)) continue;
        const cmd = cleanText(message && message.cmd) || '(none)';
        writeRecord(buildCaptureRecord(message, new Date().toISOString()));
        summary.eventCount += 1;
        summary.commandCounts[cmd] = (summary.commandCounts[cmd] || 0) + 1;
      }
    } catch (error) {
      summary.parseErrorCount += 1;
      console.warn(`[Capture] packet parse failed: ${error.message}`);
    }
  });
  connection.on('close', () => {
    stop('connection-closed', connected ? null : new Error('弹幕 WebSocket 连接已关闭。'));
  });
  connection.on('error', (error) => {
    console.warn('[Capture] WebSocket reported an error');
    stop('connection-error', error instanceof Error ? error : new Error('弹幕 WebSocket 连接失败。'));
  });

  try {
    await once(writer, 'open', { signal: writeWait.signal });
    process.once('SIGINT', onSignal);
    // Own the open timeout here so stopping during connect cancels every wait.
    const opened = new Promise((resolve) => connection.on('open', () => {
      connected = true;
      resolve();
    }));
    connectTimer = setTimeout(() => {
      stop('connection-error', new Error('弹幕 WebSocket 连接超时，请稍后重试。'));
    }, 8000);
    const connecting = connection.connect(
      `wss://${host.host}:${host.wss_port || 443}/sub`,
      {
        uid: apiClient.uid || 0,
        roomid: roomInfo.roomId,
        protover: 3,
        platform: 'web',
        type: 2,
        key: danmuInfo.token,
      },
    );
    await Promise.race([Promise.all([connecting, opened]), stopped]);
    clearTimeout(connectTimer);
    if (!stopping) {
      await writeRecord({
        type: 'meta',
        startedAt: new Date().toISOString(),
        roomId: String(roomInfo.roomId),
        giftOnly: options.giftOnly,
        authenticated: Boolean(apiClient.cookieHeader && apiClient.uid),
        uid: apiClient.uid || 0,
      });
    }
    if (!stopping) {
      timer = setTimeout(() => stop('duration-elapsed'), options.durationMs);
    }
    await stopped;
  } catch (error) {
    stop('capture-error', error);
  }

  return completeCapture();

  async function completeCapture() {
    clearTimeout(timer);
    clearTimeout(connectTimer);
    process.off('SIGINT', onSignal);
    try {
      connection.clearHandlers();
      connection.close();
    } catch (error) {
      onWriterError(error);
    }
    await pendingWrites;
    if (!failure) await writeRecord(summary);
    try {
      if (failure) writer.destroy();
      else writer.end();
    } catch (error) {
      onWriterError(error);
      writer.destroy();
    }
    await writerClosed;
    writer.off('error', onWriterError);
    if (failure) throw failure;
    return summary;
  }
}

async function loadBilibiliDesktopAuth(userDataPath) {
  if (!userDataPath) return null;
  if (!process.versions.electron) {
    throw new Error(
      '--bilibili-user-data requires running this script with Electron',
    );
  }

  const { app } = require('electron');
  app.setPath('userData', userDataPath);
  await app.whenReady();

  const auth = require('../src/electron/bilibili-auth');
  const state = await auth.getBilibiliAuthState(userDataPath);
  if (!state.loggedIn) {
    throw new Error(`No complete Bilibili login was found in ${userDataPath}`);
  }

  return {
    cookieHeader: await auth.getBilibiliCookieHeader(),
    uid: await auth.getBilibiliUid(),
    close: () => app.quit(),
  };
}

function printUsage() {
  console.log(
    'Usage: node scripts/capture-bilibili-events.js --room <roomId> [--duration <seconds>] [--output <path>] [--gift-only]',
  );
  console.log(
    'Logged-in desktop capture: electron scripts/bilibili-capture-electron ... --bilibili-user-data <Electron userData path>',
  );
  console.log(
    'Set BILIBILI_COOKIE when the room requires a logged-in danmaku connection.',
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  let desktopAuth = null;
  try {
    desktopAuth = await loadBilibiliDesktopAuth(options.bilibiliUserDataPath);
    if (desktopAuth) {
      options.cookieHeader = desktopAuth.cookieHeader;
      options.uid = desktopAuth.uid;
    }
    console.log(
      `[Capture] room=${options.roomId} duration=${options.durationMs / 1000}s output=${options.outputPath} giftOnly=${options.giftOnly} authenticated=${Boolean(options.cookieHeader || process.env.BILIBILI_COOKIE)}`,
    );
    const summary = await captureEvents(options);
    console.log(
      `[Capture] finished reason=${summary.reason} events=${summary.eventCount} output=${options.outputPath}`,
    );
  } finally {
    if (desktopAuth) desktopAuth.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[Capture] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArguments,
  buildCaptureRecord,
  shouldCaptureMessage,
  loadBilibiliDesktopAuth,
  main,
};
