# 基础 UI 组件审查（2026-10-04）

本次按用户确认的范围审查基础 UI，包括问号帮助、toast、确认框、字段反馈、下拉框、滑块及配对数值输入、开关、颜色输入、按钮、文本输入、标签导航、折叠和客户端主题。由三组 `gpt-6-astra / max` 并行审查，再交叉核对真实消费者和运行证据。

**结论：确认 10 项 P2 问题，最先处理编辑值保护、颜色继承和组件组合后的交互。** 没有确认 P0/P1 问题。Toast、参数滑块的核心生命周期、客户端配色提交机制已有合理实现，没有重写整套组件库的依据。

以下主体保留修复前的审查记录和证据；十项问题已在后续复核中确认并修复，处理结果及验证见文末“复核与修复”。原始检查对象包括当时工作区的其他未提交修改，原位置行号可能因修复发生变化。

## 确认的问题与处理顺序

### 1. P2：后台快照可能覆盖正在编辑的组合控件

位置：[forms.js:180](D:/Work/Live/public/js/admin/forms.js:180)、[forms.js:256](D:/Work/Live/public/js/admin/forms.js:256)、[display.js:27](D:/Work/Live/public/js/admin/display.js:27)。

`fillForm()` 只跳过 `document.activeElement`，但 range/number 是一对，增强下拉框的焦点又在代理按钮上。编辑歌单板字号为 `40` 时，旧设置快照 `28` 可以先覆盖 range，再覆盖仍有焦点的 number；下拉框刚选择的 `artist` 也会被回填为 `initial`。

歌单板自动保存等待 180ms 后才读取 DOM。较早一次保存返回时继续编辑，就可能让旧快照覆盖新输入，再由下一次保存提交旧值。这里不是任意队列事件都覆盖表单：已追到设置变更广播、StateService 的 settings 差异判断、state-renderer 回填和真实保存消费者。

最小方向：按一个逻辑字段保护 range/number 和增强 select；由歌单板拥有未确认草稿及保存代次，所有专项回填遵守同一编辑规则。预设和重置作为显式操作可以强制回填。

证据：真实 FormsService 加现有隔离 VM loader 复现 `40 → 28`、`artist → initial`；保存负载路径为静态调用链确认，没有向用户服务器发请求。[复现脚本](D:/Work/Live/tmp/general-components-audit/controls-form-repro.cjs)、[输出](D:/Work/Live/tmp/general-components-audit/controls-form-repro.log)。

### 2. P2：“留空继承文字色”会被颜色控件改成固定黑色

位置：[song-board.html:121](D:/Work/Live/public/pages/admin/song/song-board.html:121)、[display.js:256](D:/Work/Live/public/js/admin/display.js:256)。点歌板还有同型接入：[queue-theme.html:236](D:/Work/Live/public/pages/admin/song/queue-theme.html:236)。

设置用空串表示继承文字色，UI 却用 `input type="color" value=""` 承载。Electron 43.2.0 将初始空值及程序赋空均规范为 `#000000`。随后修改其他歌单板设置，收集表单就会把黑色作为明确颜色保存，继承语义丢失；用户也无法通过该原生控件恢复空值。默认设置和展示端回退逻辑均确认空串具有实际语义。

最小方向：表单明确区分“跟随文字色”和“自定义颜色”；前者仍保存空串，后者才读取颜色值。不要把黑色当作未设置，也不要在共享颜色 CSS 中解决业务语义。

证据：隔离 Electron host 载入实际歌单板 label，属性 `value=''`，初始 `.value='#000000'`，再次赋空仍为黑色；保存与展示回退静态核对。[运行记录](D:/Work/Live/tmp/general-components-audit/electron-runtime.json)。

### 3. P2：歌单板独立主题首次加载漏填五个数值框

位置：[forms.js:253](D:/Work/Live/public/js/admin/forms.js:253)、[display.js:97](D:/Work/Live/public/js/admin/display.js:97)。

