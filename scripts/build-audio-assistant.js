'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const vendor = path.resolve(process.argv[2] || path.join(root, 'tmp/audio-assistant-demo/vendor'));
const output = path.join(root, 'build/audio-assistant');
const scratch = path.join(root, 'tmp/audio-assistant-build');
const assets = ['qq-split.onnx', 'rubberband-x64.dll',
  'EarTrumpet-LICENSE.txt', 'NAudio-LICENSE.txt', 'ONNXRuntime-LICENSE.txt',
  'ONNXRuntime-ThirdPartyNotices.txt', 'RubberBand-LICENSE.txt'];
for (const name of assets) {
  if (!fs.existsSync(path.join(vendor, name))) throw new Error(`缺少本机音频资源：${path.join(vendor, name)}`);
}
const project = path.join(root, 'native/audio-assistant/AudioAssistant.csproj');
const restore = spawnSync('dotnet', ['restore', project, '-r', 'win-x64', '--locked-mode',
  `-p:BaseIntermediateOutputPath=${path.join(scratch, 'obj')}${path.sep}`,
  `-p:BaseOutputPath=${path.join(scratch, 'bin')}${path.sep}`], { stdio: 'inherit', windowsHide: true });
if (restore.error) throw restore.error;
if (restore.status !== 0) process.exit(restore.status || 1);
const result = spawnSync('dotnet', ['publish', project,
  '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--no-restore', '-o', output,
  `-p:BaseIntermediateOutputPath=${path.join(scratch, 'obj')}${path.sep}`,
  `-p:BaseOutputPath=${path.join(scratch, 'bin')}${path.sep}`], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
for (const name of assets) {
  const outputName = name === 'qq-split.onnx' ? 'lira.onnx' : name;
  fs.copyFileSync(path.join(vendor, name), path.join(output, 'vendor', outputName));
}
// Remove obsolete build copies; original development records stay with the input assets.
for (const name of ['qq-split.onnx', 'qq-model.json', 'rubberband.json']) {
  fs.rmSync(path.join(output, 'vendor', name), { force: true });
}
console.log('电音助手已构建；客户端复用自带 Node，音频资源位于 build/audio-assistant。');
