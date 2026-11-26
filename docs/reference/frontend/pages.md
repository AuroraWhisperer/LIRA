# 前端页面与入口清单

> 涉及文件：[pages/admin/](../../../public/pages/admin)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js)、[gift-audit.html](../../../public/pages/gift-audit.html)、[overlays/](../../../public/pages/overlays)、[js/admin/](../../../public/js/admin)、[js/playback/](../../../public/js/playback)、[js/overlays/](../../../public/js/overlays)、[js/shared/](../../../public/js/shared)、[css/](../../../public/css)、[img/](../../../public/img)

本文档是前端**页面清单**的单一事实来源：每个页面是什么、由谁打开、入口 URL 只在此成表。URL → HTML 的映射表（`pageMap`）归 [server-core.md](../backend/server-core.md) §4.3 维护，此处只列出面向使用者的入口语义。

管理后台没有单一 `public/pages/admin.html` 文件。HTML 分片位于 [pages/admin/](../../../public/pages/admin)，由 [server/admin-page.js](../../../src/server/admin-page.js) 组合，顺序由 [admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js) 保护。各功能页的业务交互、保存状态机与渲染细节分别归 [app.md](app.md) 与 [overlays.md](overlays.md) 维护。

### 客户端设置与外观

主窗口标题栏使用紧凑的应用图标，避免横向字标挤占导航空间。登录页和「系统与关于」使用本地打包的 [lira-wordmark.svg](../../../public/img/shared/lira-wordmark.svg) 文字字标，复用同一矢量图形；文字随当前表面前景色适配，粉色圆点保持品牌色。布局样式在 [lira-wordmark.css](../../../public/css/shared/lira-wordmark.css)，软件图标继续独立使用，不将横向字标裁成应用图标。安装协议页使用同一字形的 [installer-wordmark.bmp](../../../build/installer-wordmark.bmp)，按当前 Windows DPI 装载；安装窗口尺寸及独立完成页排版见[构建参考](../engineering/build.md)。