用户已关闭主题同步，再次打开页面时，背景透明度、背景模糊、发光强度、歌名字号、标题字号的 range 正确回填，配对 number 却为空或保留旧值。程序赋值不会触发 `bindRangePair` 的 input 监听；现有全量同步只用于预设、重置和手动关闭同步。

最小方向：在歌单板回填 owner 复用同一组字段配对定义，处理单位倍率和第 1 项的编辑保护。不要增加第二套事件监听或持久化 `*Number` 字段。

证据：隔离加载真实 FormsService，设置五个持久化值后，五个 range 正确而 number 为空。与第 1 项共用上述复现脚本。

### 4. P2：浏览器场景编辑页没有注册问号帮助组件

位置：[component-preview-page.js:1](D:/Work/Live/public/js/admin/component-preview-page.js:1)、[component-preview.html:19](D:/Work/Live/public/pages/component-preview.html:19)。

`/c?component=queue` 加载了包含 `lira-help` 的参数模板和相关 CSS，入口依赖图却没有注册组件。未定义标签被 CSS 设为透明并裁切；问号消失，悬浮和键盘均不能显示说明。

最小方向：独立页面入口显式导入现有 `contextual-help.js`，并在现有 `/c` 测试中验证真实 hover/focus。模板含有标签并不能证明组件可用。

证据：现有内存夹具上的真实 `/c` 返回 200；13 个说明均未定义、`tabIndex=-1`、无问号节点，页面没有报错。同一隔离页面仅补注册后，悬浮即显示原说明。[问题状态](D:/Work/Live/tmp/general-components-audit/help-preview-registration.json)、[问题截图](D:/Work/Live/tmp/general-components-audit/help-preview-unregistered.png)、[补注册对照](D:/Work/Live/tmp/general-components-audit/help-preview-after-import.png)。这是该浏览器页面的验证。

### 5. P2：确认框的 Escape 同时关闭底层抽屉

位置：[confirmation-dialog.js:124](D:/Work/Live/public/js/shared/confirmation-dialog.js:124)、[history.js:173](D:/Work/Live/public/js/admin/gifts/history.js:173)。

“全部礼物记录 → 清空全部记录 → Escape”会同时关闭确认框和记录抽屉，最终焦点落到 BODY。共享确认框和抽屉都在 document 监听 Escape，抽屉先注册；`preventDefault()` 和背景 inert 不会消费冒泡事件。实测没有发送清空 API，此项不是误删除问题。

最小方向：确认框在自己的 backdrop 上消费 Escape，避免到达外层监听器；关闭后恢复到仍打开的抽屉按钮。仅在现有 document 回调增加 `stopPropagation()` 太晚。

证据：隔离 Chromium 载入真实片段、模块与 CSS，真实点击和键盘操作；结果为抽屉与确认框同时关闭，0 API 请求、0 页面错误。[运行记录](D:/Work/Live/tmp/general-components-audit/confirmation-escape-evidence.json)。

### 6. P2：折叠活动分组后，百宝箱可见功能没有 Tab 入口

位置：[toolbox-navigation.js:213](D:/Work/Live/public/js/admin/toolbox-navigation.js:213)、[toolbox-navigation.js:274](D:/Work/Live/public/js/admin/toolbox-navigation.js:274)、[toolbox-navigation.js:366](D:/Work/Live/public/js/admin/toolbox-navigation.js:366)。

当前功能所在组收起后，唯一 `tabIndex=0` 的功能按钮变成 hidden/inert；其他展开组的按钮仍全部 `tabIndex=-1`。用户只能经过组标题，无法用 Tab 进入可见功能。原内容面板继续保留是已有契约，不宜靠强制换页修复。

最小方向：每次组可见性变化后维护一个可见功能的键盘入口，同时保持当前内容；覆盖全部收起再展开的情况。

