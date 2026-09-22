'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

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

async function main() {
  files.sort();
  let nextFile = 0;
  let exitCode = 0;
  async function worker() {
    while (exitCode === 0 && nextFile < files.length) {
      const filePath = files[nextFile++];
      try {
        const child = spawn(process.execPath, ['--check', filePath], {
          stdio: 'inherit',
          windowsHide: true,
        });
        const [status] = await once(child, 'close');
        if (status !== 0) exitCode ||= status || 1;
      } catch (error) {
        console.error(`Unable to check ${filePath}: ${error.message}`);
        exitCode ||= 1;
      }
    }
  }

  const concurrency = Math.min(4, os.availableParallelism(), files.length);
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.exitCode = exitCode;
  if (exitCode === 0) console.log(`Syntax check passed for ${files.length} JavaScript files.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
