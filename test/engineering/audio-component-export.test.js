'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { exportAudioComponent } = require('../../scripts/export-audio-component');
const { verifyAudioDirectory, extractAudioComponent } = require('../../src/electron/audio-component-files');

test('audio export is reproducible, independently versioned, and installs exactly its declared production files', async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, '../../tmp/audio-export-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  const descriptor = path.join(root, 'manifest.json');
  for (const name of ['LiraAudioAssistant.exe', 'LiraAudioAssistant.dll', 'LiraAudioAssistant.runtimeconfig.json',
    'coreclr.dll', 'onnxruntime.dll', 'vendor/lira.onnx', 'vendor/rubberband-x64.dll', 'LiraAudioAssistant.pdb']) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await fs.writeFile(path.join(source, name), Buffer.from(name.repeat(100)));
  }
  const first = exportAudioComponent({ source, output, descriptor });
  const second = exportAudioComponent({ source, output, descriptor });
  assert.equal(second.id, first.id);
  assert.equal(second.sha256, first.sha256);
  const manifest = JSON.parse(await fs.readFile(descriptor, 'utf8'));
  assert.equal(manifest.files.some(file => file.path.endsWith('.pdb')), false);
  const installed = path.join(root, 'installed');
  await fs.mkdir(installed);
  await extractAudioComponent(first.filename, manifest, installed, new AbortController().signal);
  assert.equal(await verifyAudioDirectory(installed, manifest, new AbortController().signal), true);
  await fs.writeFile(path.join(source, 'LiraAudioAssistant.dll'), 'changed audio implementation');
  const changed = exportAudioComponent({ source, output, descriptor });
  assert.notEqual(changed.id, first.id);
  assert.deepEqual(await fs.readdir(path.dirname(changed.filename)), [path.basename(changed.filename)]);
});
