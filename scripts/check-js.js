'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const sourceDirs = ['src', 'public', 'scripts', 'test'];
const files = [];

function collectJavaScriptFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(filePath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(filePath);
    }
  }
}

for (const sourceDir of sourceDirs) {
  const directory = path.join(rootDir, sourceDir);
  if (fs.existsSync(directory)) collectJavaScriptFiles(directory);
}

for (const filePath of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
