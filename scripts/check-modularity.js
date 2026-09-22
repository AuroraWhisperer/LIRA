'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOTS = ['src', 'public', 'scripts', 'tools', 'test', 'build'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.ps1', '.cmd', '.bat', '.nsh']);
const BASELINE_PATH = 'docs/architecture/engineering/modularity-baseline.json';

function countPhysicalLines(source) {
  if (source.length === 0) return 0;
  return source.split(/\r\n|\r|\n/).length - Number(/[\r\n]$/.test(source));
}

function collectSourceFiles(rootDir) {
  const files = [];
  function visit(relativeDirectory) {
    const directory = path.join(rootDir, relativeDirectory);
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(relativePath);
      }
    }
  }
  for (const directory of SOURCE_ROOTS) visit(directory);
  return files.sort();
}

function isRepositoryPath(value) {
  return (
    typeof value === 'string' &&
    /^(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(value) &&
    value.split('/').every((part) => part !== '.' && part !== '..')
  );
}

function isReviewDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function validateRecord(record, sourceFiles, rootDir, today) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['registry entry must be an object'];
  }
  const label = record.path || '<missing path>';
  if (!isRepositoryPath(record.path) || !sourceFiles.has(record.path)) {
    errors.push(`${label}: registry path must name one existing scanned source file`);
  }
  if (!['review', 'legacy', 'exception'].includes(record.kind)) {
    errors.push(`${label}: kind must be review, legacy or exception`);
  }
  if (!Number.isInteger(record.maxLines) || record.maxLines <= 600) {
    errors.push(`${label}: maxLines must be an integer greater than 600`);
  }
  if (record.kind === 'review' && record.maxLines > 800) {
    errors.push(`${label}: an ordinary review cannot permit more than 800 lines`);
  }
  if (record.kind === 'legacy' && record.maxLines <= 800) {
    errors.push(`${label}: legacy overflow must be above 800 lines`);
  }
  for (const field of ['owner', 'reason', 'removal']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      errors.push(`${label}: ${field} must explain the file-specific assessment`);
    }
  }
  if (!isReviewDate(record.reviewBy) || record.reviewBy < today) {
    errors.push(`${label}: reviewBy is invalid or expired; review the debt before renewing`);
  }
  if (
    !isRepositoryPath(record.test) ||
    !record.test.startsWith('test/') ||
    !sourceFiles.has(record.test) ||
    !fs.statSync(path.join(rootDir, record.test)).isFile()
  ) {
    errors.push(`${label}: test must name an existing protection test`);
  }
  return errors;
}

function checkModularity(rootDir, registry, today = new Date().toISOString().slice(0, 10)) {
  const files = collectSourceFiles(rootDir);
  const sourceFiles = new Set(files);
  const errors = [];
  const assessments = [];
  if (registry?.version !== 1 || !Array.isArray(registry.entries)) {
    return {
      files,
      assessments,
      errors: ['registry must have version 1 and an entries array'],
    };
  }
  const records = new Map();
  for (const record of registry.entries) {
    errors.push(...validateRecord(record, sourceFiles, rootDir, today));
    if (!record || typeof record.path !== 'string') continue;
    if (records.has(record.path)) errors.push(`${record.path}: duplicate registry entry`);
    records.set(record.path, record);
  }
  for (const file of files) {
    const lines = countPhysicalLines(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    const record = records.get(file);
    if (lines <= 600) {
      if (record) errors.push(`${file}: now ${lines} lines; remove the obsolete file-size record`);
      continue;
    }
    if (!record) {
      errors.push(
        `${file}: ${lines} lines; ${lines > 800 ? 'exceeds the 800-line ceiling' : '601–800 lines require a file-specific review'}`,
      );
    } else if (lines > record.maxLines) {
      errors.push(
        `${file}: ${lines} lines exceeds reviewed ceiling ${record.maxLines}; split responsibilities and review the change before updating any record`,
      );
    }
    assessments.push({ path: file, lines, kind: record?.kind || 'unreviewed' });
  }
  return { files, assessments, errors };
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const registry = JSON.parse(fs.readFileSync(path.join(rootDir, BASELINE_PATH), 'utf8'));
  const result = checkModularity(rootDir, registry);
  for (const error of result.errors) console.error(error);
  console.log(
    `Modularity: ${result.files.length} files, ${result.assessments.length} reviewed-size files, ${result.errors.length} errors.`,
  );
  process.exitCode = result.errors.length ? 1 : 0;
}

if (require.main === module) main();

module.exports = {
  BASELINE_PATH,
  checkModularity,
  collectSourceFiles,
  countPhysicalLines,
};
