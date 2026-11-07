# Celestial Horizontal Chat Implementation Plan

Status: Completed

## Goal

按用户选中的 [Celestial Horizontal Chat](https://meldstudio.co/gallery/celestial-horizontal-chat/) 公开实际组件重建配色、尺寸、字体和动效，接入客户端、本地画布及场景输出。新增独立「横向滚动」分类，不能归入固定位置、区域随机或飘窗弹幕。其他推荐款由各自任务处理，本计划只拥有 `celestial-horizontal`。

## Current Behavior And Reference

现有公共 feed 已支持 `flowAxis: horizontal`，拥有测量、移动中断、越界淘汰与清理；Stargazer 使用它作为内部布局选项。样式库只有三种显示分类。原款实际 HTML 是底部全宽 96px 横栏，#1a0633/80% 底板、#ffd700/50% 上下细线、30px/20% 金色辉光；星云三层紫／青径向渐变、200% 背景、20s ease-in-out 循环，30 颗 1–3px 白星以 2–5s 明暗变化。Cinzel 700 昵称和 Montserrat 300 正文默认 16px，星形 24px、内边距 32px、内容间隔 12px、分隔线 24px。原实现新消息从右侧 30px 用 500ms cubic-bezier(.23,1,.32,1) 入场，超宽后平滑滚动到最新；没有空闲持续飞行。宣传画面的全屏星空不属于透明组件。

参考 HTML、视频、测量和分镜仅保留 `tmp/celestial-horizontal-20261107/`。以公开运行组件为视觉依据，独立实现 LIRA 适配，不使用 Firehose、Tailwind 或远程运行依赖。

## Ownership And Proposed Changes

- `public/js/shared/danmaku-style-options.js`：注册 `celestial-horizontal`，`layout: horizontal`，普通字体／正文颜色／底色透明度与持续动画参数；本款金色强调色可由原有配色字段调整。Node 镜像经现有脚本同步。
- `public/js/shared/danmaku-layout.js`：新增 1920×96 底部通栏默认区域；旧布局补缺失区域，横栏加宽不放大字形。布局 Node 镜像同步。
- `public/js/overlays/danmaku-celestial-horizontal.js` 和同名 CSS：安全 renderer 的文字与表情组合、姓名稳定星形、实际礼物／大航海／SC 内容；仅本款拥有装饰与分层入场。公共 feed 继续拥有排序、水平移动、中断、移除、销毁，无新连接、队列或计时器。
- `public/js/overlays/danmaku.js` / canvas / style application：按新 layout 使用现有 horizontal flow；样式切换创建并释放本款背景装饰，修改参数更新已有节点。
- 样式库 HTML、`danmaku-style-library.js` / catalog、画布 picker 与 preview definitions：新增第四分类及真实 renderer 缩略图，保持三个既有类别不变。
- 两个开源 Latin 字体记录来源及 OFL，中文沿既有本机字体回退。并行的共享字体任务已将本款两个字重纳入既有字体库/CDN owner，保留原本地 URL 与族名；本款不另建下载器或运行依赖。
- 文档 owner：`docs/reference/frontend/overlays.md`、`danmaku-motion.md`、`docs/guides/component-style-parameters.md`、应用内弹幕指南；检查互动引导分类描述。

## Compatibility Constraints / Non-goals

沿用本地账号外观、场景格式与实时消息入口。只扩展合法 style/layout 值及缺省区域，不修改 HTTP/WS/IPC、授权、Electron 生命周期、数据归属和服务器旧渲染源。不模拟 Twitch 身份／付费数据；使用真实 B 站消息，礼物金额是已结算总额、SC 保留完整原文且可撤下。其他工作区改动、staging 与 output 原样保留，不提交、打包、部署或控制用户运行中的客户端。

## Milestones

- [x] 确认原站实际结构、CSS、字体、尺寸和事件驱动横移，保留参考证据。
- [x] 注册新分类、布局及参数，接入 renderer／CSS／装饰，保留既有所有权。
- [x] 原片同尺寸对照入场、横移、星云与星点；修正默认间距与首条入场，密集追加续接共用偏移，真实礼物显式覆盖通用 grid 和扫光分隔线。
- [x] 验证四分类互斥、桌面选择／保存／重开、画布添加与本机场景输出；覆盖密集到达、长中英混排／表情／完整 SC、减少动态效果及样式切换清理。
- [x] 同步测试与技术／用户文档；独立视觉评审、门禁、最终 diff 和资源清理。

## Verification

复用 `test/danmaku/danmaku-layout.test.js`、`danmaku-style-options.test.js`、`danmaku-overlay-renderer.test.js`、`danmaku-feed-motion.test.js` 和既有样式筛选／画布定义测试。新增测试只覆盖第四类别合同、旧布局升级、真实消息完整性和水平 feed 的具体回归风险，不加精确颜色／文案源扫描。

命令：`node --experimental-vm-modules --test` 执行上述受影响 suites；`node scripts/sync-danmaku-style-options.cjs --check`；布局与 component-style-parameters 镜像通过既有直接比较覆盖；`npm run verify:docs`、`npm run verify:architecture`、相关 `node --check`、`git diff --check`。跨 suite 失败先诊断归属，再决定是否需要扩大范围。

持久浏览器与既有隔离 Electron fixture 完成功能／视觉分开核验。每个本地 exact route 在导航前确认 HTTP 状态。QA 清单、截图、动画采样、合成数据和配置都在 tmp，不用真实用户数据。完成后关闭自建进程和夹具并核验路径再删合成 profile。

## Rollback Or Failure Handling

遇到不支持的原站宿主集成只用公开演示取证，不安装宿主或修改保护。只检查并撤回本任务行与新文件，保留共享文件里的其他任务修改。任何未完成的视觉／交付条件留在本计划和目标中，不把局部通过当完整完成。

## Done When

客户端和画布均有独立「横向滚动」类别，本款在另外三类中不出现；保存／重开／本机场景一致使用本款；实际播放保持原款几何、颜色、字体和事件驱动横移；各类真实内容完整，无重复消息、监听或新请求；减少动态效果和销毁完整，聚焦检查与文档同步，最终 diff 受控且已独立视觉复核。

## Verification Results

- 原站实际源码、6.116 秒演示与 QA 证据位于 `tmp/celestial-horizontal-20261107/`。四条同文消息的自然宽度一致；终态横坐标差 0.203125px 来自原生滚动取整。100ms 入场的内容坐标、透明度和位移相同。独立复核发现研究夹具漏掉 Tailwind 的 SVG block 基线规则；已通过原站实时 DOM 确认并修正参考夹具，`validated-*.png` 取代旧对照。没有让产品去匹配研究误差。
- 保留共享 feed，首条入场不叠加消息自身宽度，后续继续同批偏移；密集到达和 0.63 倍缩放的水平测试通过，Stargazer／Moonlit 相关回归 7/7。字体／布局／安全消息／公共效果五个 suites 49/49；四分类互斥及面板保存／预览用例通过。样式镜像与相关语法检查通过。
- 原始合跑 104 项中，天穹两项重叠问题已修正，进行中的玻璃气泡镜像差异随后已同步；另见其他任务的 Animated Gradient 密集重叠、最近使用夹具导入 promise 被回收，以及海风礼物内容选择器问题。本次不改这些实现。最后定向 17 项为 16 通过，唯一失败是全样式排版的 `sea-breeze: missing gift content`；本款 12/40px、自选字体、1920／4K 虚拟画布及半宽区域另有直接测量，不声明工作区全部通过。
- 隔离 Electron 使用既有 fixture 的真实 preload、授权、本机外观 API 和场景。保存 20px／`#dcecff`／65% 背景并重开成功；新增通栏默认为 `(0,984,1920,96)`。同一共享事件缓冲向已发布场景送入合成聊天、礼物与 SC，完整文字、数量、结算金额正确，SC 下线移除成功。修正通用礼物 grid／右内边距及扫光伪元素对本款的干扰，事件保持单行分隔。
- 30 星点／20s 星云正常循环，空闲文字不移动；关闭持续动画后 31 个循环降至 0，新消息入场仍在；减少动态效果时 0 动画。12／40px、自选字体、零底色不透明度、重复配置只有一个背景节点、清理后 0 装饰／动画均已实测。缩略图是本机 renderer 的 640×160 默认 16px 截图，含来源元数据。
- 技术参考、参数指南、应用内指南与字体来源已同步；互动引导没有需要变更的分类文案。`verify:architecture` 30/30、`verify:docs` 10/10、一次设计检测 `[]`、`git diff --check` 通过。初次文档门禁发现本计划使用了不能解析的中文状态标签，已改为 `Status:` 并复测通过。
- 独立视觉复核为 `ship`，完整五节报告在 QA 目录 `finish-review.md`；独立文档复核为 synchronized，见 `document-review.md`，无需额外文档或全局设计系统修改。确定性的公共 feed 移动替代原生 smooth scroll，B 站真实消息及原有设置属于明确适配；不声明逐像素绝对一致或真实直播验收。
- 已关闭自建 Chromium、两个 HTTP 夹具和隔离 Electron；验证合成 profile 的 realpath 正好属于本任务 QA 目录后删除，原进程路径复查无遗留。证据文件保留在 tmp，未触碰用户运行实例或 output，未提交、打包或发布。最终 touched diff、`git diff --check` 与 status 已检查，保留共享文件中的其他任务修改。
