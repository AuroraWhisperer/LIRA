'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createDeflatedZip } = require('./component-style-zip');

const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function exportAudioComponent({ source = path.join(root, 'build/audio-assistant'),
  output = path.join(root, 'tmp/audio-component-export'),
  descriptor = path.join(root, 'src/electron/audio-component-manifest.json') } = {}) {
  const entries = new Map();
  function collect(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error(`Audio component contains a link: ${name}`);
      if (item.isDirectory()) collect(path.join(directory, item.name), `${name}/`);
      else if (item.isFile() && !name.endsWith('.pdb')) entries.set(name, fs.readFileSync(path.join(directory, item.name)));
    }
  }
  collect(source);
  for (const name of ['LiraAudioAssistant.exe', 'LiraAudioAssistant.dll', 'LiraAudioAssistant.runtimeconfig.json',
    'coreclr.dll', 'onnxruntime.dll', 'vendor/lira.onnx', 'vendor/rubberband-x64.dll']) {
    if (!entries.has(name)) throw new Error(`Audio component is incomplete: ${name}`);
  }
  const files = [...entries].map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: digest(bytes) }));
  const id = digest(JSON.stringify(files)).slice(0, 24);
  const bytes = createDeflatedZip(entries);
  const archivePath = `resources/audio/audio-win-x64-${digest(bytes).slice(0, 24)}.zip`;
  const manifest = { schema: 1, id, platform: 'win32', arch: 'x64', entry: 'LiraAudioAssistant.exe',
    archive: { path: archivePath, size: bytes.length, sha256: digest(bytes) }, files };
  const filename = path.join(output, 'upload', archivePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (!fs.existsSync(filename) || digest(fs.readFileSync(filename)) !== manifest.archive.sha256) fs.writeFileSync(filename, bytes);
  for (const name of fs.readdirSync(path.dirname(filename))) {
    if (name !== path.basename(filename) && /^audio-win-x64-[a-f0-9]{24}\.zip$/.test(name))
      fs.unlinkSync(path.join(path.dirname(filename), name));
  }
  fs.mkdirSync(path.dirname(descriptor), { recursive: true });
  fs.writeFileSync(descriptor, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'UPLOAD.md'), `# 音频组件上传\n\n只需上传以下一个文件，保持文件名：\n\n` +
    `- 本机：\`${filename}\`\n- CDN 路径：\`${archivePath}\`\n` +
    `- 大小：${bytes.length} 字节（${(bytes.length / 1048576).toFixed(2)} MiB）\n- SHA-256：\`${manifest.archive.sha256}\`\n\n` +
    `放入现有 CDN 空间的 resources/audio/ 目录。使用 HTTPS，关闭内容转换，可长期缓存；不要覆盖同名文件。\n\n` +
    `客户端已经内置固定版本及摘要，无需上传另一个 manifest 或修改字体图片清单。先上传 ZIP 并验证大小/摘要，再发布包含本次代码的新客户端。\n\n` +
    `6.0.0 已有的完整组件由新安装器保留并复用；首次安装缺少组件时才后台下载。此目录不包含正式新版本安装包，也不修改线上 latest.yml。\n`);
  return { filename, id, bytes: bytes.length, sha256: manifest.archive.sha256, files: files.length };
}

if (require.main === module) console.log(JSON.stringify(exportAudioComponent(), null, 2));
module.exports = { exportAudioComponent };
