# 大播放器外观设置

Status: Completed

目标是在「播放 → 播放器外观」调整大播放器，并在本机保留偏好。

## 决策与边界

- 沿用现有播放页与全屏播放器；默认保持当前唱片机、主题背景和文字样式。
- 外观模块拥有规范化、localStorage `playbackAppearance:v1`、控件与静态示例预览。只存白名单枚举、范围内数字、布尔值和十六进制颜色；读取损坏数据回退默认，写入失败明确提示未保存。
- 提供唱片机 / 黑胶 / 封面、图像尺寸与旋转、背景模式和颜色、字体、对齐及歌名/歌手/歌词字号和颜色。实时作用于同一个播放器，预览复用其 DOM/CSS，不创建第二个播放或歌词运行时。
- 不改变音源、队列、音频、桌面歌词、HTTP/IPC、数据库或 Electron 安全边界。保留工作区已有未提交修改；不提交或发布。
- 用户补充确认现有唱片机为默认，允许搜索并复用其他公开样式。黑胶改为 Grason Chan 的 MIT Turntable（Spicetify 公开源码，固定版本），保留原配比、反光和转速，仅适配本地 DOM；保留许可与来源，不运行上游脚本。

## 归属与实施

- [x] 在 `public/js/playback/ui/appearance.js` 实现设置与预览，由 `fullscreen.js` 初始化；`forms.js` 复用现有播放器展开逻辑。
- [x] 在 `public/pages/admin/playback/page.html` 添加页内分类和外观子片段；`public/css/playback/` 拥有布局与外观样式。
- [x] 扩展 `test/playback/` 对默认兼容、无效保存数据、读取/写入失败和样式清除的覆盖；运行现有全屏、页面组合及布局相关测试。
- [x] 更新 `docs/reference/frontend/playback.md`、页面清单、存储引用和应用内播放指南；新手引导先选择「音乐播放」以确保平台入口可见。

## 验收

1. 相关 node:test、语法检查、`npm run verify:docs`、`git diff --check` 通过。
2. 隔离 Electron（独立数据及会话目录、随机端口、真实 preload/本地认证）检查两个分类、三种样式、背景/文字/尺寸控件、即时预览、实际播放器、重载恢复、恢复默认。
3. 检查极值文字和受损本地偏好；视觉检查默认与自定义状态。临时脚本与截图仅置于 `tmp/`，关闭自有实例。
4. 审查最终 diff/status，确认未覆盖已有用户修改且无运行数据入库。未完成验证如实记录。

失败时只反向撤销本任务 diff；默认值不覆盖已有偏好，恢复默认仅作用于本模块的本地键。

## 完成证据（2026-10-11）

- 相关 54 项测试通过：`node --experimental-vm-modules --test test/playback/player-appearance.test.js test/playback/frontend-playback.test.js test/admin/frontend-admin-layout.test.js test/admin/admin-page-composition.test.js test/admin/frontend-usage-guide.test.js test/admin/frontend-interactive-tour.test.js`。
- 隔离 Electron 使用真实 preload、请求认证及本地 runtime；匿名 `/admin` 为 401，授权请求为 200。验证样式切换、背景三种模式与透明度、字体/对齐/字号/颜色、滑块同步、打开/收起、键盘分类切换、跨进程重启恢复、无效数字回退、损坏 JSON 和存储写入失败提示。未使用真实账号或音源；播放与歌词行为依赖原链及既有聚焦测试。
- 外观检测器针对变更 UI 返回空问题列表。截图和自有夹具位于根 `tmp/player-appearance-qa/`，不进入提交；没有修改安全、IPC 或服务端持久合同。
- 当前合同与使用说明已同步。核心默认/重载/失败语义由新增测试覆盖，原有全屏与导航测试保留。
