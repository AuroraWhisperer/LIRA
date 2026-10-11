# 大播放器字体与排版

Status: Completed

## 目标与边界

在现有「播放 → 播放器外观」内增加可离线使用的三款字体、本机字体和歌词行高；参照常见歌词播放器补齐字重、字间距、句间距和当前行强调。歌曲信息与歌词可独立选字体。维持默认样式和已有用户偏好，不替换歌词引擎、播放行为或客户端主题。

## 当前实现与归属

- `playback/ui/appearance.js` 拥有 `playbackAppearance:v1`、即时预览和保存。新字段在读取旧偏好时补默认值，沿用原键。
- `admin/local-font-library.js` 已为桌面歌词及点歌板共享本机字体查询。本次将无 Admin 依赖的实现移入 `shared/`，原路径保留转导出，避免播放器反向依赖 Admin 或重复查询。
- 外观片段及 `playback/fullscreen.css`、`appearance.css` 拥有控件与实际排版；技术合同为 `docs/reference/frontend/playback.md`，使用说明为 `usage-guide-playback.html`。
- 本机字体沿用现有原生权限确认；只使用经引号转义的字体族名，不增加权限或 IPC。

## 实施与验证

1. 获取得意黑、荆南麦圆、站酷快乐体的固定版本字体及 OFL；完整字符集转为 WOFF2，记录来源与校验值。验证实际字体解码、字符覆盖和离线加载。
2. 新增独立字体与排版控件，更多参数折叠显示，复用既有 localStorage、滑块和字体查询。验证旧偏好、数值精度、边界、危险 CSS、恢复默认和共享查询。
3. 复用 `tmp/player-appearance-qa/` 的隔离 Electron 夹具，检查三款字体实际加载、本机选项、逐项控件、长歌词换行、自动跟随、重载及重置；使用合成歌词，不访问真实账号/音源。
4. 同步字体资产说明、播放器合同、本机字体归属引用及应用内指南；运行相关 node:test、`npm run verify:docs`、模块边界检查及 `git diff --check`，审查最终改动。

## 参考与取舍

- [Better Lyrics 样式参数](https://github.com/better-lyrics/better-lyrics/blob/master/STYLING.md)：字体、字号、字重、行高、副行和高亮。
- [AMLL 歌词属性](https://amll.dev/en/reference/react/interfacelyricplayerprops.html)：歌词强调、对齐和动态表现。仅参考参数，不引入其框架或运行时。
- 模板风格可按现有独立选项组合；本次不新增整页主题预设，以免一键覆盖用户单独配置。

## 完成条件与失败处理

所列控件在预览及大播放器中生效；字体随客户端离线交付，缺字走系统回退；默认兼容、相关测试及桌面验证通过，文档一致，临时数据不进入改动。失败时只修复或反向撤销本次差异，保留已有工作和用户偏好。

## 完成证据（2026-10-11）

- 70 项相关功能测试通过：`node --experimental-vm-modules --test test/playback/player-appearance.test.js test/playback/frontend-playback.test.js test/desktop/local-font-library.test.js test/desktop/electron-main-modules.test.js test/lyrics/desktop-lyric-settings.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/danmaku/danmaku-style-options.test.js test/admin/frontend-usage-guide.test.js test/admin/frontend-admin-layout.test.js`。新增覆盖旧偏好继承、浮点精度、内置/本机字体白名单、CSS 注入拒绝与默认变量清除。
- ESM 检查 5 项通过；兼容转导出使用显式 import/export 以符合仓库扫描器。`module-boundaries.test.js` 的 15 项通过，1 项被任务开始前已有的 `public/js/admin/fans/index.js` 空 catch 改动阻塞，未修改该文件。`npm run verify:docs` 10 项通过。
- 隔离 Electron 使用真实 preload、请求认证及本机字体 API，匿名管理页 401、授权 200。三款 WOFF2 均实际解码为 loaded；本机读取 219 个字体族，多个选择器共用一次查询。验证歌曲/歌词独立字体、全部新增排版字段、1200px 窗口的自定义字号与 100% 等大强调、长句及副行换行、当前歌词跟随、同一端口/会话跨进程重启恢复、恢复默认；模拟拒绝枚举和本机缺失字体后仍保留内置选择，页面无异常。
- 三款当前 WOFF2 的 cmap 与原始字体一致，SHA-256 与资产说明一致。约 4.9MB 字体通过已有 `public/**/*` 包含规则交付；未制作安装包。外部网络被测试夹具阻断，未使用真实账号或音源。
- 字体控件截图：`tmp/player-appearance-qa/fonts-settings.png`；长歌词截图：同目录 `fonts-fullscreen.png`。仅检查桌面原生窗口，视觉扫描无发现，未修改客户端设计系统。字体/排版合同、共享字体库归属及应用内指南已同步；新手引导的现有播放入口适用，无需改动。

## 风格调研结论

当前独立选项可组合软萌唱片机（麦圆＋浅色背景）、醒目封面（得意黑＋封面）和复古黑胶风格。另可参考 [ModernPlayer](https://github.com/better-lyrics/themes/discussions/31) 的专辑背景与非当前歌词弱化，后续最有价值的参数是背景模糊/亮度、非当前行模糊/透明度、歌词聚焦位置和动效强度；这些属于下一轮可选方向，本次交付集中于用户指定的字体与排版。