「百宝箱 → 设置」采用居中吸顶单行四段页签，包含「外观主题」「声音与通知」「账号与连接」「系统与关于」，由 [client-settings.js](../../../public/js/admin/client-settings.js) 管理切换与旧更新页选中项迁移。设置页通过片段 include 组合 [desktop-update.html](../../../public/pages/admin/toolbox/desktop-update.html)，不再提供单独的「桌面更新」侧栏项；更新通知直接打开「系统与关于」。外观主题页签使用宽画廊容器（最高 976px）：顶部为一体外观总控卡（左侧展示当前主题色点、名称、明暗与色阶条，竖线分隔右侧字体实时样字条与界面字体选择器），下方为「主题色板」5 列自适应卡片网格（附「全部 / 浅色 / 深色」筛选）；其余三个页签收束为居中单栏分组卡片（最高 776px），共享圆角表面卡、卡片外微标题与细分隔线。系统与关于将品牌标识、版本号、更新操作与自动更新开关融合为顶部主卡，下方按需显示资源下载任务和「本地数据与诊断」分组卡，底部居中放置无箭头的官网、用户协议与隐私政策入口；关于页使用本地打包的 [lira-app-icon.png](../../../public/img/shared/lira-app-icon.png)，桌面窗口也读取这一文件。「声音与通知」收纳「内置播放器输出」与「系统通知」两张分组卡片（大额礼物开启时原地展开门槛与快捷金额条；控件状态机见 [app.md](app.md#2-公共框架shared) 与 [preload](../desktop/preload.md#25-dailybotsfanprofiles-与-giftexport)）。

「账号与连接」中的「直播账号」跳转到客户端的「点歌 → 账号登录」页。「关联服务」在系统浏览器中打开网页主播中心、美术资源、礼物特效档案和网页小游戏，入口地址维护在 [settings.html](../../../public/pages/admin/toolbox/settings.html)。

「百宝箱 → 设置 → 外观主题」可分别选择界面字体与主题色板。在界面字体选择器中，「原界面」选项按本机正文可用的首选字族命名，例如「微软雅黑（原界面）」。选中后恢复各页面原有排版。如果正文只匹配到通用无衬线字体，名称显示为「无衬线体（原界面）」。

共享字体库中已就绪的霞鹜文楷、小赖字体和悠哉字体会以精简字名列在这里。每款都可以独立绘制中文、英文和数字，覆盖 GB 2312 的 6,763 个汉字、CJK 基本区及可打印 ASCII。选择框旁的中英数样字条在窄面板中折行展示。扩展区生僻字的覆盖取决于具体字库。字号、字重及直播素材的自有字体由各自页面维护。

十三套色板按「日间浅色」（9 套）与「夜间深色」（4 套）两组展示，支持「全部 / 浅色 / 深色」筛选：

- **浅色组（9 套）**：默认的暖陶（`terracotta`）、经典暖金、中性蓝、清白 · 翠光、雾苔 · 亚麻（`moss-linen`，亚麻白实色底、苔绿按钮与深橄榄文字）、烟粉 · 灰玫瑰（`dusty-rose`，灰粉实色底、灰棕文字与低饱和玫瑰色按钮），以及渐变主题玫瑰映光、梅雾 · 浅色和紫岚 · 浅色。
- **深色组（4 套）**：墨咖 · 香槟（`cocoa-champagne`，暖咖灰底、香槟色按钮与暖白文字）、玄黑 · 银红、梅雾 · 深色和紫岚 · 深色（梅雾为暖杏到玫瑰灰/深梅色渐变，紫岚为藕粉到灰蓝/灰紫到墨蓝渐变）。

[desktop/palettes.css](../../../public/css/desktop/palettes.css) 只提供作用域内颜色及兼容别名，选项小样通过 `data-client-theme-preview` 在自身作用域解析；独立工具仅加载色板，不加载拖拽等桌面壳规则。登录页、直播浏览器源、观众点歌页、歌词内容不接入客户端色板；盲盒与加班机专属内容保持独立配色，场景编辑器检查底色固定。点选保存与主题切换状态机见 [app.md](app.md#2-公共框架shared)，白名单与首帧底色见 [server-core.md](../backend/server-core.md) 与 [desktop/main.md](../desktop/main.md)。

## 1. 技术选型

| 事实 | 说明 |
| --- | --- |
| 语言 | 零框架 Vanilla JS（ES Modules + Classic Scripts），无构建工具、无 TypeScript |
| 样式 | 原生 CSS，按目录拆分，无预处理器 |
| 实时通道 | WebSocket 按权限投影的快照及领域增量消息（见 [comms.md](comms.md)、[ws.md](../backend/ws.md)） |
| 命令通道 | `fetch('/api/...')`（见 [comms.md](comms.md)、[api.md](../backend/api.md)） |
| 模块形态 | ES Module 带 `.js` 后缀的显式导入；Admin 由 `app.js` 通过具名导入和回调装配，原全局注册桥已退役 |

### 1.1 桌面 Admin 字体层级

桌面 Admin 的通用字体层级由 [styles-base.css](../../../public/css/styles-base.css) 中的设计令牌与 [admin/layout.css](../../../public/css/admin/layout.css) 中 `.app-shell` 范围内的语义角色共同维护。`styles-base.css` 仅声明设计令牌，不得添加直接作用于 `h1`、`p`、`small` 等原生标签的全局排版规则；页面和组件通过 `ui-*` 角色或组件自有的等价选择器读取这些值。

下表记录通用令牌的默认设计值，具体数值由样式模块按需调整；组件可在相应语义角色基础上调整展示尺寸。自动化测试保护令牌完整性、有效取值、字号层级和以下可读性/作用域边界，不在各页面重复冻结这些数值。用户配置的直播画面字号属于输入输出契约，仍须准确应用。

| 角色 | 默认字号 | 常用字重 | 用途 |
| --- | ---: | ---: | --- |
| display | 28px | 700 | 少量展示型标题 |
| page title | 24px | 700 | 主工作区与百宝箱功能页锚点 |
| section title | 18px | 700 | 面板、弹窗和主要内容分区 |
| card title | 15px | 600 | 卡片标题、歌曲名与 Toast 标题 |
| body | 14px | 400 | 正文、说明和普通状态文案 |
| control label | 13px | 600 | 表单标签、按钮和导航控件 |
| caption | 12px | 400 | 元数据、辅助说明和次级状态 |
| micro / eyebrow | 11px | 700 | 短标签、表头、状态徽标与英文小眉标 |

普通正文、帮助、错误与可操作说明不得小于 12px；11px 仅用于篇幅固定、极短的辅助文案。计时器、歌词、硬件数值、图表等数据展示区可使用组件自带的展示字号，但不能反向覆盖通用正文。常规字重限定为 400/500/600/700。

本字号体系仅适用于 Electron 桌面管理界面的外框与控件。`css/overlays/` 中除桌面外壳专用的 `overlays/desktop.css` 外，不使用 `ui-*` 或 `--type-*`；`/queue`、`/songlist` 继续读取持久化的叠加层字体与字号，`/lyrics` 和 Admin 歌词预览共用用户配置（基础使用 `--preview-*`，高级使用 `--advanced-*`）。共享字体目录与本机字体枚举见 §6 及 [app.md](app.md#10-共享字体与资源下载)（默认/跟随项置顶，样式默认项标「（默认）」，系统旧别名尽量回显，无法匹配时单列「当前设置」）。

### 1.2 组件工作区的桌面尺度

「组件」通过 [live-components.css](../../../public/css/admin/live-components.css) 有序加载工作区样式，由 [live-components/workspace.css](../../../public/css/admin/live-components/workspace.css) 读取并局部细化上述语义令牌；适用于组件设置页，不改变 OBS / 哔哩哔哩直播姬中的输出字号、素材比例或用户配置。侧栏负责标识当前页，右侧直接呈现操作与设置，不重复页名或功能介绍。

桌面双栏布局中，左侧「组件」标题与底部「打开画布」「素材管理」「使用指南」固定在侧栏两端，仅中间组件列表独立滚动并隐藏滚动条（「使用指南」定位到第 5 章「场景与素材」开头）。百宝箱双栏工作区由 [toolbox/shell.css](../../../public/css/admin/toolbox/shell.css) 维护布局（上/左/右外边距与栏间距均为 4px，侧栏隐藏滚动条，窄窗口沿用单栏）。

顶部入口命名为「组件」（悬停说明「组件 · 弹幕、礼物与直播画面设置」），图标 `nav-components.webp` / `nav-components-active.webp`（64×64 显示为 20×20，180ms 淡入淡出，开启「减弱动态效果」时取消过渡）。

设计依据核对于 2026-10-09：

- [Microsoft Fluent 2 Typography](https://fluent2.microsoft.design/typography)：原生系统字体、14/20 正文、Windows 20/28 副标题及分级字重。
- [Microsoft Fluent 2 Layout](https://fluent2.microsoft.design/layout)：4px 基础间距、邻近关系分组及按内容空间重排。
- [Fluent Field](https://fluent2.microsoft.design/components/web/react/core/field/usage/) 与 [Fluent Button](https://fluent2.microsoft.design/components/web/react/core/button/usage)：标签置于字段上方，主/辅操作区分视觉权重。
- [Fluent Tooltip](https://fluent2.microsoft.design/components/web/react/core/tooltip/usage/)：补充解释按需出现（复用 `lira-help` 问号组件）。
- [WCAG 2.2 SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)：选中与当前状态同时使用填充、竖条/选中环和字重，不只依靠颜色。
- [Adobe Spectrum Platform scale](https://spectrum.adobe.com/page/platform-scale/)：按鼠标桌面密度设计。

下表区分引用的尺度与 LIRA 的内容适配；除明确引用的字体尺度外，其余尺寸属于本项目的具体适配选择（单位均为 CSS 像素）：

| 对象 | LIRA 值 | 选择理由 |
| --- | --- | --- |
| 界面字体 | 默认正文 Segoe UI Variable Text，页标题 Segoe UI Variable Display，回退 Segoe UI 与 Microsoft YaHei UI / Microsoft YaHei | 自选字体就绪后，工作区正文与标题共用所选字族。用户素材预览使用自身字体。 |
| 页面定位 | 左侧选中导航项；右侧不另设同名标题 | `tabpanel` 通过 `aria-labelledby` 关联导航项，避免重复标题 |
| 顶部工具栏 | 控件高 36px（文本框普通按钮/下拉 32px，圆角矩形标签 ≥ 30px），组内 8px、组间 16px，底部留 16px 后接浅色细分隔线 | 同一任务的选择、状态与操作并排；空间不足按组换行（弹幕姬改用下方设置行卡片） |
| 分区标题 | 16px / 24px，600 | 基于 Fluent 16px 副标题，建立 16 / 14 / 12 三级层次 |
| 补充说明 | 相邻 `lira-help` 问号 | 规则与链接用法按需查看；单位、长度限制与保存状态直接显示 |
| 正文、按钮、字段标签 | 14px / 20px；正文/标签/输入值 400，按钮 500，选中项 600 | Fluent Body 1 尺度，输入框始终常规字重 |
| 辅助说明、状态 | 12px / 18px，400–500 | 保留 caption 尺度并留足中文行距，不压成 11px |
| 常规按钮、输入框、下拉框 | 最小高 36px；文字按钮水平内边距 12px | 20px 行盒 + 上下各 7px 内边距 + 边框，保持桌面密度 |
| 下拉框 | 由 `components/select-menu.css` 统一绘制：圆角 12px，单选为左侧 3px 竖条 + 主题底 + 600 字重（无对勾），多选（`.lira-multiselect`）用实心勾选框 | 参照 Fluent/Ant Design/Linear，单选不放对勾，选中色随十三套客户端外观切换，悬停与选中色分离 |
| 导航行 | 一级行 ≥ 40px，礼物姬子项 34px（缩进 24px），侧栏图标 20px、图文间距 12px | 导航承担持续定位，留足点击空间 |
| 弹幕姬分组与样式入口 | 上方「监控弹幕」「弹幕过滤」为 60px 设置行卡片；下方隔 24px 为「弹幕外观」，主页「最近使用」最多 4 款（80×52px 缩略图横向卡），右侧「全部样式」打开样式库 | 接收与外观分区清晰，常用样式可快速返回；样式库四组筛选采用高 30px 分段控件 |
| 侧栏 | 常规 184px（901–1100px 窗口 176px），底部「使用指南」下留 32px 避开播放器把手 | 收紧占宽为右侧留空间；选中态用填充 + 3px `--color-selection-marker` 竖条 + 600 字重（玄黑 · 银红竖条改用红色保证辨识） |
| 素材管理入口 | 集中在「组件」侧栏底部与画布顶部；弹窗宽上限 640px，直接以「已导入素材」开头，下接存储空间与备份恢复。每份备份的保存布局与发布快照合计最多 1,000 份，见[素材备份指南](../../guides/component-style-packages.md#主播怎么用) | 全局管理不混入单组件分类，分区 16/22px、正文 14/20px、间距 8/16/24px |
| 样式选择卡 / 折叠行 | 样式卡：2px 选中环 + 右上角「已选」徽标，「添加样式」为虚线透明框；折叠行 ≥ 56px（弹幕过滤 60px、参数组 44px），右侧显示状态摘要 | 收起时直接展示配置摘要；占位操作不喧宾夺主 |
| 外观效果参数 | 每项一行：104px 标签 + 主题色滑块 + 64px 数值框，最多两列（列间 40px，单列不足 340px 切单列） | 紧凑属性行减少纵向高度，滑块统一使用 `parameter-range` |
| 开关行 / 开播动画 | 开关行文字在前、开关在后；开播动画首行样式/状态/开关，次行可点击复制网址与预览，下方两列圆角框（< 760px 转单列） | 统一阅读方向，减少重复按钮和多层嵌套 |
| 工作区 / 内容区 | 双栏顶部与右侧外边距 4px、左侧及栏间 16px，面板内边距 24px（窄窗口 20px），正文填满可用宽度；字段间距 8/12/16px，分区 24px | 窗口放大时正文自适应展开，滚动条预留空间防跳动 |
| 弹幕/时钟卡片与双栏预览 | 弹幕卡 ≥ 208×152px（预览高 104px）；时钟卡 ≥ 152×64px（预览高 ≥ 192px）；设置/预览双栏预览宽 320px（≤ 880px 堆叠）；加班机计时 32/40px 等宽数字 | 保持素材辨识度、数字不抖动，空间不足自动重排 |

右侧主体随窗口高度填充并独立滚动；移动浏览器不是桌面设置页验收目标，已有窄窗口回退保留。通用操作按钮复用 `styles-base.css` 的 `.primary` / `.secondary` / `.danger` 变体（`.danger` 默认带主题危险色描边，不得用透明边框覆盖），按钮事件与业务逻辑归所属模块维护。需要次级按钮外观的导航链接可使用 `a.secondary`，链接在操作区内的对齐和内边距由面板样式控制。

### 1.3 可复制网址块

管理页和画布弹出的框状网址共用 `shared/copy-url.js` 的 `bindCopyUrl(button, options)` 与 `css/components/copy-url.css`。使用原生 `<button type="button" class="copy-url">`，写入完整网址后绑定；支持鼠标、Enter 和空格，长网址省略显示，悬停或聚焦提示完整地址，复制始终读取完整值。画布复制整场景时，在地址提示中显示已发布画布的宽高。选择共享组件并复制其原始地址时，才查询该组件的保存尺寸。见[直播场景来源](overlays.md#本地场景浏览器来源)。

- 默认读取 `textContent.trim()`；动态地址传 `getUrl()`，未就绪时由页面设置 `disabled`，空地址不复制。
- 复用 `utils.copyText` 的 Clipboard API 与 DOM 回退；可通过 `onCopied(url)`、`onError(error, url)` 覆盖提示。
- 重复绑定替换旧监听并返回解绑函数；`--copy-url-width` 默认 `100%`，`--copy-url-height` 默认 `36px`。

```html
<button id="sourceUrl" type="button" class="copy-url" style="--copy-url-width: 320px; --copy-url-height: 40px"></button>
```

```js
import { bindCopyUrl } from '../shared/copy-url.js';
const button = document.getElementById('sourceUrl');
button.textContent = url;
bindCopyUrl(button);
```

## 2. 入口 URL(唯一成表处)

所有页面均由后端 `servePageOrAsset` 提供（`pageMap` 见 [server-core.md](../backend/server-core.md) §4.3），响应 `Cache-Control: no-store`。

| 页面类别 | 凭据与用途 | 权限边界 |
| --- | --- | --- |
| 管理 HTML（`/`、`/admin`、`/settings`、`/songs`） | 需要本地管理凭据；Electron 主进程的 [desktop-request-auth.js](../../../src/electron/desktop-request-auth.js) 为受信主窗口主 frame 精确 origin 注入 Bearer | `?desktop=1` 仅切换表现；旧书签、手动浏览器打开或 `AUTO_OPEN_ADMIN=1` 不授予权限 |
| 登录页 `/license` | HTML 无需本地管理凭据，供 Electron 登录流程使用 | 浏览器可读页面不等于具备 preload 或设备会话；登录必须走受限 IPC |
| 场景编辑器 `/c#<短入口凭证>`（兼容旧 `/component-preview`） | 从「打开画布」「点歌 → 浏览器源 → 编辑场景」或组件预览入口经 Electron 外部导航在系统浏览器打开 | 无 preload 或管理凭据；通过单 fragment 短入口并行建立会话，由「保存并应用」发布 `127.0.0.1:<端口>/scene…` 正式来源，复制时取已发布画布尺寸（交互与协议见 [app.md](app.md#62-统一画布与本机样式库) 与 [预览 API](../backend/api.md#浏览器组件预览)） |
| 组件浏览器源目录 | 客户端「点歌 → 浏览器源」 | 提供直播场景及点歌板、时钟、加班机、本机弹幕姬（`/danmaku?source=component`）复制入口；旧服务器 `/overlay` 已退役；「网页页面」仅保留「我的网页歌单」，操作见[组件指南](../../guides/component-sources.md) |
| 本地展示页 | [access-policy.js](../../../src/server/access-policy.js) 的 `OVERLAY_PAGES` 定义权限范围；HTML 注入对应 scope 的叠加层访问凭证 | 仅可调用本 scope 允许的 HTTP/WS，无法取得管理权限；内部导出页（如 `gift-export`、`/weekly-schedule-export`）并非普通浏览器源 |
| 独立 Node 调试 | `npm start` 保留同一 HTML/API 鉴权，受保护调用须显式携带有效管理凭据 | 无 Electron preload、主进程 Device API 代理、分区登录与本地媒体协议 |

[servePageOrAsset](../../../src/server/page-assets.js) 对非展示、非登录、非组件预览 HTML 的匿名请求返回 401「请从桌面应用打开管理页面。」；API 无效凭据返回 401，越权或不受信 Origin 返回 403。时钟的客户端和画布参数由 [clock-preview.js](../../../public/js/admin/clock-preview.js) 共用绑定，并通过 [component-parameter-fields.js](../../../public/js/shared/component-parameter-fields.js) 保护正在编辑的字段。


| 入口 URL | 实际 HTML | 打开者 | 行为说明 |
| --- | --- | --- | --- |
| `/admin` | [pages/admin/](../../../public/pages/admin) 分片经 [server/admin-page.js](../../../src/server/admin-page.js) 组合 | Electron 主窗口；带有效管理凭据的调试调用 | 管理后台：点歌/播放/礼物/组件/百宝箱五个主页面；`#playback`/`#gifts`/`#components`/`#other` hash 直达对应主页面 |
| `/admin?desktop=1` | 同上 | Electron 主窗口（[desktop/main.md](../desktop/main.md)） | [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前写入 `html.desktop-shell` 类（防闪烁），显示标题栏拖拽区与窗口控制按钮；退出后展示桌面版重启屏 |
| `/settings` | 同上 | Electron 管理页兼容路径（需管理凭据） | 历史兼容入口，落到管理后台默认页（点歌） |
| `/songs` | 同上 | Electron 管理页兼容路径（需管理凭据） | 同上，兼容入口 |
| `/weekly-schedule-export` | 周表内部导出页 | Electron 主进程内部渲染 | 仅用于桌面周表 PNG 导出，由 [page-assets.js](../../../src/server/page-assets.js) 验证管理凭据，不是普通浏览器源，不注入叠加层凭证。见[周表生成器](app.md#周表生成器)和[周表 PNG 导出选址](../desktop/main.md#周表-png-导出) |
| `/background` | [overlays/background.html](../../../public/pages/overlays/background.html) | 场景内背景组件、浏览器源 | 背景样式由场景配置决定（默认无背景，月渡花汀需导入套装）；使用沙箱组件协议，无业务凭据或数据连接 |
| `/imported-danmaku` | [overlays/imported-danmaku.html](../../../public/pages/overlays/imported-danmaku.html) | 导入弹幕 CSS 的预览与场景子页面 | 兼容 blivechat/BLC 消息结构，CSS 与数据经组件协议进入，保持不透明源沙箱，无独立 B 站连接 |
| `/queue` | [overlays/queue.html](../../../public/pages/overlays/queue.html) | 浏览器源、独立浏览器窗口 | 点歌队列叠加层，透明背景（见 [overlays.md](overlays.md#2-队列叠加层queue)） |
| `/songlist` | [overlays/songs.html](../../../public/pages/overlays/songs.html) | 浏览器源 | 歌单展示板叠加层，支持 `?category=` 过滤 |
| `/blindbox` | [overlays/blindbox.html](../../../public/pages/overlays/blindbox.html) | 浏览器源 | 盲盒盈亏投屏，支持 `?top=`/`winners=`/`heartBox=`/`title=` 参数覆盖；固定地址沿用已保存设置 |
| `/overtime` | [overlays/overtime.html](../../../public/pages/overlays/overtime.html) | 浏览器源、管理页预览 `<iframe>` | 加班机叠加层，支持 `?quality=low`（降帧/降动画） |
| `/gift-effects` | [overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html) | 浏览器源、管理页预览 | 礼物掉落/摇摇乐、林间花信边框、官方特效与大航海感谢叠加层，平时透明（见 [overlays.md](overlays.md#14-礼物四方边框gift-effects)） |
| `/gift-sprint` | [overlays/gift-sprint.html](../../../public/pages/overlays/gift-sprint.html) | 浏览器源、管理页预览 | 月底冲刺横幅（默认透明底，建议 600×80，`preview=1` 显示预览底色）；WS 快照驱动，断线清空旧数字 |
| `/gift-wishes` | [overlays/gift-wishes.html](../../../public/pages/overlays/gift-wishes.html) | 浏览器源、管理页预览 | 礼物许愿叠加层（建议宽 440，`period=long\|day\|session` 筛选周期，`preview=1` 显示底色）；每 3 秒读取服务端进度，来源变化清空旧展示 |
| `/heart-box-collection` | [overlays/heart-box-collection.html](../../../public/pages/overlays/heart-box-collection.html) | 浏览器源、管理页预览 | 每周心动盲盒收集任务（`displayStyle=task\|compact`，任务卡支持五种 `backgroundStyle`，`showRewards=false` 隐藏奖励，见 [overlays.md](overlays.md#心动盲盒收集组件)） |
| `/lyrics` | [overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html) | 浏览器源、独立浏览器窗口 | 基础多行／高级构图共用输出；管理页按页签复制 `?layer=basic\|advanced`，旧合并地址保留兼容（见 [overlays.md](overlays.md#6-直播歌词页lyrics)） |
| `/danmaku` | [overlays/danmaku.html](../../../public/pages/overlays/danmaku.html) | 浏览器源、管理页预览 `<iframe>` | 本机 `/danmaku?preview=1` 用于编辑预览，`/danmaku?source=component` 与场景输出使用当前授权账号的本地外观（旧服务器 `/overlay` 已退役）；完整样式与参数见 [overlays.md](overlays.md#61-弹幕姬) |
| `/interactions` | [overlays/interactions.html](../../../public/pages/overlays/interactions.html) | 只读浏览器源、管理页预览 | 弹幕投票与观众评分叠加层（推荐 800×600，详见 [overlays.md](overlays.md#投票与评分-interactions)） |
| `/games` | [overlays/games.html](../../../public/pages/overlays/games.html) | 浏览器源、独立浏览器窗口 | 直播小游戏叠加层（数字炸弹/五子棋/你画我猜单会话互斥，画猜 16:9 画布与 6 种工具，题词仅在 Admin 主持区显示；旧 `?game=` 不再决定游戏） |
| `/wheel` | [overlays/wheel.html](../../../public/pages/overlays/wheel.html) | 浏览器源、独立浏览器窗口 | 独立抽奖转盘叠加层，圆形外透明，不参与 `/games` 会话互斥 |
| `/opening` | [overlays/opening.html](../../../public/pages/overlays/opening.html) | 浏览器源、管理页预览 | 固定开播画面地址，读取已保存的文案、动画、画质与音乐设置 |
| `/clock` | [overlays/clock.html](../../../public/pages/overlays/clock.html) | OBS/直播姬浏览器源、管理页预览 `<iframe>` | 固定时钟地址，支持逐字段 URL 参数覆盖（见 [overlays.md](overlays.md#63-时钟clock)） |

保留的旧诊断页面（无 URL 映射，未接入当前桌面授权入口）：

| 路径 | 页面 | 打开者 | 说明 |
| --- | --- | --- | --- |
| `/pages/gift-audit.html` | [gift-audit.html](../../../public/pages/gift-audit.html) | 专用授权测试上下文 | 历史礼物审计源码，不分发到安装包；详见 [app.md](app.md#9-子页面gift-audithtml) |

注：实时榜单（「组件 → 实时榜单」，`live-components/live-rankings.html`）、歌曲信息（`live-components/now-playing.html`）、文本框等均为场景内组件，通过已保存的独立组件地址或场景地址输出（内部 `/live-rankings` 不直接返回榜单数据）；周表生成器（`toolbox/weekly-schedule.html`）、粉丝档案（`toolbox/fan-profiles*.html`）、电音助手（`toolbox/audio-assistant.html` + `shared/audio-assistant.html`）及礼物姬六子页（`toolbox/gift*.html`、`live-components/gift-sprint.html`、`blindbox.html`、`heart-box-collection.html`）均沿用 `/admin`，不新增公开页面或浏览器源。

## 3. 页面清单（每个页面一行）

**Admin 使用文档（`toolbox/usage-guide.html`）结构与交互**：

- **章节与片段组合**：保留面板、目录容器与搜索入口，正文依次为安装账号与连接、点歌与播放、弹幕与互动、礼物记录与分析、场景与素材、粉丝档案与工作台、软件维护与数据、Q&A 八章。主章用 `.usage-guide-section`，模块用直属 `h4`，操作文章保留 `article` 与 `.usage-guide-feature-head strong`；`usage-guide.js` 从各章直属 `h4` 生成次级目录（保留既有 `ug-*` 锚点，不收录第三级标题）。`usage-guide-features.html`、`usage-guide-toolbox.html`、`usage-guide-obs.html` 分别组合对应章节，由 `src/server/admin-page.js` 递归展开白名单片段、拒绝循环引用并缓存。
- **双目录与正文排版**：横向顶部目录按八章分四/两/一列，与导航条无间隙衔接（面板高度上限为窗口 32%）；侧边目录固定左侧、透明底色、隐藏滚动条且滚动不传递至正文（章节编号不补前导 0）。正文采用 26/22/18/16px 标题与正文、13px 图注，模块标题 `h4` 带 4px 主题色竖条；分隔分三级（章首「第 N 章」双线、同列表文章间菱形细线、步骤间圆点线）。常规截图最大宽 520px，点击或 Enter/空格打开原生 `<dialog>` 大图。
- **指南跳转**。`usage-guide.js` 统一处理目录、正文链接、搜索、上下章和功能页的 `[data-usage-guide-link]`。从功能页进入时，`app.js` 的 `showGuide` 先选中百宝箱的使用文档。定位前展开目标所在的折叠段，恢复章节懒布局后再次对齐。新跳转取消旧定位。
- **动效、进度与搜索**。`usage-guide-motion.js` 在单视口内用 160–300ms 减速滚动，远距跳转用 80ms 淡出、定位和 160ms 淡入，开启「减弱动态效果」时直接定位。右下角 `.usage-guide-floating-actions` 合并「返回跳转前的位置」与「返回顶部」。`usage-guide-progress.js` 展示当前章、小标题与滚动百分比，`usage-guide-layout.js` 协调侧栏收放时的视图快照过渡，`usage-guide-search.js` 分别索引标题、段落、文章、问答与步骤并高亮首个匹配项。

| 页面 | 文件 | 类型 | 内容 |
| --- | --- | --- | --- |
| 管理后台 | [pages/admin/](../../../public/pages/admin) 分片 + [server/admin-page.js](../../../src/server/admin-page.js) | ES Module + 显式依赖 | 点歌/播放/礼物/组件/百宝箱五主页面 + 状态条 + 窗口控件 |
| 礼物审计 | [pages/gift-audit.html](../../../public/pages/gift-audit.html) | [gift-audit/index.js](../../../public/js/gift-audit/index.js)（ES Module） | 粘贴气泡数据、读取授权诊断记录并比较差异，不重放事件 |
| 队列叠加层 | [pages/overlays/queue.html](../../../public/pages/overlays/queue.html) | ES Module（`js/overlays/queue.js`） | 点歌队列滚动展示（六种内置风格） |
| 歌单叠加层 | [pages/overlays/songs.html](../../../public/pages/overlays/songs.html) | ES Module（`js/overlays/songs.js`） | 可点歌单展示，虚拟滚动 + 按时长/字母分组 |
| 盲盒叠加层 | [pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html) | ES Module（`js/overlays/blindbox.js`） | 盲盒盈亏汇总与排行榜 |
| 加班机叠加层 | [pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html) | ES Module（`js/overlays/overtime.js`） | 直播加班倒计时 + 送礼加班表 + 结算动画 |
| 礼物特效叠加层 | [pages/overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html) | ES Module（`js/overlays/gift-effects.js`） | 礼物掉落/摇摇乐、林间花信边框、官方特效及大航海感谢（见 [Overlay 模块边界](overlays.md#overlay-模块边界)） |
| 礼物冲刺/许愿/心动收集 | `overlays/gift-sprint.html` / `gift-wishes.html` / `heart-box-collection.html` | ES Module | 月底冲刺横幅、三周期礼物许愿（含月渡花汀与文字版）及每周心动盲盒收集任务 |
| 直播歌词页 | [pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html) | ES Module（`js/overlays/lyric-window.js`） | 完整时间轴、当前行高亮、逐字进度、翻译/罗马音与自动跟随 |
| 弹幕姬叠加层 | [pages/overlays/danmaku.html](../../../public/pages/overlays/danmaku.html) | ES Module（`js/overlays/danmaku.js`） | 多样式弹幕叠加层，固定/随机/横栏样式与 B 站表情渲染 |
| 投票与评分叠加层 | [pages/overlays/interactions.html](../../../public/pages/overlays/interactions.html) | ES Module（`js/overlays/interactions.js`） | 弹幕投票与观众评分只读叠加层 |
| 游戏叠加层 | [pages/overlays/games.html](../../../public/pages/overlays/games.html) | ES Module（`js/overlays/games.js`） | 数字炸弹/五子棋/你画我猜共享会话与绘画弹幕气泡 |
| 转盘叠加层 | [pages/overlays/wheel.html](../../../public/pages/overlays/wheel.html) | ES Module（`js/overlays/wheel.js`） | 独立抽奖转盘，按配置份数绘制并突出结果 |
| 开播画面叠加层 | [pages/overlays/opening.html](../../../public/pages/overlays/opening.html) | ES Module（`js/overlays/opening.js`） | 读取已保存的开场文案、动画、画质和音乐设置 |
| 时钟叠加层 | [pages/overlays/clock.html](../../../public/pages/overlays/clock.html) | ES Module（`js/overlays/clock.js`） | 按已保存样式显示本地时间、可选日期与星期 |

### 使用文档跳转维护规则

更新 `public/pages/admin/toolbox/usage-guide*.html` 时，链接落点与正文一起维护：

- 正文互链和其他页面进入文档的入口，使用表示内容含义的固定 `ug-*` ID（如 `ug-wesing-lyrics`）。ID 属于对应内容，移动章节或修改标题、编号时保留并随内容迁移，不留在旧位置，也不复用于另一项功能。
- 目录为无 ID 的 `h4` 自动生成的 `章节ID-subsection-序号` 仅用于当前页面的目录导航；插入或调整小节后序号会变化，不能作为正文或其他页面的固定引用。需要被引用的小节先在 HTML 中设置唯一、固定的语义 ID，再链接到它。
- 操作说明链接指向能回答该问题的具体小节或文章；章概览链接才指向大章。内容拆分、合并或删除时，搜索旧 ID 的全部引用，逐一核对目录、正文、快捷入口和其他页面的入口文案与目标内容；不要只确认 ID 仍存在。保留有明确对应内容的旧锚点，避免产生重复 ID。
- 受影响的入口统一复用 `usage-guide.js` 的定位流程，不另写固定像素位置或按章节序号定位。检查目标标题首行是否出现在目录条下方；搜索命中、折叠内容及其他页面进入文档也要核对实际落点。涉及布局或滚动逻辑时验证顶部目录和侧边目录两种模式，文档末尾允许因滚动空间不足无法贴齐，但目标必须可见。
- 复用 `test/admin/frontend-usage-guide-search-browser.test.js` 的内部链接目标唯一性检查；章节归属、链接含义与定位效果由修改者实际阅读和查看确认。新增或修正固定入口时，按受影响行为更新对应断言。自动检查不能判断所有链接文案与正文是否相符，修改者仍需阅读目标内容；修改当前 Markdown 说明后运行 `npm run verify:docs`。

## 4. JS 模块地图

### 4.1 管理后台 `public/js/admin/`（ESM 入口、显式依赖与按需加载）

| 文件 | 职责 | 文档 |
| --- | --- | --- |
| `index.js` | 常驻 ESM 入口；按需模块与初始化归属见 [app.md](app.md) §3 | [app.md](app.md) |
| `contextual-help.js` | 注册 `<lira-help>` 问号说明组件（顶层 Popover，仅承载可选解释，不得隐藏状态/校验/警告） | 本文 §5 |
| `app.js` | 应用启动：导航初始化、播放助手桥接、WebSocket 连接 | [app.md](app.md) §3 |
| `state.js` | `StateService` 单例：状态快照 + WS 客户端 + `/api/state`/`/api/songs` 加载 | [comms.md](comms.md)、[app.md](app.md) §2 |
| `queue.js` / `superchat.js` | 分别负责点歌队列与 SC 渲染、操作、撤销与释放，复制和滚轮共用 `queue-list-view.js` | [app.md](app.md) §4 |
| `state-renderer.js` | 按快照变化调度视图、回填普通设置；独立表单草稿由所属控制器维护 | [app.md](app.md) §2 |
| `component-preview-elements.js` / `component-preview-surface.js` | 分别负责预览基础 DOM/SVG 工具与 iframe 生命周期，调用方按需导入 | [app.md](app.md) §2 |
| `songs.js` | 歌库表格、筛选（曲风/语言/歌手/标签）、编辑/入队/删除 | [app.md](app.md) §4 |
| `settings.js` | 设置表单、Bilibili 登录、清库、盲盒映射、退出/重连；账号中心只读展示账号与设备 | [app.md](app.md) §4 |
| `theme.js` / `display.js` | 点歌板主题（六套样式、预设与一键美化）与展示板（歌单板）配置 | [app.md](app.md) §4 |
| `forms.js` | 通用 `range` ↔ `number` 绑定、参数滑块刷新和选项卡 | [app.md](app.md) §2 |
| [player-workspace.js](../../../public/js/admin/player-workspace.js) | `PlayerWorkspace`：播放器全屏、dock 展开/收起、快捷键、焦点与联动关闭 | [app.md](app.md) §2 |
| `song-import.js` / `song-import-parser.js` / `cloud-song-sync.js` / `song-background.js` / `song-background-image.js` | 歌单文件/粘贴解析、云端歌单同步、网页歌单开关与歌单页背景 WebP 压缩缓存 | [app.md](app.md) §4 |
| `metrics.js` | 系统性能检测（`/api/system/metrics` 5 秒采样与本机硬件信息） | [app.md](app.md) §4 |
| `danmaku-tool.js` | 弹幕工具组合入口：连接状态与发送、本机弹幕外观/过滤及 `danmaku-overlay-settings.js` 画布预览 | [app.md](app.md) §6 |
| `danmaku-tabs.js` / `danmaku-libraries.js` / `danmaku-cloud-replies.js` / `danmaku-scheduled-library.js` / `danmaku-interaction-thanks.js` | 弹幕互动四分类导航、两类自定义回复、云端精确/定时回复、点赞/分享/关注感谢与签到/抽签（`danmaku-daily-library.js`） | [固定回复与云端词库](app.md#固定回复与云端词库) |
| `danmaku-fixed-replies.js` / `danmaku-editor-pagination.js` / `danmaku-viewer-names.js` / `danmaku-query-replies.js` / `danmaku-welcome*.js` / `danmaku-pk-report.js` | 以 `#otherDanmakuFeature` 为事件根的右侧单活动编辑 dialog、高度自适应分页、昵称管理（每批 20 人与黑名单）、查询回复、四页签进场欢迎及 PK 播报与欢迎 | [固定回复与云端词库](app.md#固定回复与云端词库)、[桌面欢迎设置](../desktop/main.md#服务器进场欢迎设置)、[PK 播报与欢迎](../desktop/main.md#pk-播报与欢迎) |
| `danmaku-gift-thanks.js` / `gift-thanks-library.js` / `gift-thanks-text-editor.js` | 礼物及三档大航海候选文案、普通／@ 切换、原子中文参数块与预览 | [app.md](app.md) §6 |
| `ai-assistant-settings.js` / `ai-assistant-config-view.js` / `ai-assistant-personas.js` | AI 互动助手：模型配置、自动保存、角色包管理与可选工具开关 | [app.md](app.md) §6 |
| `overtime.js` | 加班机控制台、初始时间、礼物规则与背景；礼物选择与图片 key 内聚于 `overtime-gift-picker.js` | [app.md](app.md) §6 |
| `streamer-planner.js` / `streamer-planner-view.js` | 主播工作台的本机存储、日程和提醒。页头与日历按同一日期刷新。日程写入成功后才更新视图并同步系统提醒 | [app.md](app.md) §6 |
| `toolbox-navigation.js` | 组件与百宝箱共用导航（独立实例与记忆项，不承载业务） | [app.md](app.md) §6 |
| `desktop-lyric.js` / `desktop-lyric-preview.js` / `advanced-lyric-editor.js` / `now-playing.js` | 音乐展示：直播歌词基础/高级设置、实时预览与歌曲信息设置 | [app.md](app.md#6-组件与百宝箱) |
| `live-rankings.js` / `interactions.js` | 实时四榜查看与画布入口；弹幕投票与观众评分编辑器（复用 `shared/interaction-rules.js`、`interaction-client.js`、`interaction-view.js`） | [app.md](app.md#6-组件与百宝箱) |
| `start-animation.js` / `clock-card.js` | 开播动画与时钟固定地址、样式设置与预览 | [app.md](app.md) §6 |
| `fans/` / `audio-assistant.js` / `weekly-schedule.js` / `world-clock/` / `pk-score-calculator.js` | 粉丝搜索与分类复用有效到期徽标。周表保留本机字体名，默认目录不可用时可另选导出位置。世界地图按本机整点更新天气，城市按钮支持读屏，8K 日图失败时使用随包日图。PK 算分接受三位分组金额。电音助手按需加载 | [粉丝档案](../../../specs/fan-profiles.md)、[周表](app.md#周表生成器)、[世界地图](app.md#世界地图)、[PK 算分](app.md#61-pk-算分) |
| `song-library-filters.js` | 曲风/标签多选、语言/歌手筛选与多选弹层定位 | [app.md](app.md) §4 |
| `gifts/index.js` / `notification.js` / `detection.js` / `sprint.js` / `recent.js` / `blindbox*.js` / `history.js` / `wishes.js` / `heart-box-collection.js` | 礼物面板渲染、通知/检测/冲刺/最近/盲盒映射与分析/历史抽屉/许愿/心动盲盒 | [app.md](app.md#5-礼物主页面gifts) |

- Admin 登录、房间资料、粉丝档案及礼物/弹幕/游戏头像共用 [shared/bilibili-avatar.js](../../../public/js/shared/bilibili-avatar.js) 校验与构造 B 站头像地址（仅接受 HTTPS `.hdslb.com` 子域且禁止 URL 凭据，查询参数经 `URLSearchParams` 编码）。
- `admin/canvas-item-entry.js` 负责样式库、大航海感谢、礼物动效及实时榜单的查找与插入画布公共流程（`MAX_NON_TEXT_BOX_SCENE_ITEMS` 仍为 32，已有图层可在满画布时复用）；`admin/rich-text-selection.js` 仅负责三个富文本编辑器的 DOM Range、原子边界与格式替换。
- 共享小工具按合同复用：`shared/tab-navigation.js`（ARIA 选项卡）、`json-response.js`（解析与 API 判错）、`json-request.js`（礼物 feed/许愿超时与 signal 清理）、`bilibili-guard-labels.js`（中文等级映射）、`dom-element.js`（纯文本节点工厂）、`string-hash.js`（按 Unicode 码点迭代的 FNV-1a）及 `display-format.js`（金额格式化）。

### 4.2 播放助手 `public/js/playback/`（纯 ES Module）

播放页内的「播放器外观」由 `pages/admin/playback/appearance.html`、`js/playback/ui/appearance.js` 和 `css/playback/appearance.css` 负责，入口及本机偏好见[播放器外观契约](playback.md#81-大播放器外观)。

入口链 `admin/app.js` → `playback/index.js` → `playback/controller.js`（组合根），使用显式导入和回调接线。模块树：`core/`、`state/`、`provider/`、`player/`、`queue/`、`services/`、`features/`、`operations/`、`ui/`、`content/`、`local/`、`cache/`、`config.js`、`utils.js`，逐模块说明见 [playback.md](playback.md)。

### 4.3 叠加层 `public/js/overlays/`

| 文件 | 说明 |
| --- | --- |
| `overlay-utils.js` | 队列、盲盒、歌单板和主题适配直接导入的 ES 模块。转义和字体回退复用 `shared/`，并提供覆盖层的颜色转换、滚动时长与低功耗判定 |
| `song-virtual-scroller.js` | 歌单虚拟滚动器（环形 DOM 窗口） |
| `queue.js` / `songs.js` / `blindbox.js` / `overtime.js` / `lyric-window.js` / `interactions.js` | 各叠加层逻辑，详见 [overlays.md](overlays.md) |
| `games.js` | 直播小游戏入口与会话渲染；绘画工具与笔画清理归 `games-drawing.js`，结果窗归 `games-result.js`；通过 `danmaku-feed.js` 显式 ESM 接口读取你画我猜弹幕 |
| `opening.js` | 开播动画浏览器源：读取本地配置与用户上传人物图/音乐，驱动人物待机与轨道动画 |
| `clock.js` | 时钟浏览器源：读取已保存配置并兼容 URL 参数覆盖，按本地秒边界更新时间/日期并在页面隐藏时暂停调度 |
| `danmaku-feed.js` / `danmaku-message-renderer.js` / `danmaku-renderer-core.js` / `danmaku-superchat-renderer.js` | feed 负责队列、布局与过期清理；renderer 适配桌面策略，core 为公共消息 DOM 源码快照，委托 SC 渲染器处理价格配色与卡片；图片解析由调用方传入 |
| `danmaku-random-entrance.js` / `danmaku-floating.js` | 随机入场适配器与横移飘窗 feed；`danmaku/random-entrance.css` 与 `floating-motion.css` 管理共用入场和边缘遮罩，专属分层动效由款式模块维护 |

### 4.4 共享与入口 `public/js/`

| 文件 | 说明 |
| --- | --- |
| `shared/utils.js` | 具名 UI/请求工具导出（见 [comms.md](comms.md) §2） |
| `shared/copy-url.js` | 框状网址的原生按钮交互、完整地址提示、复制反馈与监听清理（见本文 §1.3） |
| `shared/event-bus.js` | `EventBus` 单例 + `Events` 常量（见 [app.md](app.md) §2） |
| `shared/logger.js` | `Logger` 单例，调用方显式导入 |
| `shared/theme.js` | 主题配置加载（`/data/theme-presets.json`）与预设访问器 |
| `shared/lyric-word-renderer.js` | 逐字歌词渲染器（rAF 驱动，WeSing 面板/直播歌词预览/歌词窗口共用） |
| `shared/parameter-range.js` | Admin 参数滑块进度与零点区段同步（隐藏参数不读布局，显示后由 `ResizeObserver` 更新；`data-range-scale="balanced"` 为零点两侧各留 ≥ 25% 行程）。点歌板和展示板通过 `bindRangeNumber(range, number, displayScale = 1)` 关联数字框，输入有效时同步，确认时按滑块的 `min`、`max`、`step` 校正。倍率 `100` 将 0–1 的透明度显示为百分数。返回函数用于解绑。 |
| `shared/color-picker.js` / `shared/color-value.js` / `shared/color-control.js` | 统一选色弹层（桌面优先[全屏取色桥](../desktop/preload.md)，支持模态挂靠与一步撤回）、HEX/Alpha 解析，以及 `enhanceColorControls` 原位增强（`data-color-opacity` 关联不透明度字段） |
| `shared/select-menu.js` | `enhanceSelects(root = document)` 将原生单选 `select` 增强为顶层 popover 弹层（`components/select-menu.css`），并支持名称搜索与字体预览（细则见表下） |
| `shared/fit-text-to-width.js` | `fitTextToWidth(elements)` 按元素可用宽度收缩字号（礼物横幅与粉丝档案名单共用） |
| `desktop.js` | 桌面外壳：更新检查/下载/安装、打开数据目录、`window.songAssistantDesktop` 检测 |
| `license-resource-downloads.js` | 首次准备页的公共字体/大图内联进度与失败说明（见 [app.md](app.md#10-共享字体与资源下载)） |

**`shared/select-menu.js` 行为细则**：

- **定位与事件**：单选弹层保留 DOM 归属并使用顶层 popover（复用 `shared/select-menu-position.js` 的 `positionSelectMenu`），按触发框宽度（`--select-trigger-width`）、窗口边界与上下空间限高滚动，外层滚动或缩放时关闭；展开后派发可冒泡的 `lira-select-open` 供调用方按需刷新选项。原生 `select` 动态禁用时同步关闭已展开菜单；`option.disabled` 占位项不可选且不自动选中首项，`optgroup` 写入 `data-label` 展示组名。
- **搜索、字体预览与多选**：单选可通过 `data-select-search` 启用名称搜索、通过 `data-select-font-preview` 预览字体（直接展开无淡入，预览行用 `content-visibility: auto` 避免展开时全量同步排版）；可在 `.lira-select` 设 `--select-marker-display: none` 隐藏左侧竖条。多选保留 `.lira-multiselect` 的 details/checkbox 结构，由 `song-library-filters.js` 的 `bindFilterMenuPopovers` 接入顶层 popover。
- 菜单、搜索和键盘选择都遵循原生 `option.hidden` 与 `optgroup.hidden`。隐藏当前项时，触发框继续显示已选值，直至用户另选或页面更新该值。场景编辑器用此方式限定当前资源样式的候选项。

## 5. CSS 清单

管理主窗口在 `shell-start.html` 引入 `components/drawer.css`。礼物和播放抽屉组合 `.ui-drawer` 系列类，共用几何与过渡，各自控制尺寸、层级和遮罩。`styles-base.css` 和可单独加载的弹幕预览都引入 `shared/visually-hidden.css` 的完整 `.sr-only` 规则。基础样式提供菜单入场及 `ui-spin`。原生 dialog 的遮罩由 `admin/layout.css` 读取主题的 `--color-bg-overlay-light`。`admin/toasts/system.css` 提供统一图标徽章、自适应尺寸与右侧竖线分隔操作区，富信息业务 Toast 自动获配语义图标并可按需覆盖 `--toast-icon`。播放歌单选择器使用 `div[role="dialog"]`，布局归 `playback/playlist-picker.css`。独立桌面歌词窗口直接加载 `playback/desktop-lyric.css`，管理端富文本工具栏经 `styles-admin.css` 统一加载。

- `css/admin/gift-display.css` 按序加载 `gift-display/common.css`、`history.css`、`export.css`、`settings.css`。
- `css/admin/live-components.css` 按序加载 `live-components/workspace.css`、`controls.css`、`danmaku-settings.css`、`danmaku-library.css`、`panels.css`、`clock.css`。
- `css/admin/toolbox/danmaku-fixed-replies.css` 按序加载 `danmaku-fixed-replies/workspace.css`、`thanks.css`、`query.css`、`welcome.css`、`editor.css`、`libraries.css`（基础样式仍在 `toolbox/danmaku-editors.css`）。
- `css/playback/appearance.css` 加载 `appearance/settings.css`（设置表单）与 `appearance/rendering.css`（预览与实际播放器共用渲染，契约见[大播放器外观](playback.md#81-大播放器外观)）。

| 文件 | 职责 |
| --- | --- |
| `css/styles-base.css` | 设计系统：CSS 变量、重置、按钮/表单基类、spacing/radius/shadow 令牌 |
| `css/styles-admin.css` | 管理后台顶层样式（引用 `admin/` 子目录） |
| `css/styles-playback.css` | 播放助手顶层样式（引用 `playback/` 子目录） |
| `css/components/parameter-range.css` | 原生参数滑块：4px 轨道与 18px 圆形滑块，`--centered` 与 `data-range-scale="balanced"` 支持中心映射，不接管播放进度/音量 |
| `css/components/number-field.css` | 带单位数字输入框：`lira-number-field` + `lira-number-field-unit` 后缀，不增加脚本或接管保存校验 |
| `css/components/switch-control.css` | `switch-control` 包裹原生 checkbox、`switch-track` 和标签，统一主题轨道与焦点状态 |
| `css/components/save-status.css` | 保存提示文字层级、圆点与语义色，由 `js/shared/save-status.js` 呈现（管理页与画布各自加载） |
| `css/components/content-state.css` | 播放队列、粉丝档案、主播工作台共用空态/加载/失败提示层级与语义色 |
| `css/components/color-control.css` | 公共颜色控件与选色弹层（`--color-control-height` 默认 36px） |
| `css/components/contextual-help.css` | Admin `<lira-help>` 问号与顶层说明样式 |
| `css/admin/*.css` | 管理后台分模块（`component-styles.css` 卡片与边框使用 `--color-border-default` 跟随客户端主题） |
| `css/playback/*.css` | 播放助手分模块 |
| `css/overlays/base.css` | 叠加层框架（classic/identity 队列主题、滚动动画、歌单板） |
| `css/overlays/blindbox.css` | 盲盒叠加层动画与布局 |
| `css/overlays/overtime.css` | 加班机叠加层（cq 单位 + 容器查询，见 [overlays.md](overlays.md) §4） |
| `css/overlays/clock.css` | 时钟各样式 CSS 入口，含纯时间极简样式与 `prefers-reduced-motion` 降级 |
| `css/admin/workspace/song.css` | 按原顺序导入 `song-management.css` 与 `song-layout.css` |
| `css/overlays/desktop.css` | 桌面样式入口，组合滚动条、`css/desktop/theme.css`、`update.css`、`shell.css` |

带单位输入框从 `styles-admin.css` 加载（单位写入 `aria-label`，装饰后缀加 `aria-hidden="true"`；默认 `--number-field-unit-space: 36px`、`--number-field-unit-inset: 12px`，调用方按单位长度覆盖，如点歌规则双列用 28px/8px、小时数用 40px/10px；广泛用于通知金额、礼物触发金额、播放器外观、加班时长、基础歌词与电音助手变速）：

```html
<span class="lira-number-field">
  <input type="number" min="0" placeholder="不填即不限" aria-label="点歌间隔（秒）" />
  <span class="lira-number-field-unit" aria-hidden="true">秒</span>
</span>
```

`renderSaveStatus(element, state, message?)` 使用 `idle`、`loading`、`pending`、`saving`、`saved`、`error` 状态，设 `role="status"` 且不发请求；浮层统一复用 `--color-floating-surface`、`--color-bg-overlay-light` 与弹窗阴影（播放队列/抽屉遮罩分别取 40%/75%，礼物抽屉与选择窗使用完整遮罩）。

## 6. 静态资源

| 资源 | 说明 |
| --- | --- |
| `img/overtime-machine/` | 加班机内置背景：`midnight-grid.svg`、`gift-placeholder.svg`（占位图），选型见 [ADR-0005](../../architecture/adr/0005-built-in-overtime-backgrounds.md) |
| `img/admin/gifts/bilibili-guard-*.webp` | 大航海（总督/提督/舰长）图标，加班机内置三档守护礼物 |
| `img/playback/qqmusic-icon.webp` / `img/playback/player-turntable-chassis.webp` / `img/admin/gifts/gift-section-icon.webp` | 播放器/礼物面板图标 |
| `data/theme-presets.json` | 点歌板/歌单板主题预设，字段 schema 见 §6.1 |
| `data/cache/overtime-gift-catalog-v2.json` / `data/cache/overtime-gift-images/` / `data/cache/overtime-gift-assets-state-v2.json` | 运行时用户数据（不属于 `public/` 静态资源）：分别保存服务器付费礼物元数据、按精确 ID 缓存的图片及扫描状态，不进入源码或安装包 |
| 字体 | 管理界面沿用系统字体栈；所有字体选择入口共用 [font-catalog.js](../../../public/js/shared/font-catalog.js) 中的 19 款完整 OFL 字体，经 CDN 补齐后从本机缓存读取（来源与许可见[字体说明](../../../public/fonts/README.md)，加载与重试机制见 [app.md](app.md#10-共享字体与资源下载)）；两个微型标题裁剪字体由各组件随安装包提供 |

礼物主目录由当前配置直播间的 Bilibili 礼物面板、`giftConfig` 和已配置的在售盲盒展开产生。LIRA Server 全局礼物目录不增加主目录成员；首次授权后，本地运行时保存其金瓜子正价子集并按精确礼物 ID 准备图片，供全局本地搜索、盲盒、历史高价值礼物和已保存规则复用（缺失显示 `gift-placeholder.svg`）。源码与安装包不包含 `img/bilibili-gifts.json`、`img/bilibili-gifts/` 或三份旧礼物 Markdown。

### 6.1 data/theme-presets.json 格式(唯一成文处)

由 `shared/theme.js` 的 `loadThemeConfig()` 在页面启动时加载，主题配置由模块缓存并通过显式导出供调用方读取。

顶层结构示意（占位符表示类型，不是可解析的 JSON）：

```text
{
  "version": "1.0.0",
  "default": { <默认值键值对> },
  "presets": {
    "classic":        { <presetKey>: <ThemeSnapshot>, … },
    "classicLabels":  { <presetKey>: "<展示名>" },
    "classicSwatches":{ <presetKey>: ["#bg","#primary","#accent","#text"] },
    "songBoard":        { <presetKey>: <SongBoardSnapshot>, … },
    "songBoardLabels":  { <presetKey>: "<展示名>" },
    "songBoardSwatches":{ <presetKey>: ["#bg","#primary","#accent","#text"] }
  }
}
```

`default` 保存默认主题值。`classic` 组共 14 套预设，`songBoard` 组共 14 套预设，仅保存当前表单和渲染器使用的字段。

`ThemeSnapshot`（点歌板预设）的 17 个键：

| 分组 | 键 | 类型/值域 |
| --- | --- | --- |
| 基色 | `themePrimary` / `themeAccent` / `themeText` / `themeBackground` | `"#rrggbb"` |
| 面板 | `themeOpacity`（`"0.00"`–`"1.00"`） / `themeRadius`（px 字符串） / `backdropBlur`（px） / `glowIntensity`（界面范围 0–20） | string 数字 |
| 渐变 | `enableGradient`（`"true"`/`"false"`） / `gradientEnd`（`"#rrggbb"`） | string |
| 字体 | `overlayFontFamily`（CSS font-family） / `overlayFontWeight`（`"400"`–`"900"`） | string |
| 颜色 | `overlaySongColor` / `overlayRequesterColor` | `"#rrggbb"` |
| 字号 | `queueSongFontSize` / `queueTitleFontSize` | string 数字（px） |
| 滚动 | `queueScrollSpeed`（像素/秒） | string |

`default` 另含 `overlayLowPowerMode`、`overlayTitle`、`overlayShowIndex`、`overlayIndexThreshold`、`overlayIndexColor`、`queueFixedSixRows`、`queueScrollMode`，共 24 个键。

`SongBoardSnapshot` 使用 `songBoardThemePrimary`、`songBoardThemeAccent`、`songBoardThemeText`、`songBoardThemeBackground`、`songBoardThemeOpacity`、`songBoardThemeRadius`、`songBoardBackdropBlur`、`songBoardGlowIntensity`、`songBoardEnableGradient`、`songBoardGradientEnd`、`songBoardFontFamily`、`songBoardFontWeight`、`songBoardSongColor`、`songBoardTitle`、`songBoardSongFontSize`、`songBoardTitleFontSize`、`scrollSeconds`，共 17 个键。`classicSwatches`/`songBoardSwatches` 每项为 4 元素数组 `["#背景","#主色","#强调色","#文字色"]`，用于预设选择器的色块预览。

## 7. 礼物完整历史页面

- **表格、筛选与框选**：`gifts/history.js` 统一管理请求代次、分页、取消与重试；`gifts/history-view.js` 负责状态与行展示（安全转义）；`gifts/history-selection.js` 负责行点击与本页框选（普通框选替换本页选择，Ctrl/Meta 框选按按下鼠标时的状态切换框内记录，拖动计数分别显示新增与取消条数）。「最近礼物 → 查看全部」展示时间/礼物/数量/金额/用户/备注六列表格，支持用户名称、礼物名称、日期区间与单条金额严格大于门槛的筛选，默认读取全部历史并沿用复合游标（keyset）翻页；支持跨页勾选、本页全选、选择全部筛选结果及导出所选（切换筛选清除旧选择）。统计摘要、排行和趋势归服务器网页承载。
- **清空与自动重读**：抽屉移除仅清理显示的操作；「清空全部记录」明确提示不可撤销，并先经 Electron 主进程携带 DeviceBearer 清空当前认证主播在服务端的礼物账本与发件箱（ledger/outbox），待服务端确认成功后再清理当前本地数据源（清空结果与后续列表更新分别显示，无法确认远端结果时不保证已删除）。抽屉打开期间对来源未就绪、同步未完成、离线和读取失败自动重读，15 秒后降频并提供手动重试（手动重试只读不删）；关闭抽屉取消读取和定时器，过期响应不覆盖新状态。
- **权限边界**：抽屉仅调用当前本地数据源的 `/api/gifts/history`，不接收或提交 `sourceId`、Device token、bootstrap token 或远端 cursor。详细契约见 [gift-ledger-projection-sync_design.md](../../../specs/gift-ledger-projection-sync_design.md)。
