# 花与信笺客户端接入

**Status:** Completed

用户已认可 `tmp/flower-letter-replica/` 当前视觉稿，要求作为新的客户端弹幕样式交付。

## 目标与边界

将已认可的独立矢量贴图及真实文字排版接入 `flower-letter` 固定弹幕。保留普通、粉丝、三档大航海、礼物、免费礼物、SC 和上舰造型，默认使用共享字体库悠哉字体。停止逐帧美术微调；不复制研究播放器、视频、参考截图或消息队列，不改其他样式，不修改真实用户设置，不打包发布。

## 实现与兼容

主题 renderer 复用现有安全消息/表情内容，主题 CSS 与独立 SVG 拥有外观及入场；共享 feed 继续负责测量、排序、打断、淘汰、减少动态效果与销毁。纸面采用上/中/下切片，长文只延展纸面中段，花叶保持比例。

共享样式目录、默认区域和效果能力的 Node/browser 两份合同同步增加新枚举。旧布局只补充缺失的新区域，不改其他区域或持久化键。身份读取当前房间字段，购买大航海读取购买等级；时间、昵称、头像、灯牌、礼物数量及结算金额来自消息，不写入纹理。

主要文件：`public/js/overlays/danmaku-flower-letter.js`、`public/css/overlays/danmaku/flower-letter.css`、`public/img/overlays/danmaku-flower-letter/`，已有 renderer 入口、共享样式/区域/效果能力、管理页样式卡片。参考及使用说明同步至现有 overlays/motion 文档和弹幕使用指南。

## 里程碑与验证

- [x] 注册主题、动态字段、默认字体、区域及客户端缩略图；Node/browser 合同、旧布局兼容与消息内容安全已验证。
- [x] 现有 renderer/样式/区域/管理页/动效测试增加必要覆盖；短长文、表情、三档身份、礼物、SC、密集到达、上下滚动及减少动态效果检查通过。
- [x] 隔离 Electron 验证客户端选择、应用、重载与默认字体；真实画布预览中独立添加本款组件，保存并发布本地场景成功，无页面错误。截图及临时实例位于 `tmp/flower-letter-client-integration/`。
- [x] 同步文档、检查改动差异与 `git diff --check`；保留已有用户修改，归档本次验证结果。清理命令被自动审批策略拒绝，限制记录如下。

回退仅撤销本次增加的文件及基线之后的接入行；基线保存在 `tmp/flower-letter-client-integration/baseline/`，不得覆盖既有修改。

完成条件：新样式在客户端独立可选、预览及已发布组件消费既有实时数据链路，聚焦验证通过，剩余实播限制如实记录。

## 验证记录

- `final-focused-tests.log`：102 项中 101 通过；唯一失败为原有 ranked 缩放夹具未提供 `document.getElementById`，由先前的 Twitter 房主资料初始化触发。`baseline-reproduction.log` 使用接入前保存的源码复现相同错误，未修改该既有夹具或其他样式。
- `motion-tests.log`：本款上下方向的连续／打断／减少动态效果／销毁，以及长文延纸、混合消息，共 3 项通过。
- `guide-tests.log`：使用指南相关 19 项通过。新增 renderer 与效果接入的 `node --check` 通过。
- Electron 43.8.3 使用既有 `danmaku-canvas-editor.cjs`，所有数据路径落在本任务 tmp 子目录，真实 preload、请求授权和 IPC 均保留；`client-style-selected-final.png` 与 `client-canvas-single-final.png` 为客户端及画布证据。最终本地场景仅保留独立 `flower-letter` 图层，已发布版本 2；`desktop-verification.json` 记录实际字段与零页面错误。合成数据用于检查展示，未使用真实主播数据、未声称完成 B 站上游或 OBS／哔哩哔哩直播姬实播。
- 为避免长文末行碰到动态署名，客户端的花笺署名在纸面下方保留独立行距；花叶、邮戳、字形及其他已认可造型不再微调。
- 技术参考、动效合同、字体来源、用户指南已同步。交互导览仍沿用同一弹幕姬入口，无需新增步骤。
- 未修改远程 LIRA Server、未打包安装版、未提交或发布。
- 共享目录发生另一个 `notebook` 任务的并行修改后，本款最后重新运行 renderer／默认字体／上下动效聚焦测试，`final-flower-letter-tests.log` 为 6/6 通过。没有覆盖另一任务的修改。
- `git diff --check` 通过；45 份独立 SVG 均经 XML 结构检查，不含截图、文字、脚本或外部图片引用。
- 最终 `npm run verify:docs` 为 9/10：本任务链接与归档正常，唯一失败来自另一并行任务 `2026-10-26-notebook-danmaku.md` 未提供可解析的当前状态。该文件不属于本次修改，未代改其计划。最终工作区状态记录在 `final-git-status.txt`。
- 验收使用的 Electron 与浏览器均已正常关闭。删除两份隔离 Electron profile 并停止旧原型辅助服务的清理命令被自动审批以 `blocked by policy` 拒绝；不通过其他工具重试，相关 tmp 目录与 PID 28916 的原型预览服务保留。该服务仅提供已有原型页面，不表示继续美术迭代。
