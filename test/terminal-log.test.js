'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installTerminalLog } = require('../src/electron/terminal-log');

test('resets the terminal log and mirrors ordinary console output', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'song-plugin-terminal-log-'));
  const filePath = path.join(directory, 'terminal.log');
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const originalError = console.error;
  let restore;

  try {
    fs.writeFileSync(filePath, 'old session\n', 'utf8');
    restore = installTerminalLog(filePath, {
      runId: 'run-test',
      pid: 1234,
      processType: 'browser',
      now: () => '2026-08-03T15:07:34.288Z',
      nextSequence: (() => {
        let sequence = 0;
        return () => {
          sequence += 1;
          return sequence;
        };
      })()
    });
    console.log('hello %s', 'world');
    console.info({ ready: true });
    console.debug('debug line');
    console.warn('warning line');
    console.error('error line');

    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      '[2026-08-03T15:07:34.288Z] [run=run-test seq=1 pid=1234 type=browser] [terminal:log] hello world\n'
      + '[2026-08-03T15:07:34.288Z] [run=run-test seq=2 pid=1234 type=browser] [terminal:info] { ready: true }\n'
      + '[2026-08-03T15:07:34.288Z] [run=run-test seq=3 pid=1234 type=browser] [terminal:debug] debug line\n'
      + '[2026-08-03T15:07:34.288Z] [run=run-test seq=4 pid=1234 type=browser] [terminal:warn] warning line\n'
      + '[2026-08-03T15:07:34.288Z] [run=run-test seq=5 pid=1234 type=browser] [terminal:error] error line\n'
    );
  } finally {
    restore?.();
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.warn = originalWarn;
    console.error = originalError;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
