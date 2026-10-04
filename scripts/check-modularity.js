'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOTS = ['src', 'public', 'scripts', 'tools', 'test', 'build'];
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.ps1', '.cmd', '.bat', '.nsh']);

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

function reviewSignal(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.json') return null;
  if (extension === '.css') return { kind: 'stylesheet', reviewAfter: 800 };
  if (extension === '.html') return { kind: 'markup', reviewAfter: 800 };
  if (file.startsWith('test/')) return { kind: 'test', reviewAfter: 800 };
  return { kind: 'source', reviewAfter: 600 };
}

function checkModularity(rootDir) {
  const files = collectSourceFiles(rootDir);
  const assessments = [];
  for (const file of files) {
    const lines = countPhysicalLines(fs.readFileSync(path.join(rootDir, file), 'utf8'));
    const signal = reviewSignal(file);
    if (signal && lines > signal.reviewAfter) {
      assessments.push({ path: file, lines, ...signal });
    }
  }
  return { files, assessments };
}

function main() {
  const result = checkModularity(path.resolve(__dirname, '..'));
  for (const { path: file, lines, kind, reviewAfter } of result.assessments) {
    console.log(`${file}: ${lines} lines (${kind}; review signal above ${reviewAfter}).`);
  }
  console.log(`Modularity review: ${result.files.length} files, ${result.assessments.length} advisory findings.`);
  console.log(
    'Review affected files by responsibility and purpose; line counts alone do not require splitting or fail this report.',
  );
}

if (require.main === module) main();

module.exports = { checkModularity, collectSourceFiles, countPhysicalLines };
