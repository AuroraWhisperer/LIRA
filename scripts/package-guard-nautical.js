'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { COMPONENT_RESOURCE_PRESETS } = require('../public/js/shared/component-resource-style.js');
const root = path.resolve(__dirname, '..');
const artwork = path.join(root, 'public/img/overlays/guard-nautical');

function createNauticalGuardEntries() {
  const preset = COMPONENT_RESOURCE_PRESETS['nautical-guard-thanks'];
  const resources = Object.fromEntries(preset.resources.map(source => [source, `assets/${path.basename(source)}`]));
  const manifest = { schemaVersion: 2, id: 'lira.nautical-guard-thanks', name: '航海旗帜 · 上舰感谢', version: '1.0.1',
    styles: [{ type: preset.type, name: '航海旗帜 · 上舰感谢', preset: 'nautical-guard-thanks',
      width: 1920, height: 1080, config: preset.config, preview: 'assets/preview.webp', resources }] };
  return new Map([
    ['lira-pack.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['使用说明.txt', Buffer.from('航海旗帜 · 上舰感谢 1.0.1\n\n这是大航海感谢组件的一款样式，三档动画属于同一款样式。需要包含「航海旗帜」播放器的 LIRA 客户端；旧版提示更新时，必须先更新客户端，不能只改包名。\n1. 百宝箱 → 礼物姬 → 大航海感谢 → 更多样式 → ＋ 添加样式 → 选择 LIRA 样式包（ZIP），直接选择本 ZIP，无需解压。\n2. 确认添加后点击「航海旗帜 · 上舰感谢」卡片，在画布里摆放并「保存并应用」。已有大航海感谢图层可通过「更换样式 / 添加素材」选择本样式，避免增加重复图层。\n3. 上舰触发沿用页面上方辉光/经典的启用设置：至少启用一款并保存。画布使用本样式时播放航海旗帜；两款都启用也只对同一笔上舰播放一次。\n4. 保持礼物监控连接、LIRA 运行；将已应用的场景或组件直播源放入 OBS 或哔哩哔哩直播姬。\n舰长为蓝色、提督为紫色、总督为红色；头像和昵称实时取自上舰观众，缺少头像时显示 B 站默认头像。每次约 5 秒，无背景色。旗帜文字为素材原有中文，不受中文/English 切换影响。\n导入只增加可选样式，不会自动修改你的直播场景。素材来源与作者信息见素材来源.txt、provenance.txt。\n')],
    ['素材来源.txt', Buffer.from(fs.readFileSync(path.join(artwork, 'README.md'), 'utf8').replace('provenance.json', 'provenance.txt'))],
    ['provenance.txt', fs.readFileSync(path.join(artwork, 'provenance.json'))],
    ...['preview.webp', ...Object.values(resources).map(source => path.basename(source))]
      .map(name => [`assets/${name}`, fs.readFileSync(path.join(artwork, name))]),
  ]);
}

// Stored ZIP: animated WebP files are already compressed. UTF-8 names, fixed DOS date.
function createNauticalGuardZip() {
  const entries = createNauticalGuardEntries();
  const local = []; const central = []; let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, bytes); central.push(directory, filename); offset += header.length + filename.length + bytes.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

if (require.main === module) {
  const destination = path.resolve(root, process.argv[2] || 'output/航海旗帜-大航海感谢样式-1.0.1.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = createNauticalGuardZip(); fs.writeFileSync(destination, archive);
  console.log(JSON.stringify({ path: destination, bytes: archive.length }));
}

module.exports = { createNauticalGuardEntries, createNauticalGuardZip };
