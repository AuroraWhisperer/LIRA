'use strict';

const path = require('node:path');
const { inspect } = require('node:util');

// Full stdout/stderr and spec output are saved by the runner's other reporter.
module.exports = async function* reportProgress(source) {
  const started = performance.now();
  let lastProgress = started;
  let files = 0;
  let passed = 0;
  let failed = 0;
  const stderr = new Map();
  for await (const { type, data } of source) {
    const filename = data.entryFile || data.file;
    const file = filename ? path.relative(process.cwd(), filename).replaceAll('\\', '/') : '(unknown file)';
    if (type === 'test:stderr') {
      stderr.set(file, ((stderr.get(file) || '') + data.message).slice(-8192));
    } else if (type === 'test:fail' && !data.todo) {
      const location = data.file ? path.relative(process.cwd(), data.file).replaceAll('\\', '/') : file;
      yield `[test] FAIL ${location}:${data.line ?? '?'} ${data.name}\n${stderr.get(file) || ''}${inspect(data.details?.error, { colors: false, depth: 5 })}\n`;
      stderr.delete(file);
    } else if (type === 'test:summary' && (data.entryFile || data.file)) {
      files += 1;
      passed += data.counts.passed;
      failed += data.counts.failed;
      stderr.delete(file);
    }
    const now = performance.now();
    if (now - lastProgress >= 10000) {
      yield `[test] Progress: ${files} files; ${passed} passed; ${failed} failed; ${((now - started) / 1000).toFixed(0)}s\n`;
      lastProgress = now;
    }
  }
};
