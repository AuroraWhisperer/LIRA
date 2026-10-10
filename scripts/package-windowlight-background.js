'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createStoredStyleZip } = require('./component-style-zip');
const { COMPONENT_RESOURCE_PRESETS, WINDOWLIGHT_ART } = require('../public/js/shared/component-resource-style.js');
const root = path.resolve(__dirname, '..');
const SCENES = { sunny: '晴天', sunset: '黄昏', rainy: '雨天', night: '夜晚' };

function createWindowlightEntries() {
  const preset = COMPONENT_RESOURCE_PRESETS['windowlight-background'];
  const resources = Object.fromEntries(preset.resources.map(source => [source, `assets/${path.posix.basename(source)}`]));
  const manifest = { schemaVersion: 2, id: 'lira.windowlight-background', name: '窗映四时', version: '1.3.0',
    styles: Object.entries(SCENES).map(([windowScene, title]) => ({
      type: preset.type, name: `窗映四时 · ${title}`, preset: 'windowlight-background',
      width: preset.size[0], height: preset.size[1], config: { ...preset.config, windowScene },
      preview: resources[WINDOWLIGHT_ART[windowScene]], resources,
    })) };
  return new Map([
    ['lira-pack.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    ['使用说明.txt', Buffer.from(`窗映四时 · 背景样式 1.3.0

需要支持「窗映四时」的 LIRA 客户端。旧客户端提示更新时，请先更新客户端。
1. 打开 LIRA 画布，在「添加组件 → 背景 → ＋ 添加样式 → 选择文件」选择本 ZIP，无需解压。
2. 核对晴天、黄昏、雨天、夜晚四张卡片并导入，选择一张加入画布。每张卡片默认手动显示对应场景，四景均持续播放动效；同一个背景图层可随时切换四个场景。
3. 在右侧「场景切换」选择手动或定时轮播，两种模式只决定如何切换场景。手动时选择要显示的场景；定时轮播时所选场景作为起点，按晴天 → 黄昏 → 雨天 → 夜晚循环。
4. 轮播间隔默认 300 秒，可设置 10～3600 秒的整数。选择场景和轮播设置后点「保存并应用」。通用滤镜的「恢复样式默认」不改场景或轮播设置。
5. 使用画布提供的完整直播场景来源地址和尺寸，放入 OBS 浏览器源或哔哩哔哩直播姬网页来源。

四张场景底图与投光、虹彩、窗玻璃遮罩和灯光素材分层合成，不包含前景百合。成品素材和动效画布统一为 1920×1080。四景共用从房间左侧斜看右侧窗户的重绘构图，窗框有侧面厚度，窗台与桌沿斜向右下延伸。晴天与黄昏在固定投光范围内呈现局部树影变化和细小折射；夜晚保持台灯亮度稳定，只让照亮区域的反光流动；雨滴折射窗外景物，停留、汇聚后加速下滑，留下逐渐消退的细水痕。页面隐藏时暂停运动和轮播，返回后继续；系统开启减少动态效果时停止特效运动，定时轮播仍有效。
画面以用户确认的四张实际截图为构图依据，结合视频 BV1nEHQ6iEkB 重新创作，并非原作者素材或逐帧相同复刻。参考：https://www.bilibili.com/video/BV1nEHQ6iEkB/
本包只包含清单、使用说明和图片，播放逻辑由客户端提供。导入不改变当前直播画面；删除库卡片不破坏已使用背景。换电脑需要重新导入本 ZIP。
`)],
    ...Object.entries(resources).map(([source, filename]) => [filename, fs.readFileSync(path.join(root, 'public', `.${source}`))]),
  ]);
}

function createWindowlightZip() { return createStoredStyleZip(createWindowlightEntries()); }

if (require.main === module) {
  const destination = path.resolve(root, process.argv[2] || 'tmp/output/窗映四时-背景样式-1.3.0.zip');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const archive = createWindowlightZip(); fs.writeFileSync(destination, archive);
  console.log(JSON.stringify({ path: destination, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }));
}

module.exports = { createWindowlightEntries, createWindowlightZip };
