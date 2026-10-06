# 月渡花汀背景素材

## 静态版

`moonlit.webp`：1920×1080，来源为项目已有过程原画 `tmp/opening-moon-fan/source/landscape-v2.png`，由此前的 LiraHub GPT Image 2.5 流程生成。以用户提供的浅淡壁纸为色彩基准处理为浅银蓝、低对比，制作脚本为 `tmp/moonlit-background/grade.py`。

缩略图：`public/img/component-previews/background-moonlit.webp`，640×360。静态样式 `moonlit` 保持原图。

## 动态版（2026-10-05 分层重制）

`moonlit-loop-hq-60.webm`：2560×1440，VP9，60fps，24 秒／1440 帧，无声循环。用于 `moonlit-animated`，由浏览器视频解码播放；不是把旧图裁切、切条或做位移变形。

动态版缩略图：`public/img/component-previews/background-moonlit-animated-hq.webp`，640×360，来自成片首帧。

新的底景、月亮/灯笼/雾/花瓣图集、六枚柳叶由 LiraHub GPT Image 2.5 Flare 生成，保持浅银蓝工笔水墨、少量淡金、固定机位。AI 生成的是绘画素材，动画由离线合成器制作，并非 AI 直接生成的连续视频：

- 柳枝由 19 条分节枝条和独立柳叶组成，枝梢延迟跟随，叶片分别转动，周期错开。
- 月亮逐渐隐去并重新显现；天空本身为新生成的完整底景，不需补洞。
- 水面逐帧绘制游移的细碎波峰、灯光/月光倒影与扩散波纹，不采样旧图条带。
- 三盏灯笼绕悬挂点摆动，云雾漂移，花瓣翻转飘落。
- 全部动作在 24 秒时与 0 秒画面一致，编码不重复末帧。

制作目录：`tmp/moonlit-background-rebuild/`。其中 `source/prompts.json` 保存完整提示词，`source/` 保存 PNG 原画，`prepare-assets.py` 清理透明素材，`layers/` 保存 WebP 静态绘画部件，`render-scene.js` 是逐帧合成源，`loops/` 保存六层透明 VP9 循环及其位置表，`qa/` 保存检查证据。分层文件用于单项调整，产品播放合成成片，避免同时解码多层。

`background-moonlit.js` 只管理视频的延迟加载、播放、暂停与释放。首次播放前和失败时保留静态图；静态模式与减少动态效果模式不请求视频。隐藏页面暂停，恢复后续播；销毁时释放解码器。页面继续使用原有沙箱组件协议，16:9 显示完整画面，其他比例等比居中裁切。

## 清晰度修正

当前成片匹配用户的 2560×1440 画布。保留原尺寸柳叶与绘画部件的柔和透明边缘，以 3840×2160 合成缓冲高质量缩采样，未压缩 RGBA 帧直接分别编码为 VP9 CRF17 产品背景和 H.264 CRF14 MP4 预览，避免 JPEG 中间帧。源山水画仍为 1672×941，这不是原生 4K 绘画。

制作目录为 `tmp/moonlit-background-hq/`。`moonlit-composite-hq-60.mp4` 是完整合成动画，`preview.html` 提供原片播放、暂停、全屏和下载。`prepare-assets.py`、`render-scene.js` 保留素材处理与抗锯齿合成，`qa/` 保存细节对比。

## 已淘汰资源

2026-10-06 从本目录删除旧 1080p 合成视频 `moonlit-loop-60.webm` 和旧图提取素材 `moonlit-scene.webp`、`moonlit-elements.webp`、`moonlit-willow.webp`，共 22,851,108 字节（约 21.79 MiB）。当前程序、指南预览和新版制作脚本均不依赖这四个文件，后续安装包不再包含它们。

当前保留 `moonlit.webp` 静态背景和 `moonlit-loop-hq-60.webm` 动态成片。新版原画、处理脚本、分层循环及成片另有[制作归档](../../../../archive/moonlit-suite/README.md)；历史调试记录不代表旧资源仍用于产品。
