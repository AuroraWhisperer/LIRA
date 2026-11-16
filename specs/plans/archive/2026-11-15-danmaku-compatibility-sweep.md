# 内置弹幕旧 Chromium 兼容修复

Status: Completed

开始于 2026-11-15，完成于 2026-11-16。

## 目标与现状

按用户要求修复全部内置弹幕中与圣诞、星尘相同的旧内核问题。已有 Chromium 106.0.5249.0 / 151.0.7922.34 对照记录：47 款中 24 款存在绘制属性差异；除已修复的圣诞与星尘外，包含混色导致底板消失、无前缀遮罩导致装饰变矩形，以及旧回退被透明度声明覆盖。不将用户未知版本的直播姬等同于测试浏览器。

## 归属与边界

样式由 `public/css/overlays/danmaku/` 管理；自定义颜色沿用 `public/js/overlays/danmaku-style-application.js` 和各样式渲染器，颜色解析与预乘 alpha 计算复用 `public/js/shared/color-value.js`。技术参考为 `docs/reference/frontend/overlays.md`，使用说明为 `docs/guides/component-style-parameters.md` 和弹幕工具箱帮助。既有定向测试位于 `test/danmaku/`。

保留现代内核配色、角色/事件色、半透明自定义色、背景透明度、圣诞两种背景及现有文字参数。不得更改服务器接口、保存格式、消息路由、资源交付和用户数据；不提交、打包、发布或操作用户运行中的应用。保留工作区其它任务的修改。

## 实施与验证

- [x] 修复动态与固定颜色：透明混色用 RGB 通道和 alpha，固定混色预计算；在原外观应用及消息渲染时同步用户色，不加入运行时样式扫描、轮询或新依赖。验证默认色、受支持的半透明自定义色、透明度 0/35/100 及恢复默认。
- [x] 补齐遮罩前缀、复合运算、reset 和动画覆盖，保留现代声明；将 RIPPLOID SC 标题的片段遮罩放到 SVG foreignObject，保留原 HTML 文字参数。验证形状、头像、边缘渐隐和实际进入/滚动阶段。
- [x] 修复星迹相对 RGB 高光，以及 Chromium 106 不支持 `<transform-list>` 注册引起的离散动画；按原顺序组合长度、角度和数值分量，保留各款时长、缓动及文字栅格策略。
- [x] 用既有隔离预览服务器和真实新旧 Chromium 对照全部 47 款，覆盖普通聊天、礼物、三档上舰、SC 与相关主题/布局参数。临时证据位于 `tmp/danmaku-chrome-compat-2026-11-15/`，全部自有测试会话已关闭。
- [x] 增加一项半透明颜色与恢复默认的行为回归，复用既有渲染与动态测试；不添加装饰快照或静态源码清单测试。更新技术说明，完成受影响测试、语法、文档和最终差异检查。

用户已明确要求并行子代理：遮罩、固定配色、额外兼容核查分工；主代理处理动态颜色、集成与最终验证。共享文件仅局部编辑。

## 完成条件与失败处理

确认的同类失效均已修复，旧内核绘制与现代目标一致（允许渲染器正常细微差异），参数语义和消息内容保持，相关检查通过且局限明确。仅撤销本任务拥有的具体差异；遇到未证实的问题先用最小复现定位，不通过放宽有效测试掩盖失败。

## 验证结果

- Chromium 106.0.5249.0 / 151.0.7922.34：合并后重载检查 47 款、11 类消息/身份，未发现新增绘制缺失或页面异常。固定、浮动和横向边缘处理共 12 组，以及 Moonlit 横纵揭示、复合遮罩和状态重置通过。
- 参数对照只接受各款支持的字段并显式校验，覆盖 81 组有效颜色参数及 14 组主题组合；另以现代原生 `color-mix()` 为基准独立核对 10 款、1,036 项颜色结果，半透明、透明和恢复默认一致。早期含不支持字段而退回默认的试验不计入有效覆盖。
- 43 段动画、516 个时间点：修复前新旧内核有 342 处实质差异，修复后对齐；现代修复前后仅有浮点序列化误差。12 款按真实布局每 75ms 密集追加聊天、礼物、会员及 SC，消息保留数、末条可读性与收尾状态一致，减少动态效果分支正常。
- RIPPLOID SC 六帧对照，以及两层标题的字体、颜色、30/96px 字号和 420/1000px 视口检查通过；现代结构调整前后没有新增裁切。
- `node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-appearance.test.js`：75/75。
- `node --experimental-vm-modules --test test/danmaku/danmaku-feed-motion.test.js test/danmaku/danmaku-typography-browser.test.js test/danmaku/danmaku-neon-glass-browser.test.js test/danmaku/danmaku-glowy-browser.test.js`：61/61。
- 12 个相关 JavaScript 文件 `node --check`、`npm run verify:docs` 10/10、`git diff --check` 通过；检查最终状态并保留并行任务修改，测试素材与浏览器均留在 `tmp/`，未加入源文件差异。

技术参考更新于 `docs/reference/frontend/overlays.md` 与 `docs/reference/frontend/danmaku-motion.md`。本轮扩展修复不改变参数入口、保存格式和操作步骤，因此沿用已更新的圣诞背景切换指南，不再重复改动用户说明。测试沿用现有套件，仅补半透明混色和恢复默认的功能缺口。

## 范围与限制

Glass 气泡在旧内核中仍按既有设计回退为没有尾尖的圆角卡片，保留底色、边框和内容。横排灵韵的原有 clip-path 收尾栅格差异已与原关键帧对照，旧新内核修复前后相同，未作为本轮旧内核故障改动。用户直播姬的确切内核版本未知，本轮没有替换运行中的客户端或进行该安装版实播；源码已完成，未提交、打包或发布。
