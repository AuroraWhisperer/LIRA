# 统一客户端字体库

Status: Completed

用户已停止歌词动效试验，要求提取三款演示字体，并让所有字体选择入口共用已下载字体。

## Goal / Non-goals

播放器、歌词、弹幕、队列、歌单展示板及场景参数共用同一字体目录，本机字体继续独立枚举。不增加动画、字体下载服务、用户上传入口或新的设置键。

## Current Behavior / Ownership

`shared/local-font-library.js` 已共享本机字体枚举；艺术字体列表却分别写在播放器 HTML 和歌词模块中。`shared/display-fonts.css` 已拥有五款完整字体。月渡花汀文楷有完整分片字库，但只随外部组件包提供。演示中的得意黑与现有文件相同，另两款是志莽行、马善政。

新 `shared/font-catalog.js` 拥有可选字库目录，`shared/font-library.js` 拥有选择器接入及旧值适配；现有本机枚举模块继续拥有权限与缓存。CSS 仍集中声明、按实际使用加载。技术事实更新 `docs/reference/frontend/{pages,playback,overlays}.md`、字体 README 及打包说明；指导更新对应界面提示。

实施发现：弹幕设置还被 LIRA Server 的公开弹幕页消费。服务端需分发同源的字库副本（客户端目录仍为源），否则客户端选择后公开画面会回退。仅同步静态字体/CSS，沿用既有版本资源路由，不改 API、认证或上线环境。场景字体选择保留原有 80/256 字符边界。

## Compatibility Constraints

保留旧播放器字体 ID、歌词 family、任意已存本机字体值、设置键及 HTTP/IPC 契约。文楷纳入共享字体并随客户端打包，外部组件包的字体版本隔离继续生效。固定标题/时钟的裁剪字体和多语言补字不作为可选完整字库。保留现有用户改动，不改文本框及歌词动画。

## Proposed Changes / Milestones

1. 提取两款完整字体为 WOFF2，复用得意黑；统一八款字体目录、许可与懒加载样式。验证字符映射和字体实际载入，打包匹配包含完整字库。
2. 所有现有字体入口接同一个注册函数，包括场景中原为文本框的字体参数；保持旧值、不重复选项/枚举/事件。验证播放器持久化、本机查询及组件配置回归。
3. 验证真实选择器和渲染页面的字体资源，更新文档与用户提示，完成范围审查。

## Verification

- `node --experimental-vm-modules --test test/desktop/local-font-library.test.js test/playback/player-appearance.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/danmaku/danmaku-style-options.test.js`
- 共用字体的浏览器覆盖（复用组件预览服务器），现有歌词多语言和组件资源包覆盖。
- `node --test test/engineering/packaging-scope.test.js`，核对字体和 OFL 随包、主题媒体仍排除。
- 相关管理界面检查、`npm run verify:docs`、受影响源码语法检查、`git diff --check` 与 `git status --short`。
- 不以普通浏览器替代桌面权限验证；使用隔离 Electron 或已有桌面测试入口验证管理界面。

## Rollback / Done When

失败时仅修正或撤销本任务拥有的文件片段，不重置其他改动。完成条件：全部现有字体入口展示同一完整字库，旧设置可读，字体离线可渲染，无重复下载/事件，聚焦检查通过，技术与用户说明一致且最终 diff 已审查。不构建或发布安装包。

## Results / Evidence

2026-10-16 完成八款共享字体与七个主界面、三个场景参数入口。志莽行和马善政转为 WOFF2，转换前后各 7,015 个 Unicode 字符映射一致；得意黑复用已有文件。完整文楷纳入客户端打包，资源包内字体继续按版本隔离。本机枚举、播放器旧 ID、已存 family 和场景长度限制保留。LIRA Server 公开弹幕页同步同源静态字体，38 个字体及许可文件与客户端逐字节一致，两份 CSS 仅调整资源路径。

- 客户端字库、播放器、歌词设置、弹幕样式及打包组合 41 项通过；字体浏览器检查 2 项通过，覆盖八款真实字体、按需加载、重复 CSS 导入不重复请求及原有多语言补字。
- 组件组合最初 11 项通过、1 项失败：旧歌单测试仍把字体字段当作自由文本。改为选择共享字体后，相关回归组合 11 项通过，包含真实 Electron 设置共享检查；最终字体列表置顶后的受影响组合 13 项通过。组件包覆盖包含带引号的文楷 family 与版本隔离。
- 管理界面运行时、壳层、使用指南、弹幕标记和 ES 模块边界组合 38 项通过。12 个受影响模块语法检查通过。
- 隔离 Electron 使用真实 preload、桌面授权与 IPC，确认 10 个入口各只有一组相同的八款字体，旧播放器值及新选择可保留，场景草稿同步，弹幕字体通过“应用到直播画面”保存；本机字体单列，页面错误为零。合成授权过期后经既有夹具续期重新进入 `/admin`，最终截图来自已授权管理页。实例已关闭，临时合成数据已清理。
- Server 执行计划检查后运行 `npm run verify -- --node test/overlay-static.test.js --node test/overlay-asset-cache.test.js --node test/overlay-style-options.test.js --browser e2e/overlay-style-options.spec.js`：Node 15 项、浏览器 43 项通过，覆盖实际自定义字形及同源无重复加载；`npm run docs:check` 57 项通过。
- 客户端 `npm run verify:docs` 10 项通过；技术参考、打包说明、字体许可、应用内配置指南与服务端规范同步。导览脚本没有字体操作步骤，既有指南截图没有具体字库承诺，无需修改。两仓任务范围 diff 与空白检查通过，保留其他未提交改动。

证据保存在客户端 `tmp/shared-font-*.log`、`tmp/shared-font-electron-results.json`、`tmp/shared-font-library-menu.png` 及服务端 `tmp/shared-font-verification.log`。未恢复动画工作、操作真实用户数据、提交、打包客户端或部署服务器；验证范围不包含真实直播推流和安装包运行。
