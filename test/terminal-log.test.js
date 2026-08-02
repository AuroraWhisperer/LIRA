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
  let restore;

  try {
    fs.writeFileSync(filePath, 'old session\n', 'utf8');
    restore = installTerminalLog(filePath);
    console.log('hello %s', 'world');
    console.info({ ready: true });
    console.debug('debug line');
    console.warn('warning line');

    assert.equal(
      fs.readFileSync(filePath, 'utf8'),
      'hello world\n{ ready: true }\ndebug line\n'
    );
  } finally {
    restore?.();
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.warn = originalWarn;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
