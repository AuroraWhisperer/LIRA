'use strict';

const path = require('node:path');
const { fonts } = require('../fonts/catalog.json');

const IMAGE_NAMES = {
  'img/admin/world-clock/earth-day-8k.png': '世界地图-8K',
  'img/overlays/guard-nautical/admiral.webp': '航海旗帜-提督',
  'img/overlays/guard-nautical/captain.webp': '航海旗帜-舰长',
  'img/overlays/guard-nautical/governor.webp': '航海旗帜-总督',
};

function createResourcePackages(files) {
  const remaining = new Map(files.map(file => [file.path, file]));
  const packages = [];
  function add(id, label, members, archive = true) {
    if (!members.length) return;
    packages.push({ id, label, archive, files: members });
    for (const file of members) remaining.delete(file.path);
  }
  for (const font of fonts) {
    add(font.id, font.label, font.bundled.map(file => remaining.get(`fonts/${file.path}`)).filter(Boolean));
  }
  add('lyric-fallbacks', '歌词多语言备用字体', [...remaining.values()].filter(file => file.path.startsWith('fonts/lyrics-fallback/')));
  add('style-fonts', '直播组件专用字体', [...remaining.values()].filter(file => file.path.startsWith('fonts/')));
  for (const file of remaining.values())
    add(file.path, IMAGE_NAMES[file.path] || path.posix.basename(file.path, path.posix.extname(file.path)), [file], false);
  return packages;
}

function packagePath(resource) {
  const extension = resource.archive ? '.zip' : path.posix.extname(resource.files[0].path);
  return `${resource.archive ? 'fonts' : 'images'}/${resource.label}-${resource.sha256.slice(0, 12)}${extension}`;
}

module.exports = { createResourcePackages, packagePath };