证据：复用现有 toolbox runtime fixture，折叠默认活动组后仍有 8 个可见功能，可 Tab 功能数变成 0，重新展开原活动组才恢复。此项是逻辑 fixture 复现，未做完整 Electron 导航操作。[详细记录](D:/Work/Live/tmp/general-components-audit/foundation.md)。

### 7. P2：折叠内容仍可获得焦点并激活

位置：[blindbox.js:403](D:/Work/Live/public/js/admin/gifts/blindbox.js:403)、[blindbox-stats.css:317](D:/Work/Live/public/css/admin/gifts/blindbox-stats.css:317)。

今日盲盒盈亏收起时只改变 class 和 `aria-expanded`，CSS 仅裁剪高度和隐藏画面。内部真实观众行仍 `tabindex=0`，Enter/Space 仍可打开分析。这是折叠行为的消费者接入问题，不涉及礼物计算。

最小方向：折叠 owner 同步容器 inert/可访问性隐藏状态，必要时先将内部焦点移回按钮；展开后恢复。

证据：Electron 43.2.0 使用真实页面片段和生产 CSS、合成观众行，从前置按钮按 Tab，焦点进入该行，此时容器高度 0、opacity 0、inert false。[运行记录](D:/Work/Live/tmp/general-components-audit/electron-runtime.json)、[不可见焦点截图](D:/Work/Live/tmp/general-components-audit/collapsed-focus-electron.png)。

### 8. P2：实心主按钮的内侧焦点环与填充重合

位置：[styles-base.css:325](D:/Work/Live/public/css/styles-base.css:325)。

当前未提交样式把通用按钮焦点环移到内侧 `outline-offset:-2px`。中性蓝和经典配色下，主按钮 hover 填充与焦点环完全同色；暖陶也非常接近。键盘聚焦“保存设置”等主操作时难以定位焦点。

最小方向：只为实心主按钮定义可辨认的焦点内环，或使用有间隔且不被容器裁剪的外环；无需连带改变输入框和其他导航的焦点规则。

证据：隔离 Electron 的生产样式中，focus-visible 保持为 true；中性蓝 hover 填充和 outline 均为 `rgb(35,79,181)`，经典均为 `rgb(180,35,24)`。色值与偏移来自 computed style。未以此声称完成全部渐变主题的像素验收。[运行记录](D:/Work/Live/tmp/general-components-audit/electron-runtime.json)。

### 9. P2：部分开关和配对数值框没有可访问名称

位置：[desktop-lyric-layout.html:16](D:/Work/Live/public/pages/admin/song/desktop-lyric-layout.html:16)、[desktop-lyric-layout.html:54](D:/Work/Live/public/pages/admin/song/desktop-lyric-layout.html:54)。

弹性动画等开关的可见标题位于 label 外，label 内只有 checkbox 和隐藏装饰；range/number 共用一个无 for 的 label 时，只标记了第一个控件。辅助技术无法辨别无名称 checkbox/spinbutton 的用途。主字体 select 还有同类接入问题。

最小方向：以稳定标题 ID 分别关联需要命名的输入；保留可见文案，只补 `aria-labelledby` 或正确 label。公共 CSS 不应推断业务名称。

证据：Electron 载入真实片段后，ARIA snapshot 中 checkbox 和 spinbutton 无名称，slider 有名称；主字体为源码路径确认。没有声称使用实体屏幕阅读器验证。[运行记录](D:/Work/Live/tmp/general-components-audit/electron-runtime.json)。

### 10. P2：点歌子标签只更新视觉选中，没有完整标签语义

位置：[song/shell-start.html:63](D:/Work/Live/public/pages/admin/song/shell-start.html:63)、[forms.js:40](D:/Work/Live/public/js/admin/forms.js:40)。

容器声明 `role=tablist`，子按钮却没有 tab 角色、`aria-selected` 或面板关联，点击只切换 active class。辅助技术无法取得当前选中标签，方向键也没有标签组行为；普通鼠标点击仍可工作。

最小方向：在现有标签拥有层补齐角色、选中态、面板关联及组内键盘行为。只增加动画不会修复状态表达。

