# 极光薄笺客户端接入

状态：Completed。用户选择调研中的第 3 个方向，样式、出场动效、独立参数与客户端接入完成，验收证据及限制见末节；未构建或发布安装包。

## 目标与边界

新增客户端飘窗样式 `aurora`（极光薄笺）。沿用本机账号外观、横向 feed、消息安全渲染和场景输出。珠光薄片、独立昵称签、切角与轻摆吊饰形成视觉特征；文字水平稳定，长句与 B 站表情完整显示。只参考原作的材料和构成，装饰使用原创 CSS／SVG，不引入第三方商品资源。

不改变事件协议、队列时序、账户身份、安全边界、已有样式或远端旧浏览器源；不提交、打包或发布。飘窗沿用当前普通弹幕、礼物及上舰展示，不显示 SC。用户原有未提交变更保留，任务前副本位于 `tmp/aurora-danmaku-20261104/baseline/`。

## 所有者与修改位置

- `public/js/shared/danmaku-style-options.js`：样式注册、参数校验、默认值与 CSS 变量。由现有 `sync-danmaku-style-options.cjs --write` 生成本地 Node 镜像。
- `public/js/shared/danmaku-layout.js` 与 `src/shared/danmaku-layout.js`：新款全画布默认区域，旧记录缺少新区域时补齐，保留其他区域。
- `public/js/overlays/danmaku-aurora.js`、`public/css/overlays/danmaku/aurora.css`：安全内容的组合、独立装饰及动画；公共浮动 feed 继续拥有位置、匀速移动、清理和拥挤处理。
- 客户端样式库卡片、标签、参数分组与 `component-style-parameters` 能力表：复用既有选择和保存路径，画布入口复用相同合同。
- `docs/reference/frontend/overlays.md`：实现与参数契约；`docs/guides/component-style-parameters.md`、应用内使用指南：选择入口、调节方式和适用范围。既有交互引导没有按款式枚举，不新增教程步骤。
- 聚焦测试：`test/danmaku/danmaku-style-options.test.js`、`danmaku-layout.test.js`、现有 renderer／floating／appearance／panel 测试。复用隔离桌面夹具 `test/fixtures/danmaku-canvas-editor.cjs` 验证主流程。

## 视觉与参数决定

默认淡紫珠光纸面，青冰、玫瑰、香槟三个备选；昵称牌固定层级，正文默认 26px（18–40px），随内容增高，装饰不覆盖正文。公共字体、文字颜色、背景不透明度、飘动速度、分散程度和通用效果继续生效。

| 独立参数 | 值域 | 默认 | 作用 |
| --- | --- | --- | --- |
| `auroraPalette` | `lilac` / `glacier` / `rose` / `champagne` | `lilac` | 纸面、边缘与昵称签的配色，保留自定义正文颜色 |
| `auroraSheen` | 整数 0–100% | 55 | 珠光叠层与边缘高光，不提高正文亮度 |
| `auroraCharm` | `star` / `moon` / `none` | `star` | 吊饰图案或隐藏，区域尺寸保持稳定 |
| `auroraSway` | 整数 0–12° | 5 | 仅吊饰轻摆幅度，正文不参与摆动 |

持续动画沿用公共 `ambientMotion`，关闭后保留入场与横向移动。减少动态效果停止装饰循环与分层入场，保留阅读所需的飘窗位移。入场在独立内层完成，避免覆盖 feed 的 transform；目标时长 420–620ms，昵称／正文在前 300ms 内清楚可读。

## 交付步骤与验收

- [x] 注册客户端样式和独立参数，补齐本地 Node 镜像、旧布局兼容与控件能力。参数边界、逐款隔离与旧布局恢复通过聚焦测试。
- [x] 完成原创造型、礼物／上舰布局与分层入场、持续轻摆。实际播放检查长昵称、长文、表情与密集输入，参数更新保留已有消息及入场 Animation。
- [x] 完成 624×360 真实渲染缩略图、筛选与画布入口。隔离 Electron 正常选择、调参、保存、重载及进程重启恢复通过；画布保存并应用及真实本机场景合成消息输出通过。
- [x] 完成可读性、极值、持续动画、减少动态效果与 420×240 小组件检查；调整昵称对比度、透明轮廓效果和实际显示时才开始的入场。
- [x] 同步参考与使用指南，完成 99 项聚焦测试、15 文件语法、合同镜像与固定 renderer 快照检查；任务增量和差异检查已审阅。文档全库门禁与环境清理的外部限制见下文。

## 桌面 QA 清单

