# 本地组件样式与套装实施计划

Status: Completed

依据本轮用户确认及套装设计报告，实施本地图片/视频样式和作者标准 ZIP 导入。

## 目标与边界

主播在对应组件页或画布选择文件，预览并调整内容区域后保存样式；作者 ZIP 一次导入多个分类。背景、弹幕装饰、时钟底图、许愿装饰、开播视频、礼物边框及大航海感谢复用现有组件和业务事件。已添加样式可移除，正在直播及已保存场景引用不失效。网页入口沿用现有实现；不执行压缩包内脚本，不解释其他软件专用 HTML/CSS 模板。

## 当前实现与归属

- `src/server/scene-components.js` 拥有组件配置校验，场景实例已有独立配置快照。
- `src/server/routes/scene-text-media-routes.js` 已提供桌面管理身份及已绑定画布能力的两种素材入口；新样式沿用此授权方式。
- `public/js/admin/component-preview-picker.js` 与场景 inspector 拥有新增和当前实例编辑；客户端功能页增加同库入口。
- `public/js/overlays/component-preview-client.js` 为预览和正式子渲染器提供统一通信。装饰通过现有根节点组合；事件视频接入原感谢队列，开播沿用原开关。
- 新增 `src/storage/component-style-store.js` 管理本机素材目录和原子索引；新增场景素材服务管理导入。媒体不进入 EXE 的 `public/` 和云设置。

## 兼容与决策

新增可选 `mediaStyle` 外观字段，不改变旧配置、凭据及业务统计。库删除只移除可选项并保留场景所用的不可变素材；不覆盖已有实例。ZIP 使用显式清单，图片/视频白名单及有限体积、条目数；采用 yauzl 流式读取 ZIP，避免自行实现不可信压缩包解析。新运行依赖仅用于该必要能力。

## 里程碑

- [x] 素材契约、原子存储、流式上传和 ZIP 预览/确认导入；验证越权、路径穿越、大小限制、失败回滚、重复导入和删除保留引用。
- [x] 各渲染器接入装饰及自定义事件视频；验证数据更新、触发去重、顺序播放、结束隐藏及停用清理（隔离合成事件）。
- [x] 客户端同库入口、画布添加与替换、预览拖动内容区、删除；验证不误增图层、不改变原实例几何、未应用不影响输出。
- [x] 作者清单示例与操作说明；更新 API/存储/展示契约，进行隔离桌面与浏览器输出检查。

## 验证

新增 `test/scenes/component-styles.test.js` 和针对导入及渲染的浏览器验证。执行相关 scene/component/gift 测试、`npm run check`、`npm run verify:docs`、`npm run verify:architecture`、`git diff --check`，检查相对任务前快照的改动和 `git status --short`。测试使用仓库 `tmp/` 隔离数据；不启动或重启用户正在使用的应用。

## 失败处理与完成条件

导入先暂存、校验再原子登记；失败仅清理本次暂存。保留任务开始前的工作区快照用于逐文件比较，不用 Git 回退用户修改。不创建提交或发布安装器。完成需上述导入、编辑、引用保留及输出行为有实际测试证据，并准确记录未覆盖的实播/安装器验证。

## 完成证据（2026-10-06）

- `test/scenes/component-styles.test.js` 七项通过：七类样式归一化、Range 与删除后引用、ZIP 预览/确认/幂等/取消、路径和格式拒绝、授权、CRC 损坏、上传中撤销/中断及流上限。
- `test/admin/component-style-library.test.js` 两项端到端通过：文件预览、拖动/缩放内容区、原图层替换、撤销同步控件、发布后删除素材仍显示、恢复内置、坏文件取消；许愿数据更新、礼物/大航海顺序与去重、长预览不中断、开播启停、真实 WebM 播放与结束隐藏。
- 最终聚焦批次 27/27 通过：上述两文件及 `canvas-gift-components`、`canvas-opening`、`gift-frame-queue`、`guard-thanks`。日志 `tmp/component-styles-final-focused.log`。
- 扩展批次 93 项中 89 通过、1 跳过（Windows 不提供符号链接权限）、3 失败。失败均在既有 `component-preview-output.test.js`：放弃草稿状态、内置时钟手动高度、负坐标校验。用任务前源码快照与同一测试复现三项失败；未修改这些既有问题。日志 `tmp/component-styles-regression-final.log` 与 `tmp/component-styles-prior-regressions.log`。
- 隔离 Electron 使用真实 preload/IPC/main 请求认证：单文件导入、ZIP 确认/取消、按分类登记、重复版本不增加卡片、客户端加入画布及感谢文字开关通过；云设置写入为 0。匿名管理页仍被拒绝。合成授权到期后只重启本次测试实例。
- 视觉复查覆盖编辑窗、ZIP 确认、时钟/弹幕内容区和感谢图层。时钟证据 `tmp/component-styles-clock-final.png`，感谢编辑证据 `tmp/component-styles-editor-final.png`；页面错误记录为空。
- `npm run check`、`npm run verify:docs`、`npm run verify:architecture`（19/19）及最终 `git diff --check` 通过。对比任务前快照审查自身改动，保留其他工作区修改。

## 交付边界

作者格式见 [套装制作与导入](../../../docs/guides/component-style-packages.md)。ZIP 登记分类样式，不自动生成整套布局；第三方普通 ZIP 由主播解压后逐项添加。不执行 HTML/CSS/JS，不导入字体和独立音频。删除库条目保留文件，不执行垃圾回收。视频编码、透明通道、音频及实际 OBS/直播姬仍需随作者素材检查；本次未连接真实直播间。

新增套装素材存于应用数据目录，后续可脱离 EXE 分发。已有 `public/` 内置大素材没有移动或删除；未构建或发布新安装器，不宣称本次已经减小安装包体积。