证据：真实 HTML 与完整 `initTabs()` 调用路径的静态确认；本项未做屏幕阅读器或完整 Electron 标签组验收。

## 动画与体验建议

| 组件 | 建议 | 边界与理由 |
| --- | --- | --- |
| 问号帮助 | 适当扩大命中范围，评估短暂的离开宽限 | 当前 16px 锚点离开即关闭，长说明需要持续精确悬停。保持快速出现、无大幅位移；不是增加交互式内容面板。 |
| Switch、颜色输入 | 补齐 reduced-motion 下的位移/缩放替代 | [switch-control.css:43](D:/Work/Live/public/css/components/switch-control.css:43) 与 [color-control.css:21](D:/Work/Live/public/css/components/color-control.css:21) 没有相应分支；保留状态颜色与焦点反馈。 |
| 折叠面板 | 先修交互隐藏，再决定是否柔化退出 | 当前立即清零高度会裁掉退出淡出，但避免布局抖动是已有取舍。可评估短淡出再收起，不直接加长 max-height 动画。 |
| 长字体下拉 | 按实际字体列表长度评估前缀键入或搜索 | 目前已有方向键、Home/End；这是可选效率改进，没有证明现有菜单不可用。 |
| Toast | 保留现有动效与生命周期主体 | 去重/原位更新、悬停及焦点暂停、幂等退出、容量控制、动作一次执行、reduce 分支已有覆盖。未发现需要推倒重做的证据。 |

没有进行帧时间、GPU 或长期性能采样。因此没有将“使用布局属性过渡”直接认定为卡顿，也不建议未经测量添加 will-change、动画库或新的渲染层。

## 耦合、职责边界与代码规范

建议随对应缺陷修复做局部收敛，不安排无行为收益的全仓重构。

| 当前阅读或维护成本 | 最小调整方向 |
| --- | --- |
| [FormsService](D:/Work/Live/public/js/admin/forms.js:172) 同时拥有配对输入、点歌/歌单业务回填、主题和滚动规则；点歌板另有 controller 写同组字段 | 表单 owner 持有草稿、回填与保存策略；通用控件只负责输入交互和呈现。优先从本次出问题的歌单板收敛，复用已存在的 controller 约定。 |
| [toast.js:141](D:/Work/Live/public/js/shared/toast.js:141) 用 `gift-notify-toast` CSS 类名决定礼物队列上限、淘汰和播报 | 下次扩展通知类别时显式表达类别，并保留旧调用兼容。视觉类名不应隐式决定行为；目前调用一致，不作为独立 bug。 |
| [播放确认框适配](D:/Work/Live/public/js/playback/ui/components.js:374) 经 `window.AdminApp.utils` 获取已有 ESM 能力 | 修改该适配时改为具名 import，继续保留业务选项转换。当前 Admin 桥存在，不把遗留依赖本身当作失效。 |
| [导航](D:/Work/Live/public/js/admin/toolbox-navigation.js:288) 知道弹幕、AI 的具体初始化与激活时机 | 生命周期编排放在现有 app/toolbox lifecycle 组合处，导航消费窄回调；不另建服务或通用事件框架。 |
| `persist` 在部分导航函数中仅表示写 localStorage，与持久设置保存容易混淆 | 局部改成 `writeCache` 等表达实际职责的名称，保留公开设置键和行为。 |
| [app.md](D:/Work/Live/docs/reference/frontend/app.md:106) 的 toast 视觉描述、[主题保存描述](D:/Work/Live/docs/reference/frontend/app.md:169) 与当前实现/测试不一致 | 先确认已接受行为，再更新对应事实文档。点歌板显式草稿保存和歌单板旧自动保存需要分别说明；不能擅自按旧描述改回实现。 |

现有命名 ESM、局部工厂、WeakMap/WeakSet 生命周期、防重复初始化及主题 token 应继续保留。没有发现为了个人偏好统一语法、变量同义改名、大量拆文件或引入组件框架的必要性。