正常输入检查所有四个独立参数及公共字号／颜色／透明度／速度／分散／持续动画；检查修改再恢复、保存重载和恢复当前款默认值。异常场景为长昵称／连续长文与较小区域／密集消息。截图与隔离数据库仅写入 `tmp/aurora-danmaku-20261104/`，夹具使用独立 userData、sessionData、临时端口和合成账号，不启动或重启用户实例。

若发现错误，仅回退本任务改动，保留原有编辑和已保存用户数据；验证实例由本任务关闭。

## 验证记录

- 首轮 61 项聚焦检查：本款参数、消息与移动等 59 项通过；2 项失败来自并行新增 `startrail` 的合同／测试尚未同步，保留其实现，待工作区稳定后复核。
- 隔离 Electron 夹具已启动：独立 userData／sessionData、临时端口、真实 preload 与请求授权。本机样式库及画布已显示极光薄笺。
- 四套配色、珠光 0／100、摆幅 0／12、星／月／隐藏吊饰、持续动画开关及恢复默认通过正常控件验证；检查新近消息，调参保持原 DOM 与入场 Animation，关闭持续动画后只剩横向位移。
- 视觉修整：昵称签统一采用较深的主题色，改善青蓝／玫瑰／香槟方案的白字对比；通用效果按真实透明轮廓使用 `art`，避免纸面切角裁掉矩形外投影。
- 隔离 Electron 正常控件保存 `glacier`、`moon`、珠光 100、摆幅 12；页面重载及关闭／重启自有夹具后仍从本机 SQLite 恢复这些值。画布“保存并应用”返回成功，组件使用 shared 外观。
- 复用 `startCanvasOutputFixture` 的真实场景服务、共享外观、HTTP／通知和消息投影；使用从桌面保存读取的相同配置发布本机场景，正常收到合成直播弹幕并显示冰川青蓝／月牙。没有使用真实账号消息，未做 B 站、OBS／直播姬实播。
- 密集输入 12 条，抽查 5 张可见卡片无矩形重叠，正文 transform 为 none。长昵称、换行、行内及纯表情通过真实渲染检查。420×240 区域分别检查 18／40px，feed 缩放后边界误差在 1px 内、正文不横向溢出。
- 背景不透明度 0 时纸面和昵称底板为 0、正文仍为 1；自定义正文颜色正确。系统减少动态效果时所有 aurora CSS 动画停止，公共横移保留。
- 最后审查修正入场时机：只在 feed 的 `[data-live-entry]` 上播放；实际检查快照和等待位置的消息均无入场，新消息拥有纸面／昵称／正文三层入场，160ms 时纸面透明度约 0.797。原有参数更新不重播的行为保持。
- 参数面板两项既有用例在参数表增大后复现 `Resulting promise was garbage collected`；任务前合同或单一新款合同比较均通过，最终将导入与同步挂载拆为两次 evaluate，沿用同文件首项已有模式，保留全部断言。最终 99／99 通过（10 个直接相关文件，`--test-concurrency=1`）；明细在 `tmp/aurora-danmaku-20261104/focused-tests.log`。
- `node scripts/sync-danmaku-style-options.cjs --check`、`node scripts/sync-danmaku-source.cjs --check`、15 个受影响 JavaScript 文件的 `node --check` 通过。没有改动固定 renderer core，也没有修改远端仓库。
- 技术参考、参数使用指南及应用内说明同步；现有交互引导不枚举款式，保持不变。实际缩略图保存在 `public/img/overlays/danmaku-previews/aurora.png`，QA 图片、任务前副本和动作检查记录只位于根 `tmp/aurora-danmaku-20261104/`。
- `npm run verify:docs` 首次 9／10 通过，唯一失败为并行 `2026-11-04-comic-danmaku.md` 缺少当前状态；其归档后最终复核仍为 9／10，改为并行 `2026-11-04-startrail-danmaku.md` 缺少当前状态。路由、文档链接和本任务计划均通过，本任务不改写其他计划。`git diff --check` 通过，最终状态中保留全部既有和并行变更，没有暂存、提交或纳入根 tmp 数据。
- 最后清理阶段，节点 REPL 在对已重建画布查询旧缩略图节点时等待超时并重置，浏览器与节点宿主退出；只读进程检查仍发现自有隔离 Electron。随后清理该进程树和其 `tmp/aurora-danmaku-20261104/profile` 的命令被工具策略审查拒绝，未提供具体原因；尊重拒绝，未改用另一接口清理，合成临时配置暂留。用户正在运行的应用未被控制或重启。
