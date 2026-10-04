'use strict';

const path = require('node:path');

function successfulFiles(root, report, requested, code) {
  const relative = (file) => typeof file === 'string'
    ? path.relative(root, path.resolve(root, file)).replaceAll('\\', '/') : null;
  const wanted = new Set(requested);
  const countNames = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
  const validCounts = (counts) => counts && countNames.every((name) => Number.isInteger(counts[name]) && counts[name] >= 0)
    && counts.tests === counts.passed + counts.failed + counts.cancelled + counts.skipped + counts.todo;
  if (report?.version !== 1 || !Array.isArray(report.files) || !Array.isArray(report.failures)
      || !Array.isArray(report.warnings) || report.warnings.length || !validCounts(report.summary?.counts)) return [];
  if (report.failures.some((entry) => !wanted.has(relative(entry.file)))) return [];
  const failed = new Set(report.failures.map((entry) => relative(entry.file)));
  const complete = new Map();
  for (const entry of report.files) {
    const file = relative(entry.file);
    if (!wanted.has(file) || complete.has(file) || !validCounts(entry.counts)) return [];
    complete.set(file, entry);
  }
  if (complete.size !== wanted.size || countNames.some((name) =>
    [...complete.values()].reduce((total, entry) => total + entry.counts[name], 0) !== report.summary.counts[name])) return [];
  if ((code !== 0 || report.summary.success !== true) && !failed.size) return [];
  if (code === 0 && report.summary.success !== true) return [];
  return [...complete].filter(([file, entry]) => entry.success === true && !failed.has(file)
    && entry.counts.tests > 0 && entry.counts.tests === entry.counts.passed
    && Number.isFinite(entry.duration_ms) && entry.duration_ms >= 0)
    .map(([file, entry]) => ({ file, durationMs: entry.duration_ms }));
}

module.exports = { successfulFiles };