## 覆盖与验证

| 组件组 | 覆盖结果 |
| --- | --- |
| 问号、toast、确认框、字段错误、播放确认适配 | 检查拥有模块、CSS、消费者、入口注册、键盘、焦点及清理；问题 4、5；字段错误和 toast 未确认新缺陷。 |
| Select、range/number、switch、color、FormsService | 检查值同步、reset、重复增强/移除、观察器、比例/零点、主题状态及实际表单接入；问题 1、2、3、9。 |
| 按钮、文本输入、禁用/错误/焦点、客户端主题 | 检查公共样式、六套色板及预览别名、候选提交与失败路径；问题 8；未确认主题持久化新缺陷。 |
| 主导航、点歌子标签、百宝箱导航、折叠 | 检查真实拥有层、hash/选择状态、隐藏与 inert、键盘入口、reduced-motion；问题 6、7、10。 |
| 克隆与公共依赖 | 追踪模板、增强状态和真实生产入口。已排除“克隆已初始化控件后失效”为当前产品缺陷：生产 `/c` 从未增强的 template 克隆，旧 document 克隆路径未找到现行调用。 |

实际执行的既有聚焦检查共 **90 项通过、0 失败**：输入/选择 26 项，反馈/浮层 25 项，样式/主题/导航 39 项。包含源码契约、逻辑及隔离浏览器检查，不是 90 条完整应用端到端用例。命令和分组结果见 [控件报告](D:/Work/Live/tmp/general-components-audit/controls.md)、[反馈报告](D:/Work/Live/tmp/general-components-audit/feedback.md)、[基础报告](D:/Work/Live/tmp/general-components-audit/foundation.md)。

另执行真实模块的针对性复现、现有 `/c` 内存夹具验证，以及现有 `test/fixtures/danmaku-canvas-editor.cjs` 的隔离 Electron 43.2.0 检查。Electron 使用真实 preload、授权主进程 session 和生产 CSS，控件检查使用抽取的真实片段及合成数据，未将它当作完整桌面应用验收。未使用真实用户数据。

Impeccable 机械检测对本轮公共组件目标输出 `[]`；这不覆盖入口遗漏、状态竞争及组件组合问题。审查未运行全仓套件、未做实体读屏器/原生选色弹窗操作、全主题逐像素验收或性能压测。`git diff --check` 通过，工作区原有及并行改动保留。

本轮拥有的浏览器和 Electron 测试实例均已关闭。删除临时 Electron 数据目录时自动审批返回 `blocked by policy`，因此目录 `tmp/general-components-audit/electron-G80ok4` 保留；没有改用其他工具重试删除。

建议实施顺序：先修 1–3 的设置正确性，再修 4–7 的组件组合与键盘路径，最后统一补齐 8–10 的焦点/语义；可选动效与耦合调整随拥有层的小步修复进行。

## 复核与修复（2026-10-04）

**十项均有实际问题依据，不属于把个人偏好当缺陷的过度审查。** 第 1、3 项是同一表单拥有层的相关问题，不应为它们分别建立两套机制。可选动画、toast 分类、播放适配 import、导航生命周期和同义命名建议没有独立故障证据，本轮未扩展实施。

边界只做局部调整：`song-board-settings.js` 管理歌单板草稿呈现、配对输入和自动保存调度；`display.js` 组合已有 controller、设置同步及保存接口。复用现有 `component-config-controller`，没有新框架、事件层或服务。点歌板保留自己的 controller，FormsService 不再重复回填两张表单；共享控件只识别逻辑编辑组、消费自身键盘事件，不知道业务默认颜色或保存规则。

