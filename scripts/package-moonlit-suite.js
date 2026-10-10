'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { crc32, deflateRawSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { COMPONENT_RESOURCE_PRESETS } = require('../public/js/shared/component-resource-style.js');

const root = path.resolve(__dirname, '..');
const MEMBERS = [
  ['moonlit-background', '静态背景', '/img/component-previews/background-moonlit.webp', { style: 'moonlit' }],
  ['moonlit-background', '动态背景', '/img/component-previews/background-moonlit-animated-hq.webp', { style: 'moonlit-animated' }],
  ['moonlit-opening', '开播动画', '/img/component-previews/opening-moonlit-fan.webp'],
  ['moonlit-clock', '时钟', '/img/component-previews/clock-moonlit-fan.webp'],
  ['moonlit-danmaku', '弹幕姬', '/img/overlays/danmaku-previews/moonlit.png'],
  ['moonlit-wishes', '礼物许愿', '/img/component-previews/gift-wishes-moonlit.webp'],
  ['moonlit-queue', '点歌板', '/img/component-previews/queue-moonlit.webp'],
  ['moonlit-lyrics', '桌面歌词', '/img/component-previews/lyrics-moonlit.webp'],
];

function createMoonlitEntries() {
  const files = new Map();
  const resource = source => {
    const name = `assets${source}`;
    if (!files.has(name)) files.set(name, fs.readFileSync(path.join(root, 'public', source)));
    return name;
  };
  const manifest = { schemaVersion: 2, id: 'lira.moonlit', name: '月渡花汀', version: '1.0.7',
    styles: MEMBERS.map(([key, name, preview, config]) => {
      const preset = COMPONENT_RESOURCE_PRESETS[key];
      return { type: preset.type, name: `月渡花汀 · ${name}`, preset: key, width: preset.size[0], height: preset.size[1],
        config: config || preset.config, preview: resource(preview),
        resources: Object.fromEntries(preset.resources.concat(preset.optionalResources || []).map(source => [source, resource(source)])) };
    }) };
  return new Map([
    ['lira-pack.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['README.txt', Buffer.from(`${manifest.name} ${manifest.version}\n\n需要支持 schemaVersion 2 资源套装的 LIRA 客户端。\n在客户端「点歌 → 浏览器源 → 直播场景」点击「编辑场景」，再到「添加组件 → 套装 → 导入套装」选择本 ZIP，无需解压。\n确认 8 个样式后导入；在画布「添加组件 → 套装」或对应组件中选用，最后「保存并应用」。\n套装包含：静态背景、动态背景、开播动画、时钟、弹幕姬、礼物许愿、点歌板、桌面歌词。\n桌面歌词默认仅显示当前一句，字号保持 48，默认诗笺高度 108px；内置霞鹜文楷 Light（字体参数名：月渡花汀文楷），离线可用；采用月白诗笺、雾蓝手写字、暖金逐字高亮与银蓝花枝，沿用桌面歌词的字体、字号、行高、颜色、翻译、描边、同步与暂停隐藏参数。\n点歌板加入暖色满月、群山、湖面与月光倒影，花仅作岸边点缀；采用 1145×1374 原生透明素材和无损 WebP，歌名与点歌人仍实时渲染。\n开播文案与开关跟随客户端，弹幕、时间、礼物进度与点歌队列继续使用真实数据。\n删除样式只移出素材库，场景中已使用的组件继续可用；删除画布组件不删除素材。\n之前使用默认月渡花汀的场景，导入后请在「添加组件」重新添加弹幕样式，核对布局后移除要替换的旧弹幕图层；其他组件可通过「更换样式」关联本机资源。\n只含素材与声明清单，不含可执行插件。Noto Serif SC 与霞鹜文楷字体许可证见附件。\n`)],
    ['licenses/OFL-NotoSerifSC.txt', fs.readFileSync(path.join(root, 'public/fonts/OFL-NotoSerifSC.txt'))],
    ['licenses/OFL-LXGWWenKai.txt', fs.readFileSync(path.join(root, 'public/fonts/moonlit-wenkai/OFL.txt'))],
    ...files,
  ]);
}

// Standard deterministic ZIP (UTF-8 names, CRC32, DEFLATE); media is already compressed.
function createMoonlitZip() {
  const local = []; const central = []; let offset = 0;
  const entries = createMoonlitEntries();
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name);
    const compressed = deflateRawSync(bytes, { level: 6 });
    const data = compressed.length < bytes.length ? compressed : bytes;
    const method = data === bytes ? 0 : 8;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

if (require.main === module) {
  const destination = path.resolve(root, process.argv[2] || 'tmp/output/月渡花汀-1.0.7.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = createMoonlitZip(); fs.writeFileSync(destination, archive);
  console.log(JSON.stringify({ path: destination, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }, null, 2));
}

module.exports = { createMoonlitEntries, createMoonlitZip };
