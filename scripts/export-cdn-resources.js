'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createStoredStyleZip } = require('./component-style-zip');
const { createResourcePackages, packagePath } = require('../src/resources/resource-packages');

const root = path.resolve(__dirname, '..');
const BUNDLED_TITLE_FONTS = new Set(['fonts/clock-moon-serif-400.woff2', 'fonts/guard-thanks-serif-400.woff2']);
const IMAGE_LABELS = {
  'img/admin/world-clock/earth-day-8k.png': '世界地图高清底图',
  'img/overlays/guard-nautical/admiral.webp': '航海旗帜 · 提督',
  'img/overlays/guard-nautical/captain.webp': '航海旗帜 · 舰长',
  'img/overlays/guard-nautical/governor.webp': '航海旗帜 · 总督',
};

function collectCdnResources(publicDir) {
  const files = [];
  for (const group of ['fonts', 'img']) {
    for (const entry of fs.readdirSync(path.join(publicDir, group), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const filename = path.join(entry.parentPath, entry.name);
      const name = path.relative(publicDir, filename).replaceAll('\\', '/');
      if (BUNDLED_TITLE_FONTS.has(name)) continue;
      const stat = fs.statSync(filename);
      if (group === 'fonts' ? !/\.(woff2|ttf|otf)$/i.test(name)
        : !/\.(png|webp|jpe?g|gif|avif)$/i.test(name) || stat.size <= 10 * 1024 * 1024) continue;
      const sha256 = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      files.push({ path: name, size: stat.size, sha256,
        label: IMAGE_LABELS[name] || `字体 · ${path.basename(name)}` });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

function exportCdnResources({ rootDir = root, outputDir = path.join(rootDir, 'tmp/cdn-resources'), writeCatalog = false } = {}) {
  const publicDir = path.join(rootDir, 'public');
  const files = collectCdnResources(publicDir);
  const entries = new Map();
  const packages = [];
  for (const resource of createResourcePackages(files)) {
    const members = new Map(resource.files.map(file => [file.path, fs.readFileSync(path.join(publicDir, file.path))]));
    const bytes = resource.archive ? createStoredStyleZip(members) : members.values().next().value;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    packages.push({ id: resource.id, size: bytes.length, sha256, files: resource.files.map(file => file.path) });
    entries.set(`resources/${packagePath({ ...resource, sha256 })}`, bytes);
  }
  const manifest = Buffer.from(`${JSON.stringify({ version: 2, files, packages }, null, 2)}\n`);
  entries.set('resources/manifest.json', manifest);
  const uploadDirectory = path.resolve(outputDir, 'upload');
  // This directory is generated staging; source assets and application notices are elsewhere.
  fs.rmSync(uploadDirectory, { recursive: true, force: true });
  for (const [name, bytes] of entries) {
    const filename = path.join(uploadDirectory, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
  const archivePath = path.join(outputDir, 'lira-cdn-resources.zip');
  fs.writeFileSync(archivePath, createStoredStyleZip(entries));
  const instructions = '将 upload 里的 resources 文件夹直接拖到多吉云 lirahub 空间根目录上传，保留目录结构。\nfonts 是具名字体下载包，images 是具名图片，manifest.json 是自动更新清单。\n字体包由软件自动下载、校验并解包，无需手动解压每个字体包。\n首次上传可一次上传整个文件夹；后续更新先上传变化的字体包或图片，最后替换 manifest.json。\nmanifest.json 使用不缓存规则；文件名末尾的短版本号用于区分更新，保留旧版本文件。\n更新资源后重新运行 npm run export:resources。\n';
  fs.writeFileSync(path.join(outputDir, '上传说明.txt'), instructions);
  if (writeCatalog) fs.writeFileSync(path.join(rootDir, 'src/resources/catalog.json'), manifest);
  return { fonts: files.filter(file => file.path.startsWith('fonts/')).length,
    images: files.filter(file => file.path.startsWith('img/')).length, downloads: packages.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0), uploadDirectory, archivePath,
    manifestPath: path.join(uploadDirectory, 'resources/manifest.json') };
}

if (require.main === module) console.log(JSON.stringify(exportCdnResources({
  outputDir: process.argv[2] ? path.resolve(process.argv[2]) : undefined, writeCatalog: true,
}), null, 2));

module.exports = { collectCdnResources, exportCdnResources };
