# 歌词宽度与排版调整

Status: Completed

## 目标与现状

直播姬浏览器源设为 1800px 时，基础歌词仍被共享时间轴的 980px 上限提前换行。管理页只把字号乘 0.65，未模拟输出尺寸。翻译字号比例、换行行高已有设置；句间距没有独立设置。

## 边界与兼容

实际输出继续按浏览器源或画布图层自身宽高排版；去掉固定宽度上限，不覆盖已有图层尺寸。预览宽高仅为本机模拟尺寸，不新增输出尺寸契约。新增 `desktopLyricLineGap` 为本地外观，沿既有设置默认补齐、校验与场景共享路径保存，不加入云设置。翻译/罗马音继续共用原字号比例，旧键与旧值保持可读。不涉及播放器、歌词时钟、认证或 Electron 主进程。

## 所有者与同步

- 共享排版：`public/css/lyrics/desktop-lyric.css`、`public/js/lyrics/desktop-lyric-{defaults,settings,styles}.js`。
- 参数与本地保存：`public/js/shared/scene-extra-components.js`、`src/storage/settings-defaults.js`、歌词 Admin 控件及分组；输出字段投影沿 `src/server/overlay-projection.js`。
- 预览：`public/js/admin/desktop-lyric-preview.js`、对应预览片段与 CSS，复用同一渲染器，不复制歌词运行时。
- 文档：`docs/reference/frontend/overlays.md`、`docs/reference/backend/storage.md`、内置配置指南。导航教程不描述具体参数，保持不变。

## 实施与验收

- [x] 移除 980px 上限；扩展现有布局测试，确认 1800px 比窄输出容纳更多文字。
- [x] 增加句间距，明确换行行距与副歌词字号，集中到首个排版组；用现有设置/布局测试确认独立生效及本地保存。
- [x] 预览按可调逻辑宽高整体等比缩放；相同逻辑尺寸下预览与输出换行一致，保留滚动跟随。
- [x] 同步参考与指南；运行受影响歌词测试、必要的设置/投影检查、`npm run verify:docs`，检查最终 diff、`git diff --check` 与状态。

## 验证记录

- `node --test test/lyrics/desktop-lyric-layout-browser.test.js`：10/10，通过实际文本高度验证宽度上限回归、相同逻辑尺寸的预览/输出换行、句间距与换行行距独立生效。
- 歌词 renderer/settings/settings-runtime/surface/publication 与 overlay-projection 定向测试：63/63。
- 隔离 Electron 夹具：正常 preload、认证和会话中，翻译 75%、换行行距 160%、句间距 40px 自动保存；1800 × 540 预览与基础/高级切换正常，无 pageerror。匿名 `/lyrics?layer=basic` 返回 200，独立浏览器源通过快照读到正文 56px、翻译 42px、句间距 40px。仅使用合成数据，实例与临时目录已清理。
- `npm run verify:docs`：10/10。首次检查发现新计划状态标签不合规，改为标准标签后通过。
- 12 个改动 JavaScript 文件语法检查、限定 UI 检测与 `git diff --check` 通过。
- 技术参考与内置配置指南已同步；交互导航教程未列具体参数，无需调整。未打包、替换用户运行实例或在直播姬内实播。

## 回退与完成条件

失败时只撤销本任务修改；保留所有现有未提交内容。完成条件为上述验收有结果且限制如实记录。不提交、构建安装包或替换用户运行实例。
