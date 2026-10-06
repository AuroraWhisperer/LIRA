# 月渡花汀动态壁纸

Status: Completed (2026-10-05)

## Goal and current behavior

在已完成的浅银蓝静态壁纸上增加自然、低干扰的环境动效，保留原有静态版。当前 `background` 独立组件只有 `style: moonlit`；套装和分类共用该素材与输出页面。

## Motion and ownership

动效主线为湖面倒影的微小流动、稀疏涟漪和缓慢薄雾；月亮与灯火轻微呼吸，少量花瓣飘落。建筑、山体和镜头固定，沿用已确认的浅色原图。预算为一条 30fps Canvas 循环，最多 1920×1080 绘制，纹理/遮罩只准备一次；隐藏或减少动态效果时停止。

`background.js` 负责配置和生命周期，新 `background-moonlit.js` 拥有绘制；复用 `opening-moon-fan-art.js` 的云雾/花瓣材质创建函数，不修改已有开播动画。`scene-extra-components.js` 允许 `moonlit-animated` 样式，套装增加清晰标注的动态背景卡片；两种背景共用现有的铺满/置底/保存/发布流程。

无新依赖、业务连接、存储字段、URL 路由、认证或 Electron 生命周期改动。旧 `moonlit` 永久保持静态，默认值不变。仅增加允许的样式枚举，不提交代码。

## Milestones and verification

- [x] 实现可循环、无接缝的环境动效和静态回退；测试循环边界、重复配置只有一条 RAF、隐藏/减少动作/销毁的取消与恢复。
- [x] 分类与套装加入动态选项，验证静态/动态切换、保存/重载/输出、旧静态配置兼容。
- [x] 现场观察动效并录制可播放预览，检查 1920×1080 的节奏、颜色、山体固定和绘制开销；文档更新与差异复核。

Commands: `node --experimental-vm-modules --test test/overlays/background-moonlit.test.js test/scenes/scene-extra-components.test.js test/admin/scene-component-definitions.test.js`；`node --test test/admin/canvas-component-suites.test.js`；`npm run verify:quick`；`git diff --check`。

## Done when / failure handling

静态图保持不变；动态版实际持续播放并可在同一背景参数中切换；停止场景后无残留循环；组件输出和相关检查通过；交付本地预览视频。素材与现有用户改动不被覆盖；必要时对照 `tmp/moonlit-background-motion/before/` 只回退本任务的变更。

## Verification results

- 12 项动效生命周期、场景组件配置/模板与前后端定义契约检查通过；两个真实 Chromium 套装集成测试通过，覆盖静态/动态切换、背景像素实际变化、静态/减少动作像素不变、发布与重载。
- `npm run verify:quick` 通过；Impeccable 对本次 UI 文件的机械检查无报告项。
- 1920×1080 隔离浏览器连续录制约 147 秒，4409 次绘制，约 30.00fps，绘制间隔 P95 34.4ms，RAF 回调耗时 P95 7.9ms，无 pageerror。仅代表本地浏览器检查，不是 OBS/直播姬实播或 GPU 总耗时。
- 完整录像 `tmp/moonlit-background-motion/moonlit-motion-preview.webm`；交付摘录 `moonlit-motion-preview-clip.webm`（28 秒，约 3.2MiB），实际播放器已确认 1920×1080、可解码播放，无媒体错误。
- 浏览器和内存 fixture 已关闭；静态素材文件未修改。已区分并保留同时发生的月底冲刺相关工作区改动。
