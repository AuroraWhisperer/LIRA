# 前端页面与入口清单

粉丝档案位于百宝箱 → 主播工作，沿用 `/admin`；`toolbox/fan-profiles-nav.html` 与 `toolbox/fan-profiles.html` 由既有 Admin composer 组合。页内“档案/提醒”与“概览/互动/音乐/大航海”由 `js/admin/fans/` 拥有；点歌姓名入口把同一个详情节点移入快捷 dialog，返回时还原，不新增公开页面或 浏览器源。私有数据通过主窗口 IPC 获取，页面本身不持有 token 或 scope 决策。

> 涉及文件:[pages/admin/](../../../public/pages/admin)、[server/admin-page.js](../../../src/server/admin-page.js)、[admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js)、[gift-audit.html](../../../public/pages/gift-audit.html)、[overlays/](../../../public/pages/overlays)、[js/admin/](../../../public/js/admin)、[js/playback/](../../../public/js/playback)、[js/overlays/](../../../public/js/overlays)、[js/shared/](../../../public/js/shared)、[css/](../../../public/css)、[img/](../../../public/img)

本文档是前端**页面清单**的唯一事实源:每个页面是什么、由谁打开、入口 URL 只在此成表。URL → HTML 的映射表(`pageMap`)本身归 [server-core.md](../backend/server-core.md) §4.3 所有,此处只列出面向使用者的入口语义。

管理后台没有单一 `public/pages/admin.html` 文件。HTML 分片位于 [pages/admin/](../../../public/pages/admin)，由 [server/admin-page.js](../../../src/server/admin-page.js) 组合，顺序由 [admin-page-composition.test.js](../../../test/admin/admin-page-composition.test.js) 保护。

### 客户端外观

百宝箱 → 设置 → 客户端外观提供中性蓝、经典暖金、暖陶三套浅色配色。选择候选只更新选项，点击“应用配色”后，经桌面桥成功保存才原位更新 `html[data-client-theme]`，不重新挂载播放器、保存业务设置或刷新页面。入口与反馈由 [client-appearance.js](../../../public/js/admin/client-appearance.js) 拥有。

[desktop/palettes.css](../../../public/css/desktop/palettes.css) 只提供作用域内颜色及兼容别名；布局、字体与控件几何共用。默认 `terracotta`（暖陶），选项小样使用 `data-client-theme-preview` 在自身作用域解析别名。独立工具仅加载色板，不加载拖拽等桌面壳规则；新打开的预览与已授权礼物审计读取当前已提交主题，旧页面不自动同步或刷新。初始化白名单见 [服务核心](../backend/server-core.md)，本机保存及首帧底色见 [桌面主进程](../desktop/main.md)。

登录、直播浏览器源、观众点歌页、歌词内容不接入客户端色板；盲盒与加班机专属内容保持独立配色。场景编辑器检查底色固定，实际组件仍由独立 iframe 和组件配置决定。

## 1. 技术选型

| 事实     | 说明                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 语言     | 零框架 Vanilla JS(ES Modules + Classic Scripts),无构建工具、无 TypeScript        |
| 样式     | 原生 CSS,按目录拆分,无预处理器                                                   |
| 实时通道 | WebSocket 全量快照(见 [comms.md](comms.md)、[ws.md](../backend/ws.md))           |
| 命令通道 | `fetch('/api/...')`(见 [comms.md](comms.md)、[api.md](../backend/api.md))        |
| 模块形态 | ES Module 带 `.js` 后缀的显式导入；既有全局兼容集中在 `legacy-admin-bridge.js`，不作为新模块注册方式 |

### 1.1 桌面 Admin 字体层级

桌面 Admin 的通用字体层级由 [styles-base.css](../../../public/css/styles-base.css) 中的 token 与 [admin/layout.css](../../../public/css/admin/layout.css) 中 `.app-shell` 范围内的语义角色共同持有。`styles-base.css` 只声明 token，不得增加会影响普通 `h1`、`p`、`small` 等元素的裸排版规则；页面和组件通过 `ui-*` 角色或组件自有的等价选择器消费这些值。

下表记录通用 token 的默认设计值，具体数值由样式 owner 调整；组件可在相应语义角色基础上调整展示尺寸。自动化测试保护 token 完整性、有效取值、字号层级和以下可读性/作用域边界，不在各页面重复冻结这些数值。用户配置的直播画面字号属于输入输出契约，仍须准确应用。

| 角色            | 默认字号 | 常用字重 | 用途                                   |
| --------------- | ---: | -------: | -------------------------------------- |
| display         | 28px |      700 | 少量展示型标题                         |
| page title      | 24px |      700 | 主工作区与百宝箱功能页锚点             |
| section title   | 18px |      700 | 面板、弹窗和主要内容分区               |
| card title      | 15px |      600 | 卡片标题、歌曲名与 Toast 标题          |
| body            | 14px |      400 | 正文、说明和普通状态文案               |
| control label   | 13px |      600 | 表单标签、按钮和导航控件               |
| caption         | 12px |      400 | 元数据、辅助说明和次级状态             |
| micro / eyebrow | 11px |      700 | 短标签、表头、状态徽标和 Latin eyebrow |

普通正文、帮助、错误与可操作说明不得小于 12px；11px 只用于短而有边界的 microcopy。计时器、歌词、硬件数值、图表与其他展示数据可使用组件自有的 metric/presentation 字号，但不能反向覆盖通用正文。常规字重限定为 400/500/600/700。

该契约只拥有 Electron/Admin chrome。`css/overlays/` 中除桌面外壳专用的 `overlays/desktop.css` 外，不消费 `ui-*` 或 `--type-*`；`/queue`、`/songlist` 继续读取持久化的 overlay 字体与字号，`/lyrics` 和 Admin 歌词预览继续读取同一组 `--preview-*` 用户配置。本地字体枚举仍只由桌面歌词设置的 `admin/local-font-library.js` 在用户手势后调用，不是 Admin 核心 UI 的依赖。

### 1.2 组件工作区的桌面尺度

「组件」在 [live-components.css](../../../public/css/admin/live-components.css) 内消费并局部细化上述语义 token；适用于六个组件设置页，不改变 OBS/哔哩哔哩直播姬中的输出字号、素材比例或用户配置。颜色、圆角、禁用与焦点状态沿用客户端主题。六页拥有一致的页面标题、内容左边线与控件高度，表单和预览按任务分区。