| 原条目 | 已实施结果 | 新验证 |
| --- | --- | --- |
| 1、3 | 输入立即进入草稿；保存串行处理，旧快照不覆盖新编辑；首屏统一回填全部 range/number，零值保留；预设/重置显式更新。补上共享 controller 在保存中“改回原值”的编辑代次保护。 | 新增歌单板真实 DOM 测试覆盖连续编辑、增强 select、旧快照、保存中编辑、失败重试、首次独立主题、预设和重置；controller 回归先复现失败后修复通过。 |
| 2 | 歌单板歌名色及点歌板歌名/点歌人色新增继承/自定义模式；继承保存空串，自定义黑色保留；不新增持久化键。 | 歌单板自动保存往返测试；Electron 点歌板两种颜色从继承切到黑色再切回。未操作原生选色弹窗。 |
| 4 | `/c` 入口导入现有 contextual-help。 | 既有 component-preview-browser 用例验证实际 hover、focus、Escape 和 tooltip 可见性。 |
| 5 | 确认框在 backdrop 消费 Escape；礼物清空按钮在确认执行后才禁用，取消时可恢复焦点。 | 真实模块回归和 Electron 均确认抽屉保持打开、焦点回到清空按钮、清空 API 调用数为 0。第二次 Escape 正常关闭抽屉。 |
| 6 | 每次分组显隐后维护一个可见功能的 Tab 入口，保留原内容面板。 | toolbox runtime fixture 覆盖依次全部收起、再全部展开，以及原活动项恢复。 |
| 7 | 折叠时同步 inert / aria-hidden，内部焦点移回按钮；展开恢复。 | 浏览器回归和 Electron 的实际 Tab 操作确认隐藏行不可进入、展开后可进入。 |
| 8 | 主按钮内环使用 `--color-on-primary`，与边缘保留内侧间隔。 | Electron 43.2.0 实测中性蓝、经典、暖陶的 hover + focus-visible：填充分别为 (35,79,181)、(180,35,24)、(141,75,55)，内环均为白色 2px，offset -4px；完整暖陶按钮截图确认。 |
| 9 | 桌面歌词各设置片段的同型开关和配对输入关联稳定标题，主字体使用真实 label。 | 页面组合无重复 ID；浏览器及 Electron ARIA snapshot 中相关 checkbox、spinbutton、slider 均有名称，增强主字体按钮名称为“主字体”。 |
| 10 | 现有标签 owner 补 role、选中态、单一 Tab 入口、面板关联、左右箭头及 Home/End。 | 浏览器和 Electron 验证选中态、内容面板、末端环绕和唯一 Tab 入口。 |

事实文档 [frontend/app.md](../reference/frontend/app.md) 已更正点歌板显式保存、歌单板自动保存、草稿同步及 toast 现有视觉描述。

验证结果：设置/控制器/导航/队列聚焦组 43 项通过；页面组合/色板/帮助/控件等组 42 项通过；`component-preview-browser` 5 项通过；新增 `song-board-settings` 3 项通过和 `shared-ui-interactions` 1 项通过；controller 变更的画布发布、模块依赖与 ESM 检查组 36 项通过（包含重复执行的 controller 用例，不相加为唯一用例数）。隔离 Electron 结果见 [运行记录](../../tmp/shared-ui-fixes/electron-results.json)，使用真实 preload 和授权 session、生产片段与 CSS、合成数据；这不代表完整应用端到端或实体读屏器验收。

全仓 JavaScript 语法检查通过。架构检查中的依赖、遗留全局和空 catch 门禁通过，原 display.js 的空 catch 额度随已移除代码一并删除；全仓文件大小门禁仍受本轮开始前已有的 `public/css/admin/toolbox/fan-profiles.css` 修改影响：648 行超过登记上限 647。本轮未改动该文件或放宽其基线。

`verify:docs` 10 项通过，最终 `git diff --check` 通过。新增测试、源文件及文档已复核；桌面歌词四个片段的差异仅为预期标签关联，既有与并行改动保留。Electron 实例已关闭；自动审批拒绝删除本轮 `tmp/shared-ui-fixes/electron-7J7ANW` 配置目录（`blocked by policy`），目录保留，未绕过限制重试。
