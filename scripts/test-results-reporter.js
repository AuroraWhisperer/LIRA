'use strict';

const path = require('node:path');

// This reporter records evidence for diagnosis only, never reusable test proofs.
module.exports = async function* reportResults(source) {
  const files = [];
  const failures = [];
  let complete = false;
  for await (const { type, data } of source) {
    const filename = data.entryFile || data.file;
    const file = filename ? path.relative(process.cwd(), filename).replaceAll('\\', '/') : null;
    if (type === 'test:fail') {
      failures.push({
        file,
        name: data.name,
        message: data.details?.error?.cause?.message || data.details?.error?.message || '',
        line: data.line ?? null,
      });
    } else if (type === 'test:summary') {
      if (file) files.push({ file, durationMs: data.duration_ms, success: data.success, counts: data.counts });
      else complete = true;
    }
  }
  yield JSON.stringify({ version: 1, complete, files, failures });
};