顶部入口命名为「组件」，与点歌、播放、礼物保持两字节奏，表示可配置并放入直播画面的独立功能；悬停说明为「组件 · 弹幕、礼物与直播画面设置」。命名参考同类产品的功能分类：[Streamlabs 中文站](https://streamlabs.com/zh-cn/stream-widgets)称 Widgets 为「小工具」，[StreamElements](https://docs.streamelements.com/overlays/getting-started)区分单个 Widget 与组合 Overlay，[OBS](https://obsproject.com/kb/sources-guide)则使用 Sources。LIRA 采用「组件」是结合本站功能与既有画布用语的选择，并非这些软件统一使用的中文名称。

图标沿用顶部导航的透明彩色立体风格，以直播预览窗口、金色弹幕板和珊瑚色小画面表达直播间画面的搭建。`nav-components.webp` 将三层画面收拢为紧凑的横向屏幕，`nav-components-active.webp` 将弹幕板和小画面向上展开，形成明显的三层轮廓；两态保持相同的材质与配色，通过整体轮廓区分选择状态。两图各为 64×64，按既有 20×20 CSS 像素显示，共用默认/选中图层的 180ms 淡入淡出；减少动态效果偏好下取消过渡，无持续闪烁。内部页面 ID、`#components` 和记忆选择键保持不变。

设计依据核对于 2026-10-09：

- [Microsoft Fluent 2 Typography](https://fluent2.microsoft.design/typography)：原生系统字体、14/20 正文、Windows 20/28 副标题及分级字重，建立稳定的文字层级。
- [Microsoft Fluent 2 Layout](https://fluent2.microsoft.design/layout)：4px 基础间距、邻近关系分组，以及按内容空间重排。它并未规定本项目的侧栏或卡片必须取某一宽度。
- [Fluent Field](https://fluent2.microsoft.design/components/web/react/core/field/usage/) 与 [Fluent Button](https://fluent2.microsoft.design/components/web/react/core/button/usage)：标签置于字段上方，辅助操作减轻视觉权重，主操作在各自任务组内保持明确。
- [WCAG 2.2 SC 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)：选中、当前等状态不只依靠颜色表达，侧栏与样式卡片同时使用填充、竖条/选中环和字重。
- [Adobe Spectrum Platform scale](https://spectrum.adobe.com/page/platform-scale/)：鼠标与触屏采用不同密度。LIRA 的 Electron 工作区按鼠标桌面设计，不把触屏最小尺寸直接作为所有桌面按钮的高度。

下表区分引用的尺度与 LIRA 的内容适配。除明确引用的字体尺度外，尺寸是本项目的可验证选择，不声称是大厂规定；数值均为 CSS 像素，随系统缩放渲染。

| 对象 | LIRA 值 | 选择理由 |
| --- | --- | --- |
| 界面字体 | 正文 Segoe UI Variable Text，页标题 Segoe UI Variable Display；均回退 Segoe UI 与 Microsoft YaHei UI / Microsoft YaHei | 原生 Windows 字体栈，不额外下载显示字体。Variable 字体按光学尺寸分 Text / Display 档，20px 标题用 Display 档；中文回退不受影响。用户素材预览保留自身字体 |
| 页标题 | 20px / 28px，600 | 采用 Fluent Windows 副标题尺度作为工作区页标题；六个设置页（含文本框）用同一层级，避免标题挤占表单空间 |
| 分区标题 | 16px / 24px，600 | 基于 Fluent 16px 副标题，行高从 Web 的 22px 调到 24px。六页的分区标题统一到此级，不再借用与正文同为 14–15px 的卡片标题，保持 20 / 16 / 14 / 12 四级层次 |
| 分区说明 | 12px / 18px，位于分区标题与控件之间 | Fluent Field：说明在操作前被读到。直播画面链接、萌时钟网址说明导入 OBS 或哔哩哔哩直播姬的方式 |
| 正文、按钮、字段标签 | 14px / 20px；正文、字段标签、开关行文字与输入值 400，按钮 500，选中项 600 | Fluent Body 1 尺度；同等任务不再混用 13px 和 14px。字段标签不加粗，粗体只留给分区/分组标题、选中项和按钮；输入框不继承标签字重，用户填写的内容始终是常规字重 |
| 辅助说明、状态 | 12px / 18px，400–500 | 保留现有 caption 尺度；比 Fluent 12/16 多 2px 行距以容纳中文长说明；不把帮助文字压成 11px |
| 常规按钮、输入框、下拉框 | 最小高 36px；文字按钮水平内边距 12px，宽度随文案 | 20px 文字行盒 + 上下各 7px 内边距 + 各 1px 边框；中文清楚且保持桌面密度。长文案允许增高 |
| 导航行、子页标签 | 最小高 40px；侧栏图标 20px；图文间距 12px | 导航承担持续定位，比表单操作多留点击空间；图标与正文中心对齐。样式卡片属于预览选择器，不强行压成按钮高度 |
| 区块内分类 | 弹幕「固定位置 / 区域随机 / 飘窗弹幕」为分段控件：3px 内衬底，选项高 30px，选中项为面板色填充 + 细阴影 | 它只筛选同一区块里的样式网格，与切换整页内容的下划线子页标签（礼物姬）区分层级，对应 Material 3 一/二级标签和 Apple 分段控件的用法 |
| 侧栏 | 常规 200px；901–1100px 窗口内为 160px；行在 8px 栏内边距内，行内左右 12px；底部「使用指南」下留 32px，不被全局播放器展开按钮遮挡 | 选中行带填充，需要两侧留白才不贴边；20px 图标 + 12px 间隔后保留约 128px 标签区。加班机用秒表、时钟用表盘、文本框用框内文字，与其余矩形外框图标同族，避免两个时钟图标难以区分 |
| 侧栏选中态 | 外观主导航选中底色与描边 + 3px 选中竖条 + 600 字重；图标取选中文字色，标签保持正文色 | Windows 11 设置的导航选中样式；状态由填充、竖条和字重共同表达，不只依靠颜色（WCAG 1.4.1）。悬停按正文色 7% 叠加，因为侧栏位于页面底色而非面板上 |
| 选中与强调色 | 竖条、选中环、子页标签下划线取 `--color-selection-marker`；实心徽标、标签文字取 `--color-selection-text`，徽标文字取面板色 | 跟随六套客户端外观。玄黑 · 银红的主色是接近白色的银灰，作为 1–2px 描边不可辨，选中标记改用该外观为此设定的红色；其余外观即各自主色 |
| 主按钮 | 弹幕姬整页只有一个 `.primary`「应用到直播画面」，「预览与调整」「复制链接」为带图标的描边按钮；开播动画「预览」、加班机「保存画面」仍是各自任务组的主按钮 | Fluent Button：同一视图只保留一个强调按钮，其余用描边或安静按钮，新手能看出先点哪个 |
| 弹幕姬保存栏 | 「重新读取 / 放弃未保存修改 / 应用到直播画面」及保存状态吸附在内容区底部，贴齐面板左右边缘，半透明面板色 + 上边线 | 选样式、调参数时不必滚到页底找应用按钮，避免误以为已生效；与 Shopify Polaris 上下文保存栏、Discord 设置页未保存提示同理 |
| 样式库管理入口 | 「管理样式库」位于所属区块标题右侧（弹幕样式、时钟自定义设置、开播动画样式、全屏礼物感谢与大航海感谢的更多样式）；「＋ 添加样式」仍是样式网格最后一格 | 管理入口属于整个区块，不应混在可选样式卡片之间；弹幕切换显示方式后仍可见。礼物许愿等没有标题入口的位置保持原有排列 |
| 样式选择卡 | 选中：2px 选中环 + 缩略图右上角实心「已选」徽标；「添加样式」为虚线透明框 | 与 Windows 个性化、macOS 墙纸等缩略图选择器一致；徽标不占用名称行。占位操作不应比真实内容更醒目 |
| 折叠行 | 整行最小高 56px（外观效果组 40px），悬停填充；右侧依次为状态摘要和箭头 | 收起时仍告知内容状态，如「已屏蔽 3 人 · 12 个屏蔽词」「原样式」，用户不必展开就知道是否配置过 |
| 外观效果参数 | 每项一行：标签 104px + 主题色滑块 + 64px 数值框；最多两列、列间 40px，单列不足 340px 时改一列；弹幕姬「高级参数」内的「外观效果」标题为 14px 分组级 | 参照 Figma、Photoshop 效果面板的紧凑属性行，展开后高度约减半；滑块使用 `parameter-range` 主题样式，不再出现浏览器默认蓝色 |
| 开关行 | 文字在前，开关在后 | 同页多处开关的阅读方向一致，与 Windows 设置的开关行相同 |
| 工作区 / 内容区 | 外边距及栏间距 16px；面板内边距 24px，窄窗口 20px；含内边距的正文容器最大 1200px | 沿用 4px 节奏；容器封顶限制超宽屏上表单被拉长，滚动条预留空间避免内容左右跳动 |
| 字段与分组 | 相关字段间距 8/12/16px；不同分组间距 24px | 距离表达关系，代替多层同色边框 |
| 弹幕样式卡片 | 最小宽 208px，间隔 12px；预览高 104px，卡片至少 152px | 保留素材辨识度与 14px 名称；常规窗口容纳五列，1024px 窗口降为三列。素材等比例包含，不裁掉弹幕样式 |
| 时钟样式 / 预览 | 样式最小宽 152px、高 64px；预览区最小高 192px | 48px 色样与中文名称需要独立空间；实际时钟保持自身横竖比例，192px 预览区容纳常见外观 |
| 设置与预览双栏 | 设置栏自适应，预览栏 320px，间隔 24px；容器不超过 880px 时堆叠 | 给编辑区域约 536px、预览区 320px，加 24px 间隔。空间不足就重排，避免压缩字段或截断说明 |
| 加班机状态区 | 最小高 112px；计时数值 40px / 48px，600、等宽数字 | 计时是该页主要运行数据，比字段醒目；数字位数变化时不抖动。操作按钮仍沿用 36px |

右侧主体随窗口高度填充并独立滚动；不为不同组件硬设相同内容高度。开播动画去除重复标题标签与多层容器，时钟与开播动画在宽窗口中都以左侧设置、右侧预览组织。移动浏览器不是这些桌面设置页的验收目标，已有窄窗口导航回退仍保留。图标删除、富文本格式工具等紧凑控件沿用各自组件的既有尺寸；直播输出和素材缩略图不继承正文尺寸规范。

## 2. 入口 URL(唯一成表处)

所有页面都由后端 `servePageOrAsset` 提供(`pageMap` 见 [server-core.md](../backend/server-core.md) §4.3),响应 `Cache-Control: no-store`。

| 页面类别 | 凭据与用途 | 能力边界 |
| --- | --- | --- |
| 管理 HTML（`/`、`/admin`、`/settings`、`/songs`） | 需要本地管理凭据；Electron main 的 [desktop-request-auth.js](../../../src/electron/desktop-request-auth.js) 对受信主窗口主 frame 的精确 origin 请求注入 Bearer | `?desktop=1` 只切换表现；旧书签、手动浏览器打开或 `AUTO_OPEN_ADMIN=1` 均不授予权限 |
| 登录页 `/license` | HTML 无需本地管理凭据，供 Electron 登录流程使用 | 浏览器可读页面不等于拥有 preload/设备会话；登录能力须走受限 IPC |
| 场景编辑器 `/c#<短入口能力>`；兼容旧 `/component-preview` | “点歌 → 浏览器源 → 直播场景 → 编辑场景”或原组件预览按钮，经 Electron 既有外部导航策略交给系统默认浏览器 | 直接入口首次为空，后续恢复保存布局；组件入口添加/选中对应组件。顶部“添加组件”小窗按分类选择样式，新增独立外观图层并展开右侧参数；已有图层在画布下方横向排列。编辑页采用浅色工具栏与灰色工作区，直接入口默认收起参数，折叠保留选择与草稿；画布自动适配且不滚动。保存与复制集中在右上角。公共分辨率仅由画布设置改变。“保存并应用”保存各 owner 后发布组合输出，“复制直播源地址”返回一条 `127.0.0.1:<实际端口>/scene…` 地址供 OBS 或哔哩哔哩直播姬使用；后续应用沿用该地址。详见 [预览 API](../backend/api.md#浏览器组件预览)，无 preload 或管理凭据 |
| 组件浏览器源目录 | 客户端“点歌 → 浏览器源” | “直播场景”提供编辑场景及复制组合来源，使用说明在标题旁问号中；独立点歌板、萌时钟、加班机、本机弹幕姬继续单独复制。本机弹幕地址 `/danmaku?source=component` 使用已保存的服务器样式和展示数据；在线弹幕源同时保留。场景编辑器地址不用于直播导入。完整步骤见 [组件指南](../../guides/component-sources.md) |
| 本地展示页 | [access-policy.js](../../../src/server/access-policy.js) 的 `OVERLAY_PAGES` 定义能力范围；HTML 注入本 scope 的 overlay 凭据 | 可供 overlay/本地预览；只能调用本 scope 允许的 HTTP/WS，不能取得管理权限；如 `gift-export` 是内部导出用途，并非普通 浏览器源 |
| 独立 Node 调试 | `npm start` 保留同一 HTML/API 鉴权；受保护调用必须显式使用当前运行时的有效管理凭据 | 没有 Electron preload、主进程 Device API 代理、分区登录和本地媒体协议，不是完整 Web 管理产品 |

画布编辑页使用单个 fragment 短入口，客户端仍持有原配置控制器时重复打开会沿用连接；旧页可刷新接管继续编辑，未保存修改仍保留。短暂断线自动重试，客户端关闭、账号或配置来源变化时撤销。直播场景地址与编辑页入口不同：成功“保存并应用”后客户端地址目录立即刷新，后续应用沿用正式来源地址。能力及恢复元数据契约见 [预览 API](../backend/api.md#浏览器组件预览)。

[servePageOrAsset](../../../src/server/page-assets.js) 对非展示、非登录、非组件预览 HTML 的匿名请求返回 401“请从桌面应用打开管理页面。”；API 中无效凭据为 401，越权或不受信 Origin 为 403。这些响应说明服务已可达，应检查正常桌面入口与请求身份，不应关闭保护或据此判断 localhost 不可用。


| 入口 URL           | 实际 HTML                                                                                                          | 打开者                                                       | 行为说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --- | --- | --- |
| `/admin`           | [pages/admin/](../../../public/pages/admin) 分片经 [server/admin-page.js](../../../src/server/admin-page.js) 组合 | Electron 主窗口；带有效管理凭据的调试调用 | 管理后台:点歌/播放/礼物/组件/百宝箱五个主页面;`#playback`/`#gifts`/`#components`/`#other` hash 直达对应主页面                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/admin?desktop=1` | 同上                                                                                                               | Electron 主窗口([desktop/main.md](../desktop/main.md))       | [shell-start.html](../../../public/pages/admin/shell-start.html) 在 CSS 加载前写入 `html.desktop-shell` 主题类(防粉色闪烁),显示标题栏拖拽区与窗口控制按钮;退出后展示桌面版重启屏                                                                                                                                                                                                                                                                                                                                             |
| `/settings`        | 同上                                                                                                               | Electron 管理页兼容路径（需管理凭据）                                      | 历史兼容入口,落到管理后台默认页(点歌)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/songs`           | 同上                                                                                                               | Electron 管理页兼容路径（需管理凭据） | 同上,兼容入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/background` | [overlays/background.html](../../../public/pages/overlays/background.html) | 场景内背景组件、浏览器源 | 背景样式由场景配置决定；默认无背景，月渡花汀需导入套装后使用资源映射；带显式 style 的旧开发预览仍可使用源码素材；使用沙箱组件协议，无业务凭据或数据连接 |
| `/imported-danmaku` | [overlays/imported-danmaku.html](../../../public/pages/overlays/imported-danmaku.html) | 导入弹幕 CSS 的预览与场景子页面 | 常见 blivechat/BLC 消息结构，CSS 和显示数据经既有组件协议进入；匿名 HTML 无凭据，保持 opaque sandbox；不作为独立连接 B 站的页面 |
| `/queue`           | [overlays/queue.html](../../../public/pages/overlays/queue.html)                                                   | 浏览器源、独立浏览器窗口                                 | 点歌队列叠加层,透明背景                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/songlist`        | [overlays/songs.html](../../../public/pages/overlays/songs.html)                                                   | 浏览器源                                                 | 歌单展示板叠加层,支持 `?category=` 过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/blindbox`        | [overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)                                             | 浏览器源                                                 | 盲盒盈亏投屏,支持 `?top=/winners=/heartBox=/title=` 等参数(礼物页生成带参数链接)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/overtime`        | [overlays/overtime.html](../../../public/pages/overlays/overtime.html)                                             | 浏览器源、管理页预览 `<iframe>`                          | 加班机叠加层,支持 `?quality=low`(降帧/降动画)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/gift-effects`    | [overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html)                                     | 浏览器源、管理页预览                                     | 礼物特效与四方边框叠加层,平时保持透明并在匹配礼物到达时播放                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/lyrics`          | [overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)                                     | 浏览器源、独立浏览器窗口                                 | 桌面歌词完整时间轴;地址由管理页「复制桌面歌词」提供                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/danmaku`         | [overlays/danmaku.html](../../../public/pages/overlays/danmaku.html)                                               | 管理页本机预览、兼容本地展示入口 `<iframe>`                | 本机 `/danmaku?preview=1` 用于编辑预览，正式直播画面使用服务器返回的完整 HTTPS 地址；固定区域样式按顺序显示普通文字、身份信息和 B 站表情，其中透明简约样式不绘制卡片底色或身份装饰，仅在昵称和正文下方显示粉丝牌等级；全屏随机样式只显示发送者与正文并在全画布随机定位，按 `danmakuFullscreenDurationSeconds` 自动消失；第六种固定样式身份横卡(`identity`)使用右侧头像、四档身份底色和 624×640 等比缩放设计画布，`?preview=1&style=…` 只用于 Admin 的确定性样本预览                                                                                                                                                         |
| `/games`           | [overlays/games.html](../../../public/pages/overlays/games.html)                                                   | 浏览器源、独立浏览器窗口                                 | 直播小游戏浏览器源；管理页先打开固定地址再开始游戏，页面按当前会话自动显示数字炸弹、五子棋或你画我猜；画猜页面使用收窄并居中的 16:9 画布，由主播通过画笔、橡皮擦、直线、矩形、圆形和画布取色器作画，并显示弹幕抢答/总积分；图形仍编码为既有 append 笔画同步，不新增 WebSocket 消息形状。弹幕画廊按消息视觉长度动态调整气泡宽度与高度，展示头像、昵称、消息、大航海与当前房间灯牌，头像统一经带 token 的 `/api/bilibili/avatar` 本地代理加载并补全；题词只在 Admin 私有主持区显示；旧 `?game=` 地址仍可访问但参数不再决定游戏 |
| `/wheel`           | [overlays/wheel.html](../../../public/pages/overlays/wheel.html)                                                   | 浏览器源、独立浏览器窗口                                 | 独立转盘浏览器源；圆形外透明，按主播配置的内容份数绘制多色扇形，抽取时旋转并突出最终结果；不参与 `/games` 会话互斥                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/opening`         | [overlays/opening.html](../../../public/pages/overlays/opening.html)                                               | 浏览器源、管理页预览                                     | 固定开播画面地址,读取已保存的文案、动画、画质与音乐设置                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/clock`           | [overlays/clock.html](../../../public/pages/overlays/clock.html)                                                   | OBS/直播姬浏览器源、管理页预览 `<iframe>`                    | 固定萌时钟地址；默认读取已保存设置，兼容 `style=peach                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | starlight | soda | timeline-horizontal | timeline-vertical`、`date=0 | 1`、`seconds=0 | 1`、`format=12 | 24`、`label=` 逐字段覆盖 |

礼物姬在「全屏礼物感谢」「滚动礼物」后增加「礼物许愿」。管理片段 `toolbox/gift-wishes.html` 由原礼物片段组合；`admin/gifts/wishes.js` 管理三周期与增改删，`wish-picker.js` 复用在售/全库目录，`shared/gift-wish-card.js` / CSS 与 overlay 共用实际展示。每条许愿默认可选「礼物卡片」「文字版」「圆形徽章」；月渡花汀在导入套装后作为画布样式使用。文字版将 `{图片}`、`{礼物}`、`{已收}`、`{目标}` 显示为不可拆开的中文内容块，提供插入按钮、问号说明和相邻的即时预览；支持原生撤销/重做、整块删除、复制/剪切及纯文本粘贴，粘贴已知标记时恢复内容块，保存仍使用原模板格式；默认“许愿{礼物}（{已收}/{目标}）”。图片标记可放任意位置，每处生成一个图片节点，删除全部图片标记即可隐藏；名称和数量使用文本节点，不解析 HTML。共享模板读取函数将旧 `textImagePosition` 的 before/after 转成首尾图片标记，inline 转成第一处礼物名称前的标记（无名称标记时前置）；模板已有 `{图片}` 时优先使用，不重复追加。编辑保存时写入转换后的模板并清除旧位置值为 none，保留内容和顺序。模板含图片标记时显示动态原图/静态 PNG 选择，原图没有动画时仍显示原静态图片，静态转换由 `shared/gift-wish-image.js` 在内存完成。文字颜色依据服务端 todayCount，默认今日未收到为雾蓝 #3b6ea8、已收到为翠绿 #21815c。默认值由共享 renderer 导出；每条许愿可分别自定义 textPendingColor / textReceivedColor，空值使用默认。编辑器提供取色器、恢复默认颜色和两状态对比预览，预览不修改真实收礼状态或数量，颜色随「添加许愿 / 保存修改」生效。已保存预览保留展示内容和编辑/删除操作。空、加载、同步不完整、直播状态未知均有对应提示，离开面板暂停轮询。面向用户的完整规则见内置指南 `usage-guide-toolbox-danmaku-gifts.html#ug-gift-wishes`。

「月渡花汀」（`moonlit`）沿用同名开播动画的蓝白、银蓝与靛青配色，层叠白山茶、墨蓝枝叶、如意云纹、绢带与山水纹饰紧贴礼物圆框、环绕整圈。装饰原画为 `img/shared/gift-wish-moonlit.webp`；`shared/gift-wish-moonlit.js` / `css/shared/gift-wish-moonlit.css` 负责展示。圆框中的礼物图片、右侧同一行的礼物名称与已收 / 目标数量、下方细进度条均由实时 DOM 渲染；数量与进度条收在延长的深色墨段内，白色已收数和银蓝目标数避开末端浅色花瓣。条头固定显示银蓝折扇与云纹 `img/shared/gift-wish-moonlit-start.svg`，零进度仍保留。填充宽度使用服务端 `progress` 并限制在 0–100%，已收数量保留超过目标的真实值。银色流光沿进度条移动，端点有呼吸亮光与三枚飘散花瓣；零进度隐藏端点，达成时末端转为淡金。`prefers-reduced-motion: reduce` 停用进度过渡和装饰动画。

礼物姬最后一个页签「大航海感谢」直接位于 `toolbox/gift.html`，样式为 `css/admin/gift-guard-thanks.css`，动画样式 `css/shared/guard-thanks.css`（经典）与 `css/shared/guard-thanks-aurora.css`（辉光，默认）由管理页与 `/gift-effects` 共同加载，辉光与经典分别显示独立开关、动画文字、保存和预览，设置与模拟参数紧凑分组；辉光不提供观众昵称输入。两套内置设置后共用一个“更多样式”区域，继续使用现有本机样式库。旧 `guardThanksStyle` 仅用于未独立保存的配置兼容。

「礼物许愿」后新增「月底冲刺」页签，使用 `admin/gifts/sprint-overlay.js` 展示原 `giftSprint` 快照；由现有 `gifts/sprint.js` 同步渲染，不重复轮询或计算。文字与投屏共用 `shared/gift-sprint-text.js` / CSS，显示“还差 N 个水晶球”，达标显示绿色 0，未设目标时留空。复制地址、打开预览与跳转原目标设置表单各有独立按钮。礼物姬标签高度为 26px；许愿地址行的复制、预览、刷新统一使用 secondary 按钮。

`/gift-sprint` 对应 [overlays/gift-sprint.html](../../../public/pages/overlays/gift-sprint.html)，默认透明底，建议尺寸 600 × 80；`preview=1` 显示预览底色和状态提示。使用 WebSocket 初始/后续快照更新，断线清空旧数字，重连恢复当前进度。

| 入口 URL | 实际 HTML | 打开者 | 行为说明 |
| --- | --- | --- | --- |
| `/gift-wishes?period=long` | [overlays/gift-wishes.html](../../../public/pages/overlays/gift-wishes.html) | 浏览器源、管理页预览 | `period=long/day/session` 分别展示长效/本日/本场，默认 long；`preview=1` 显示预览底色与状态提示。正式源透明底，建议宽度 440；每 3 秒读取服务端整数进度，来源变更即时清空旧展示。 |

排查页面(无 URL 映射,只能按文件路径访问):

| 路径                     | 页面                                                     | 打开者          | 说明                                                       |
| ------------------------ | -------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
| `/pages/gift-audit.html` | [gift-audit.html](../../../public/pages/gift-audit.html) | 开发者/主播排查 | 礼物气泡 × WebSocket 交叉对比审计,详见 [app.md](app.md) §9 |

## 3. 页面清单(每个页面一行)

Admin 使用文档的 `toolbox/usage-guide.html` 保留面板、目录和搜索入口；正文依次组合入门、功能、组件与百宝箱、配置、网页歌单、参考和 FAQ 章节。`usage-guide-features.html` 与 `usage-guide-configuration.html` 按完整章节引用点歌、播放、礼物、AI、投屏和设置速查片段；百宝箱与 FAQ 保留章节容器，再按主题引用完整文章或问答组。`src/server/admin-page.js` 递归展开白名单路径的静态片段，拒绝循环引用并缓存完整页面；页面地址、DOM 层级、章节顺序和锚点保持不变。

| 页面           | 文件                                                                                                          | 类型                                     | 内容                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理后台       | [pages/admin/](../../../public/pages/admin) 分片 + [server/admin-page.js](../../../src/server/admin-page.js) | ES Module + 有限兼容桥                      | 点歌/播放/礼物/组件/百宝箱五主页面 + 状态条(WS/直播/歌库计数)+ 窗口控件;导入导出页包含云端歌单同步(覆盖前确认 + 云端数量对比 + 本机上次同步记录)与授权后的歌单页背景管理面板                                                            |
| 礼物审计       | [pages/gift-audit.html](../../../public/pages/gift-audit.html)                                                | 内联脚本                                 | 气泡流 vs WS 流交叉对比、事件重放、手动投递                                                                                                                                                                                        |
| 队列叠加层     | [pages/overlays/queue.html](../../../public/pages/overlays/queue.html)                                        | ES Module(`js/overlays/queue.js`)        | 点歌队列滚动展示,classic、identity、storybook、neon-vinyl、cherry-ribbon、golden-lily 六种风格                                                                                                                                     |
| 歌单叠加层     | [pages/overlays/songs.html](../../../public/pages/overlays/songs.html)                                        | ES Module(`js/overlays/songs.js`)        | 可点歌单展示,虚拟滚动 + 按时长/字母分组                                                                                                                                                                                            |
| 盲盒叠加层     | [pages/overlays/blindbox.html](../../../public/pages/overlays/blindbox.html)                                  | ES Module(`js/overlays/blindbox.js`)     | 盲盒盈亏汇总 + 排行榜 + 冲刺模式                                                                                                                                                                                                   |
| 加班机叠加层   | [pages/overlays/overtime.html](../../../public/pages/overlays/overtime.html)                                  | ES Module(`js/overlays/overtime.js`)     | 直播加班倒计时 + 送礼加班表 + 结算动画                                                                                                                                                                                             |
| 礼物特效叠加层 | [pages/overlays/gift-effects.html](../../../public/pages/overlays/gift-effects.html)                          | ES Module(`js/overlays/gift-effects.js`) | 匹配礼物的四方边框、礼物信息和一次性装饰动画；边框 DOM/WAAPI 时间线由 `gift-effects-frame.js` 独立持有                                                                                                                             |
| 桌面歌词页     | [pages/overlays/lyric-window.html](../../../public/pages/overlays/lyric-window.html)                          | ES Module(`js/overlays/lyric-window.js`) | 复用管理页实时预览的完整时间轴、当前行高亮、逐字进度、翻译/罗马音与自动跟随                                                                                                                                                        |
| 弹幕姬叠加层   | [pages/overlays/danmaku.html](../../../public/pages/overlays/danmaku.html)                                    | ES Module(`js/overlays/danmaku.js`)      | `/danmaku` 多样式页面；快照恢复并实时同步 `danmakuOverlayStyle` 与 `danmakuFullscreenDurationSeconds`，固定区域通过 `danmaku:message` 顺序追加消息，全屏随机在边界内定位并按停留时间移除，复用 `danmaku-feed.js` 安全渲染 B 站表情 |
| 游戏叠加层     | [pages/overlays/games.html](../../../public/pages/overlays/games.html)                                        | ES Module(`js/overlays/games.js`)        | 数字炸弹/五子棋/你画我猜共享会话；你画我猜使用紧凑画布、六种绘画工具，并通过 `danmaku-feed.js` 渲染动态宽高弹幕气泡                                                                                                                |
| 转盘叠加层     | [pages/overlays/wheel.html](../../../public/pages/overlays/wheel.html)                                        | ES Module(`js/overlays/wheel.js`)        | 独立抽奖转盘,按主播配置的选项绘制并突出抽取结果                                                                                                                                                                                    |
| 开播画面叠加层 | [pages/overlays/opening.html](../../../public/pages/overlays/opening.html)                                    | ES Module(`js/overlays/opening.js`)      | 固定地址读取已保存的开场文案、动画、画质和音乐设置                                                                                                                                                                                 |
| 萌时钟叠加层   | [pages/overlays/clock.html](../../../public/pages/overlays/clock.html)                                        | ES Module(`js/overlays/clock.js`)        | 当前本地时间、日期与星期；固定 URL 读取已保存的三套装饰卡片或横/竖透明时间轴设置，并按样式画布缩放                                                                                                                                 |

## 4. JS 模块地图

### 4.1 管理后台 `public/js/admin/`(ESM 入口、显式依赖与按需加载)

| 文件                                                                                | 职责                                                                                                                                       | 文档                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `index.js`                                                                          | 常驻 ESM 入口；按需模块与初始化 owner 见 [app.md](app.md) §3                                                                            | [app.md](app.md)                          |
| `contextual-help.js`                                                                | 注册 `<lira-help>` 问号说明组件；说明使用顶层 Popover，支持悬浮、键盘和点击。仅承载可选解释，不得隐藏状态、校验、警告或必读操作说明        | 本文 §5                                   |
| `app.js`                                                                            | 应用启动:导航初始化、播放助手桥接、WebSocket 连接                                                                                          | [app.md](app.md) §3                       |
| `state.js`                                                                          | `StateService` 单例:状态快照 + WS 客户端 + `/api/state`/`/api/songs` 加载                                                                  | [comms.md](comms.md)、[app.md](app.md) §2 |
| `queue.js`                                                                          | 点歌队列 / SC 队列渲染与操作                                                                                                               | [app.md](app.md) §4                       |
| `songs.js`                                                                          | 歌库表格、筛选(分类/语言/歌手/标签)、编辑/入队/删除                                                                                        | [app.md](app.md) §4                       |
| `settings.js`                                                                       | 设置表单、Bilibili 登录、清库、盲盒映射、退出/刷新直播；账号中心只读展示当前登录账户、本机设备和凭据保存说明，设备授权由服务器管理员管理   | [app.md](app.md) §4                       |
| `theme.js`                                                                          | 点歌板主题(经典/身份/奶油画框样式、预设卡片、一键美化)                                                                                     | [app.md](app.md) §4                       |
| `display.js`                                                                        | 展示板(歌单板)配置与主题                                                                                                                   | [app.md](app.md) §4                       |
| `forms.js`                                                                          | `FormsService`:range↔number 绑定、选项卡、播放器全屏/收起、表单填充                                                                        | [app.md](app.md) §2                       |
| `song-import.js` / `song-import-parser.js` / `cloud-song-sync.js` / `song-background.js` | 导入入口保留文件读取与兼容连接；纯 TSV/CSV 解析由导入和歌单更新共用；云同步拥有覆盖确认、数量与本机同步记录，背景模块拥有查询/上传/删除 UI | [app.md](app.md) §4                       |
| `metrics.js`                                                                        | 系统性能检测(`/api/system/metrics` 5 秒采样)                                                                                               | [app.md](app.md) §4                       |
| `danmaku-tool.js`                                                                   | 弹幕工具:连接状态刷新、固定 `/danmaku` 地址复制/打开、iframe 预览、Admin 内发送弹幕、点歌/固定回复开关；发送功能不另设网页地址             | [app.md](app.md) §6                       |
| `danmaku-libraries.js`                                                              | 签到祝福语/抽签词库/DIY 关键词回复三个编辑器                                                                                               | [app.md](app.md) §6                       |
| `danmaku-fixed-replies.js` / `danmaku-welcome.js` / `danmaku-welcome-library.js` / `danmaku-welcome-model.js` | 固定回复六项总览与单编辑区；欢迎参数、四库独立草稿/保存、虚构预览与底部注音 | [桌面欢迎设置](../desktop/main.md#服务器进场欢迎设置) |
| `ai-assistant-settings.js`、`ai-assistant-config-view.js`、`ai-assistant-personas.js` | AI 互动助手：模型配置、自动保存、角色包选择/创建/导入导出/删除、可选工具与供应商测试 | [app.md](app.md) §6 |
| `overtime.js`                                                                       | 加班机控制台:开关/初始时间/礼物规则(固定+时间盲盒)/背景                                                                                    | [app.md](app.md) §6                       |
| `streamer-planner.js` / `streamer-planner-view.js`                                                          | 主播工作台：控制器拥有 localStorage 兼容、保存保护和编辑动作；视图只读取分离的展示快照并描述动作                                           | [app.md](app.md) §6                       |
| `toolbox-navigation.js`                                                                          | 组件与百宝箱共用导航(独立实例与选中项,不承载业务)                                                                                                    | [app.md](app.md) §6                       |
| `desktop-lyric.js`                                                                  | 桌面歌词设置表单(自动保存)                                                                                                                 | [app.md](app.md) §6                       |
| `desktop-lyric-preview.js`                                                          | 桌面歌词实时预览(完整时间轴 + 连续/离散逐字高亮 + 弹簧跟随动画)                                                                            | [app.md](app.md) §6                       |
| `start-animation.js`                                                                | 开播动画编辑、轨道动效选择、固定 Browser Source 地址、人物图/音乐上传与清除、音量控制                                                      | [app.md](app.md) §6                       |
| `clock-card.js`                                                                     | 萌时钟固定地址、持久化设置、五套风格选择与横竖 iframe 实时预览                                                                             | [app.md](app.md) §6                       |
| `song-category-filter.js`                                                           | 分类/标签筛选工具(拆分、选中态读取)                                                                                                        | [app.md](app.md) §4                       |
| `gifts/index.js`                                                                    | 礼物面板统一渲染入口                                                                                                                       | [app.md](app.md) §5                       |
| `gifts/notification.js` / `detection.js` / `sprint.js` / `recent.js`                | 礼物通知 / 检测状态 / 月底冲刺 / 最近礼物                                                                                                  | [app.md](app.md) §5                       |
| `gifts/blindbox.js` / `blindbox-analysis.js` / `history.js`                         | 盲盒映射与统计 / 盲盒分析工作区 / 礼物历史抽屉                                                                                             | [app.md](app.md) §5                       |

### 4.2 播放助手 `public/js/playback/`(纯 ES Module)

入口链 `js/playback.js`(兼容层)→ `playback/index.js` → `playback/controller.js`(编排层)。模块树:`core/`(initializer/renderer/event-handlers)、`state/`(manager/storage)、`provider/`(manager)、`player/`(controller)、`queue/`(manager)、`services/`(search/stream/lyric/match/import/home/wesing)、`features/`(search/match/stream/queue-operations/playback-controls/lyric-controls/radio-mode/home/import/pending)、`operations/`(provider/state-persistence/playlist/cache)、`ui/`(index/components/playback-bar/queue-popup/drawer/fullscreen)、`content/`(loader)、`local/`(manager)、`cache/`(manager)、`config.js`、`utils.js`。逐模块说明见 [playback.md](playback.md)。

### 4.3 叠加层 `public/js/overlays/`

| 文件                                                                        | 说明                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay-utils.js`                                                          | 共享工具(转义/颜色/字体回退/滚动时长换算/低功耗判定),挂 `window.OverlayUtils`;模块消费者经 `overlay-utils-module.js` 具名导入 |
| `song-virtual-scroller.js`                                                  | 歌单虚拟滚动器(环形 DOM 窗口)                                                                                                                                          |
| `queue.js` / `songs.js` / `blindbox.js` / `overtime.js` / `lyric-window.js` | 各叠加层逻辑,详见 [overlays.md](overlays.md)                                                                                                                           |
| `games.js`                                                                  | 直播小游戏入口与会话渲染；你画我猜在本地预览图形后把直线/矩形/圆形拆为归一化坐标点，取色器只吸附到现有安全色板；通过 `danmaku-feed.js` 的显式 ESM 接口消费你画我猜弹幕 |
| `opening.js`                                                                | 开播动画 Browser Source：读取本地配置与用户上传人物图/音乐，未上传时无人物图且不播放音乐，并驱动人物待机与心形/灯带/流光轨道动画                                       |
| `clock.js`                                                                  | 萌时钟 Browser Source：读取已保存配置并兼容 URL 参数覆盖，按本地秒边界更新时间/日期、切换横竖设计画布并在页面隐藏时暂停调度                                            |
| `danmaku-feed.js` / `danmaku-message-renderer.js` / `danmaku-superchat-renderer.js` | 可复用弹幕：feed 拥有队列、布局与过期清理；消息渲染器构建普通弹幕和礼物 DOM，委托 SC 渲染器处理价格配色、对比色与卡片；图片解析能力由调用方传入 |

### 4.4 共享与入口 `public/js/`

| 文件                            | 说明                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `shared/utils.js`               | 全局工具 + 兼容层 `window.AdminApp.utils`(见 [comms.md](comms.md) §2)                |
| `shared/event-bus.js`           | `EventBus` 单例 + `Events` 常量(见 [app.md](app.md) §2)                              |
| `shared/logger.js`              | `Logger` 单例(挂 `window.AdminApp.logger`)                                           |
| `shared/theme.js`               | 主题配置加载(`/data/theme-presets.json`)与预设访问器                                 |
| `shared/lyric-word-renderer.js` | 逐字歌词渲染器(rAF 驱动,WeSing 面板/桌面歌词预览/歌词窗口共用)                       |
| `shared/parameter-range.js`     | Admin 参数滑块进度与零点区段同步；扫描显式 `parameter-range` 控件并维护轨道 CSS 变量 |
| `shared/color-control.js`       | `enhanceColorControls(root = document)` 原位增强原生颜色输入框，自动接入动态节点和克隆面板；同步用户选色、程序赋值及表单重置，不派发额外业务事件 |
| `shared/fit-text-to-width.js`   | `fitTextToWidth(elements)` 按元素可用宽度收缩字号；礼物横幅与粉丝档案名单共用，选择器与 DOM 查询留在各自视图 |
| `desktop.js`                    | 桌面外壳:更新检查/下载/安装、打开数据目录、`window.songAssistantDesktop` 检测        |
| `playback.js`                   | 播放助手兼容入口(`import './playback/index.js'`)                                     |

## 5. CSS 清单

`css/admin/gift-display.css` 保留原入口，按顺序加载 `gift-display/common.css`、`history.css`、`export.css`、`settings.css`，分别维护共用控件、礼物历史抽屉、导出预览和展示设置；各功能的响应式规则随 owner 保留。

| 文件                                 | 职责                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `css/styles-base.css`                | 设计系统:CSS 变量、重置、按钮/表单基类、spacing/radius/shadow 令牌                                                                                                                    |
| `css/styles-admin.css`               | 管理后台顶层样式(引用 admin/ 子目录)                                                                                                                                                  |
| `css/styles-playback.css`            | 播放助手顶层样式(引用 playback/ 子目录)                                                                                                                                               |
| `css/components/parameter-range.css` | 可复用参数滑块：`parameter-range` 为克制的天蓝默认款，按语义追加 `--tempo`（圆角方块）/`--scale`（圆环）/`--intensity`（短胶囊）/`--centered`（纵向椭圆）修饰类；不接管播放 seek/音量 |
| `css/components/color-control.css` | 公共颜色输入框：整条可点击，左侧色块与十六进制色值共用原生选择器；沿用输入框主题令牌，局部通过 `--color-control-height` 对齐邻近控件（默认 36px），色块随高度调整 |
| `css/components/contextual-help.css` | Admin `<lira-help>` 的统一问号与顶层说明样式；只允许按视口空间切换上下位置，不提供页面级视觉变体                                                                                      |
| `css/admin/*.css`                    | 管理后台分模块:workspace/layout/tabs/toasts/modals/collapsible/gifts/blindbox-analysis/overtime/toolbox/song-filters/desktop-lyric-preview/responsive                          |
| `css/playback/*.css`                 | 播放助手分模块:player/layout/panels/header/drawer/fullscreen/dialogs/queue-modal/song-row/desktop-lyric/responsive                                                                    |
| `css/overlays/base.css`              | 叠加层框架(classic/identity 队列主题、滚动动画、歌单板)                                                                                                                               |
| `css/overlays/blindbox.css`          | 盲盒叠加层动画与布局                                                                                                                                                                  |
| `css/overlays/overtime.css`          | 加班机叠加层(cq 单位 + 容器查询,见 [overlays.md](overlays.md) §4)                                                                                                                     |
| `css/overlays/clock.css`             | 萌时钟三套代码原生装饰卡片、横/竖透明时间轴与 reduced-motion 降级                                                                                                                     |
| `css/admin/workspace/song.css`      | 按原顺序导入 `song-management.css` 的歌曲资料与导入/云库表单、`song-layout.css` 的队列和工作区布局 |
| `css/overlays/desktop.css`           | 保留桌面样式入口，依次导入滚动条及 `css/desktop/theme.css`、`update.css`、`shell.css`；分别拥有暖金主题、更新/支持页和退出屏/标题栏/工作区布局 |

## 6. 静态资源

| 资源                                                                                                                                                         | 说明                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `img/overtime-machine/`                                                                                                                                      | 加班机内置背景:`midnight-grid.svg`、`gift-placeholder.svg`(占位图),选型见 ADR [0005-built-in-overtime-backgrounds](../../architecture/adr/0005-built-in-overtime-backgrounds.md)                                                                                      |
| `img/admin/gifts/bilibili-guard-*.png`                                                                                                                       | 大航海(总督/提督/舰长)图标,加班机内置三档守护礼物                                                                                                                                                                                                     |
| `img/playback/qqmusic-icon.png` / `img/playback/player-turntable-chassis.png` / `img/admin/gifts/gift-section-icon.png` / `img/shared/live-refresh-icon.png` | 播放器/礼物面板图标                                                                                                                                                                                                                                   |
| `data/theme-presets.json`                                                                                                                                    | 点歌板/歌单板主题预设，字段 schema 见 §6.1                                                                                                                                                                                                            |
| `data/cache/overtime-gift-catalog-v2.json` / `data/cache/overtime-gift-images/` / `data/cache/overtime-gift-assets-state-v2.json`                            | 运行时用户数据，不属于 `public/` 静态资源；分别保存服务器付费礼物元数据、首次授权后按精确 ID 准备的图片缓存和版本化扫描完成状态，不进入源码或安装包                                                                                                   |
| 字体                                                                                                                                                         | **无内置字体文件**(无 `@font-face`):全部走系统字体栈(Bahnschrift SemiCondensed 用于加班机数字,Bahnschrift 用于 LIVE 标签,Microsoft YaHei/PingFang SC 中文字体栈),见 [utils.js:5](../../../public/js/shared/utils.js#L5) 的 `multilingualFontFallback` |

礼物主目录由当前配置直播间的 Bilibili 礼物面板、`giftConfig` 和已配置的在售盲盒展开产生。LIRA Server 全局礼物目录不增加主目录成员；首次授权后，本地运行时保存其金瓜子正价子集并按精确礼物 ID 准备全部图片，供全局本地搜索、盲盒、历史高价值礼物和已保存规则复用。同名不同 ID 保持各自映射。服务器或图片不可用时保留礼物条目并显示 `gift-placeholder.svg`。因此源码和安装包不包含 `img/bilibili-gifts.json`、`img/bilibili-gifts/` 或三份旧礼物 Markdown。

### 6.1 data/theme-presets.json 格式(唯一成文处)

由 `shared/theme.js` 的 `loadThemeConfig()` 在页面启动时加载，结果挂 `window.AdminApp.theme`。

顶层结构：

```json
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

`default` 保存默认主题值。`classic` 组的预设名（如 `pure`/`cream`/`sky`/`peach`/`mint`/`sakura`/`starry`/`ocean`/`sunset`/`cyber`/`gold`/`lavender`/`emerald`/`rose`）共 14 套；`songBoard` 组共 14 套（名称可能不同）。预设只保存当前表单和渲染器消费的字段。

`ThemeSnapshot`（点歌板预设）的 17 个键：

| 分组      | 键                                                                                                                                                                   | 类型/值域       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 基色      | `themePrimary` / `themeAccent` / `themeText` / `themeBackground`                                                                                                     | `"#rrggbb"`     |
| 面板      | `themeOpacity`(`"0.00"`–`"1.00"`) / `themeRadius`(px 字符串) / `backdropBlur`(px) / `glowIntensity`(0–?)                                                             | string 数字     |
| 渐变      | `enableGradient`(`"true"`/`"false"`) / `gradientEnd`(`"#rrggbb"`)                                                                                                   | string          |
| 字体      | `overlayFontFamily`(CSS font-family) / `overlayFontWeight`(`"400"`–`"900"`)                                                                                          | string          |
| 颜色      | `overlaySongColor` / `overlayRequesterColor`                                                                                                                         | `"#rrggbb"`     |
| 字号      | `queueSongFontSize` / `queueTitleFontSize`                                                                                                                           | string 数字(px) |
| 滚动      | `queueScrollSpeed`(像素/秒)                                                                                                                                        | string          |

`default` 另含 `overlayLowPowerMode`、`overlayTitle`、`overlayShowIndex`、`overlayIndexThreshold`、`overlayIndexColor`、`queueFixedSixRows`、`queueScrollMode`，共 24 个键。

`SongBoardSnapshot` 使用 `songBoardThemePrimary`、`songBoardThemeAccent`、`songBoardThemeText`、`songBoardThemeBackground`、`songBoardThemeOpacity`、`songBoardThemeRadius`、`songBoardBackdropBlur`、`songBoardGlowIntensity`、`songBoardEnableGradient`、`songBoardGradientEnd`、`songBoardFontFamily`、`songBoardFontWeight`、`songBoardSongColor`、`songBoardTitle`、`songBoardSongFontSize`、`songBoardTitleFontSize`、`scrollSeconds`，共 17 个键。`classicSwatches`/`songBoardSwatches` 每项为 4 元素数组 `["#背景","#主色","#强调色","#文字色"]`，用于预设选择器的色块预览。

## 7. 礼物完整历史页面（Implemented）

`gifts/history.js` 统一持有请求代次、分页、取消和重试；`gifts/history-view.js` 负责状态及行展示，沿用安全转义。

客户端“最近礼物 → 查看全部”使用逐行礼物流水表：标题与操作按钮、时间/礼物/数量/金额/用户/备注六列表格、底部翻页。不显示名称搜索、日期范围控件或独立同步信息栏，固定以 `range=all` 读取全部历史并保留复合 keyset 翻页。数量位置只显示已读取的数量；未完成同步的空列表显示等待提示，确认同步完成后才显示“暂无礼物记录”。已有记录时更新提示位于标题下，加载失败保留当前列表；无记录时提示位于表格内，不重复展示底层错误。统计摘要、排行和趋势由服务器网页界面承载，不放进客户端流水抽屉。抽屉移除仅清理显示的操作；“清空全部记录”明确提示不可撤销，并先通过 Electron main 的 DeviceBearer 清空当前认证主播的服务器礼物 ledger/outbox，只有服务器成功后才清当前本地 source。清空结果与后续列表更新分别显示；无法确认远端结果时不承诺记录未删除。抽屉打开期间对来源未就绪、同步未完成、离线和读取失败自动重读，15 秒后降低重读频率并提供手动重试；手动重试只读取，不重复删除。关闭抽屉取消读取和定时器，失效响应不能覆盖新状态。抽屉只调用当前 source 的本地 `/api/gifts/history`，不接收或提交 `sourceId`、Device token、bootstrap token 或远端 cursor。新增模块使用具名 ESM import/export，不扩大 `window.AdminApp` 兼容层；详细契约见 [gift-ledger-projection-sync_design.md](../../../specs/gift-ledger-projection-sync_design.md)。

弹幕工具页面现有签到/抽签位置保留两个云端开关和最后确认时间；一次性旧数据面板完成接管后隐藏，两项不再有日常词库编辑按钮。入口仍为现有 admin 弹幕工具，未增加页面 URL。


## 投票与评分页面

`/interactions` → `public/pages/overlays/interactions.html` → `public/js/overlays/interactions.js`，只读 浏览器源，推荐 800×600。类别 3 主持表单位于小游戏片段，由 `public/js/admin/interactions.js` 初始化，独立链接使用实际本地端口。投票首次有效、评分末次有效；支持开始、提前结束/公布平均分、取消与关闭结果。类别 1/3 进行中互斥，保留结果可同时展示。

共同文本验证、布局估算在 `public/js/shared/interaction-rules.js`，同步代次在 `interaction-client.js`，安全文本结果行在 `interaction-view.js`。后台人数轮询随面板可见性启停；新场清掉旧结果，未结算均分留空。
