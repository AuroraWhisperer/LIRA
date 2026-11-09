'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { spec } = require('node:test/reporters');

// This reporter records evidence for diagnosis only, never reusable test proofs.
module.exports = async function* reportResults(source) {
  const files = new Map();
  const failures = [];
  let complete = false;
  async function* collect() {
    for await (const event of source) {
      const { type, data } = event;
      const filename = data.entryFile || data.file;
      const file = filename ? path.relative(process.cwd(), filename).replaceAll('\\', '/') : null;
      if (type === 'test:fail' && !data.todo) {
        failures.push({
          file,
          name: data.name,
          message: data.details?.error?.cause?.message || data.details?.error?.message || '',
          line: data.line ?? null,
        });
      }
      if (type === 'test:summary') {
        if (file) files.set(file, { file, durationMs: data.duration_ms, success: data.success, counts: data.counts });
        else complete = true;
      } else if ((type === 'test:pass' || type === 'test:fail') && file && !data.entryFile && data.nesting === 0) {
        // Empty files and processes that fail before loading node:test have no
        // child summary. The parent reports their completed file execution.
        const success = type === 'test:pass';
        files.set(file, {
          file, durationMs: data.details.duration_ms, success,
          counts: { tests: 1, passed: Number(success), failed: Number(!success), cancelled: 0, skipped: 0, todo: 0 },
        });
      }
      yield event;
    }
  }
  // Consume the events once for both records, with stream backpressure and
  // errors propagated. A log write failure cannot become a successful result.
  await pipeline(collect(), new spec(), fs.createWriteStream(process.env.LIRA_TEST_LOG_PATH));
  yield JSON.stringify({ version: 1, complete, files: [...files.values()], failures });
};
