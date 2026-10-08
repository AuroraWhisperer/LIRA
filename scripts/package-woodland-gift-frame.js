'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createStoredStyleZip } = require('./component-style-zip');
const { COMPONENT_RESOURCE_PRESETS, WOODLAND_GIFT_VIDEO } = require('../public/js/shared/component-resource-style.js');
const root = path.resolve(__dirname, '..');

function createWoodlandGiftEntries() {
  const preset = COMPONENT_RESOURCE_PRESETS['woodland-gift-frame'];
  const manifest = { schemaVersion: 2, id: 'lira.woodland-gift-frame', name: '林间花信', version: '1.0.0',
    styles: [{ type: preset.type, name: '林间花信', preset: 'woodland-gift-frame',
      width: preset.size[0], height: preset.size[1], config: preset.config, preview: 'assets/preview.webp',
      resources: { [WOODLAND_GIFT_VIDEO]: 'assets/woodland-bloom-v4.webm' } }] };
  return new Map([
    ['lira-pack.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['使用说明.txt', Buffer.from(`林间花信 · 全屏礼物感谢 1.0.0

需要支持「woodland-gift-frame」资源预设的 LIRA 客户端。旧客户端提示更新时，请先更新客户端。
1. 百宝箱 → 礼物姬 → 全屏礼物感谢 → 更多样式 → ＋ 添加样式 → 选择文件，选择本 ZIP，无需解压。
2. 导入后沿用本页的启用开关、触发金额（默认 20 元）及观众、礼物、数量模拟预览。导入不会修改已保存的开关或金额。
3. 点击「林间花信」样式卡片添加到画布，再「保存并应用」。已有图层可用「更换样式 / 添加素材」，位置和尺寸保持不变。之前使用内置林间花信的画布在本机导入后可继续播放。
4. 保持礼物监控连接、LIRA 运行，将场景直播源放入 OBS 或哔哩哔哩直播姬。

素材为原始 2560×1440、30fps、8 秒透明视频，未转码。客户端继续按 1920×1080 逻辑画布绘制，头像为 96px，感谢行默认 38px、长文字最小 26px。头像与礼物数量使用实时数据，位置、入退场时序和逐条播放队列与原内置效果一致。
本包仅包含成片、缩略图和清单；播放逻辑由客户端提供。删除可选样式不会删除已有画布引用的素材；换电脑需要重新导入本 ZIP。
`)],
    ['assets/preview.webp', fs.readFileSync(path.join(root, 'public/img/component-previews/gift-frame-default.webp'))],
    ['assets/woodland-bloom-v4.webm', fs.readFileSync(path.join(root, 'public', `.${WOODLAND_GIFT_VIDEO}`))],
  ]);
}

function createWoodlandGiftZip() { return createStoredStyleZip(createWoodlandGiftEntries()); }

if (require.main === module) {
  const destination = path.resolve(root, process.argv[2] || 'output/林间花信-全屏礼物感谢样式-1.0.0.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = createWoodlandGiftZip(); fs.writeFileSync(destination, archive);
  console.log(JSON.stringify({ path: destination, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }));
}

module.exports = { createWoodlandGiftEntries, createWoodlandGiftZip };
