'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createStoredStyleZip } = require('./component-style-zip');
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
    ['使用说明.txt', Buffer.from(`${manifest.name} ${manifest.version}\n\n这是大航海感谢组件的一款样式，三档动画属于同一款样式。需要包含「航海旗帜」播放器的 LIRA 客户端；旧版提示更新时，必须先更新客户端，不能只改包名。\n1. 组件 → 礼物姬 → 大航海感谢 → 更多样式 → ＋ 添加样式 → 选择文件，直接选择本 ZIP，无需解压。\n2. 确认添加后点击航海旗帜样式卡片，打开「启用航海旗帜」独立开关，等待显示「已启用」。可调整头像、昵称显示和昵称字号，点击「保存设置」同步到该样式已有的画布组件。\n3. 点击「在画布中使用」，摆放后「保存并应用」。已有大航海感谢图层可通过「更换样式 / 添加素材」选择本样式。航海旗帜独立启用，无需同时启用辉光/经典；同一笔上舰只播放一次航海旗帜动画。旧配置未保存独立开关时兼容原有启用状态，第一次调整后独立生效。\n4. 保持礼物监控连接、LIRA 运行；将已应用的场景或组件直播源放入 OBS 或哔哩哔哩直播姬。\n舰长为蓝色、提督为紫色、总督为红色；头像和昵称实时取自上舰观众，缺少头像时显示 B 站默认头像。每次约 5 秒，无背景色。旗帜中文固定在素材中，不提供语言切换。\n导入只增加可选样式，不会自动修改你的直播场景。素材来源与作者信息见素材来源.txt、provenance.txt。\n`)],
    ['素材来源.txt', Buffer.from(fs.readFileSync(path.join(artwork, 'README.md'), 'utf8').replace('provenance.json', 'provenance.txt'))],
    ['provenance.txt', fs.readFileSync(path.join(artwork, 'provenance.json'))],
    ...['preview.webp', ...Object.values(resources).map(source => path.basename(source))]
      .map(name => [`assets/${name}`, fs.readFileSync(path.join(artwork, name))]),
  ]);
}

// Stored ZIP: animated WebP files are already compressed. UTF-8 names, fixed DOS date.
function createNauticalGuardZip() {
  return createStoredStyleZip(createNauticalGuardEntries());
}

if (require.main === module) {
  const destination = path.resolve(root, process.argv[2] || 'tmp/output/航海旗帜-大航海感谢样式-1.0.1.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = createNauticalGuardZip(); fs.writeFileSync(destination, archive);
  console.log(JSON.stringify({ path: destination, bytes: archive.length }));
}

module.exports = { createNauticalGuardEntries, createNauticalGuardZip };
