'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { BilibiliApiClient } = require('../src/bilibili/danmaku/api-client');
const { WebSocketConnection } = require('../src/bilibili/danmaku/websocket-connection');
const packetParser = require('../src/bilibili/packet-parser');
const { cleanText } = require('../src/shared/utils');

const DEFAULT_DURATION_SECONDS = 300;

function parseArguments(argv, cwd = process.cwd()) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };

  const allowedOptions = new Set(['--room', '--duration', '--output', '--gift-only']);
  for (const argument of argv) {
    if (argument.startsWith('--') && !allowedOptions.has(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  const roomId = readRequiredOption(argv, '--room');
  const durationSeconds = Number(readOption(argv, '--duration') || DEFAULT_DURATION_SECONDS);
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error('--duration must be a positive whole number of seconds');
  }

  const outputOption = readOption(argv, '--output');
  return {
    help: false,
    roomId,
    durationMs: durationSeconds * 1000,
    outputPath: path.resolve(cwd, outputOption || defaultOutputName()),
    giftOnly: argv.includes('--gift-only')
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
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
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
    data: message && message.data && typeof message.data === 'object' ? message.data : {}
  };
}

function shouldCaptureMessage(message, giftOnly) {
  if (!giftOnly) return true;
  return packetParser.isBilibiliGiftLikeCommand(message && message.cmd, new Set());
}

async function captureEvents(options) {
  const apiClient = new BilibiliApiClient(options.roomId, {
    cookieHeader: process.env.BILIBILI_COOKIE || '',
    uid: Number(process.env.BILIBILI_UID || 0)
  });
  const roomInfo = await apiClient.resolveRoomInfo();
  const danmuInfo = await apiClient.resolveDanmuInfo(roomInfo.roomId);
  const host = (danmuInfo.host_list || [])[0];
  if (!host) throw new Error('Bilibili did not provide a danmaku WebSocket host');

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const writer = fs.createWriteStream(options.outputPath, { flags: 'wx' });
  const connection = new WebSocketConnection();
  const summary = {
    type: 'summary',
    stoppedAt: '',
    reason: '',
    eventCount: 0,
    commandCounts: {},
    parseErrorCount: 0
  };
  let timer = null;
  let stopping = false;
  let finishCapture;
  const completion = new Promise((resolve) => {
    finishCapture = resolve;
  });

  function writeRecord(record) {
    writer.write(`${JSON.stringify(record)}\n`);
  }

  async function stop(reason) {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    process.off('SIGINT', onSignal);
    summary.stoppedAt = new Date().toISOString();
    summary.reason = reason;
    writeRecord(summary);
    connection.close();
    writer.end();
    await once(writer, 'finish');
    finishCapture();
  }

  function onSignal() {
    stop('interrupted').catch((error) => console.error(`[Capture] shutdown failed: ${error.message}`));
  }

  connection.on('message', (buffer) => {
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
    if (!stopping) stop('connection-closed').catch((error) => console.error(`[Capture] shutdown failed: ${error.message}`));
  });
  connection.on('error', () => {
    console.warn('[Capture] WebSocket reported an error');
  });

  try {
    await connection.connect(`wss://${host.host}:${host.wss_port || 443}/sub`, {
      uid: apiClient.uid || 0,
      roomid: roomInfo.roomId,
      protover: 3,
      platform: 'web',
      type: 2,
      key: danmuInfo.token
    }, { waitForOpen: true });

    writeRecord({
      type: 'meta',
      startedAt: new Date().toISOString(),
      roomId: String(roomInfo.roomId),
      giftOnly: options.giftOnly
    });
    process.once('SIGINT', onSignal);
    timer = setTimeout(() => {
      stop('duration-elapsed').catch((error) => console.error(`[Capture] shutdown failed: ${error.message}`));
    }, options.durationMs);
    await completion;
  } catch (error) {
    connection.close();
    writer.destroy();
    throw error;
  }

  return summary;
}

function printUsage() {
  console.log('Usage: node scripts/capture-bilibili-events.js --room <roomId> [--duration <seconds>] [--output <path>] [--gift-only]');
  console.log('Set BILIBILI_COOKIE when the room requires a logged-in danmaku connection.');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  console.log(`[Capture] room=${options.roomId} duration=${options.durationMs / 1000}s output=${options.outputPath} giftOnly=${options.giftOnly}`);
  const summary = await captureEvents(options);
  console.log(`[Capture] finished reason=${summary.reason} events=${summary.eventCount} output=${options.outputPath}`);
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
  shouldCaptureMessage
};
