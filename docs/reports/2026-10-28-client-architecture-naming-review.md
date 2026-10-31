# LIRA 客户端架构与命名审查报告

日期：2026-10-28\
基线：`7caf830e66d913f615a6cca5d63718db65c668ab`（v5.7.2）加当前完整工作树，包括已有未提交及非忽略未跟踪源码。\
配套：[审查提示词](2026-10-28-client-architecture-naming-review-prompt.md)。

本报告以“新维护者下载项目后能否正确理解架构与名称”为视角，审查当前客户端。2026-10-28 同日复核了原报告的 20 项候选，修正问题归类、严重度与建议成本；保留原 F 编号以便对照。**§1–8 保存整改前的审查证据，问题数不是当前未结项；随后用户授权实施，保留的 11 项已按报告落实，当前结果见 §9。** 复核阶段仅修订审查材料，实施阶段也未改变架构决策或将建议标记为新的 Accepted 规格。

## 1. 结论摘要

**当前架构总体合适：保留 Electron + Node.js 本地优先模块化单体，不需要结构性调整。** 进程边界、组合根、领域目录、SQLite owner、Admin 页面组合、overlay 消费边界、原生音频工作程序以及安装包源码/资源划分均有可辨认的 owner，且与现行架构文档和 ADR 基本一致。

复核后保留 **11 项**：**P1 0、P2 2、P3 9**。原 20 项中，**9 项改为记录项，5 项从 P2 降为 P3**。原报告的大部分代码事实成立，但把纯契约引用、不同作用域的同名变量、已有说明的兼容名称和可选导航优化也计为问题，存在过度审查；事实存在不等于必须整改。

两项 P2 分别是：

1. **F-04，明确的 API 回执错误：** Kimi 等 API 连接测试成功后返回 `provider: 'deepseek'`，已用模拟响应复现。当前设置页不读取该返回字段，尚未证明界面显示错误。
2. **F-01，明确的共享目录边界债务：** `shared/browser-source-frame.js` 依赖 overlay 效果运行时，与现行 Stable Shared 规则不符。资源通过显式调用创建、释放，未证实导入即启动资源、泄漏或重复初始化。

其余保留项是命名或文档消歧，主要随相关维护处理；F-07、F-15 的错误文档可以独立修正。Storage 对纯礼物别名契约的依赖不再判为私有实现越界；当前也没有第二份活动 cursor 状态源。没有证据支持拆微服务、引入前端框架、按文件行数拆分或大规模统一改名。HTTP、WS、IPC、URL、配置键、持久化字段和全局桥名称继续保持兼容。

## 2. 范围、方法与限制

### 2.1 覆盖方式

- 完整枚举 `src/` 下 **481 个 JavaScript 文件**、`public/js/` 下 **452 个 JavaScript 文件**、`public/pages/` 下 **113 个 HTML 页面/分片**及主要 CSS 路径；审查目录和文件名，不把行数当作缺陷。
- 深入核查后端/Storage、Electron/IPC/打包、Admin/Playback/overlay/shared 的主要入口、顶层导出、组合根、关键状态与真实调用方。
- 补查 `src/fans/`、`src/scenes/`、`src/fonts/` 和 `native/audio-assistant/` 的主要类、投影、资源与数据方向；原生范围为 14 个 C# 源文件。
- 核对 `package.json` 的 files/extraResources、维护中的 NSIS 分片、afterPack/afterSign、安装器验证、双语 README 和相关 owner 文档。
- 每项发现至少核对定义和一个真实调用/契约；重要问题核对定义与使用双证据。历史报告只用于去重，不直接继承旧结论。

本次复核逐项核对原 20 项的定义、消费者及直接相关规范，重新确认上述源码数量，并对 F-04 注入模拟 `fetchImpl` 复现回执错误。它不是一次新增的全仓逐行审计，也不把某项候选被排除理解为其所在模块已无其他缺陷。

这属于“**全量目录/文件名覆盖 + 关键符号深入抽查**”，不是对九百余个 JavaScript 文件逐行、逐一局部变量的形式化全审。报告不会把静态搜索命中直接当成架构违规。

### 2.2 排除项

不读取真实用户数据库、Electron profile、Cookie、秘密或日志；不审查 `node_modules/`、`release/`、`tmp/` 的运行内容；不展开与架构/命名无关的视觉、算法、性能、安全漏洞和格式化检查。未执行 fresh clone、真实 Electron 启动、安装器构建、安装/卸载、在线更新或真实模型请求，因此“下载后结构合适”是源码与打包配置结论，不是一次新的安装验收。

## 3. 源码所示的架构地图

| 路径/边界 | 实际职责 | 审查判断 |
| --- | --- | --- |
| `src/electron/entry.js` | 加载桌面组合根；同步启动失败时诊断、提示并确定退出 | 不是第二组合根，名称与角色合理 |
| `src/electron/main.js` | Electron 接线、窗口、数据目录、控制器与统一生命周期 | 大文件本身是复审信号，不构成拆分理由 |
| `src/electron/desktop-runtime.js` | 将本地 server runtime 适配给 Electron | 适配器位置准确 |
| `src/server.js` | 本地 HTTP/WS、领域服务、存储的组合根与启停次序 | 与 Electron main 同进程运行，不是额外服务进程 |
| `src/server/routes/` | HTTP 传输适配；`src/server/*-runtime.js` 做应用协调 | 总体未直接持有 SQLite，分层名称可理解 |
| `src/music/`、`src/bilibili/`、`src/overtime/`、`src/ai/`、`src/games/` | 领域规则、上游协议与领域服务 | 领域目录稳定；局部模型/礼物归属问题见发现 |
| `src/fans/`、`src/scenes/` | 粉丝档案规则/投影、本地场景文档/输出/传输 | `profile-projection` 和场景类型投影回执均名实相符 |
| `src/storage/` | SQLite、迁移、事务、retention 与领域 store | 主体边界清楚；可依赖纯领域契约，不能仅凭 import 路径认定越界 |
| `src/shared/`、`public/js/shared/` | 稳定纯契约、跨表面纯 helper 与明确的兼容出口 | shared 运行时例外需明确归属；纯领域契约不必为了路径整齐搬入 shared |
| `public/js/admin/` + `public/pages/admin/` | Admin 交互与固定白名单页面分片组合 | 没有单一 `admin.html` 是现行约定，不是缺文件 |
| `public/js/playback.js` + `public/js/playback/` | 前者为兼容入口，后者由 controller 组合播放状态、队列、Provider 和 UI | 同名文件/目录表示入口与模块树，可保留 |
| `public/js/overlays/` + `public/pages/overlays/` | 受限展示页面、场景输出、传输与视觉效果 | 同时服务 OBS 和哔哩哔哩直播姬，不专属于某一直播软件 |
| `native/audio-assistant/` | 同一 EXE 的助手、路由守护/恢复和播放输出模式 | 由 Electron 惰性启动，经管道通信，不开放新服务端口 |
| LIRA Server | 远端认证、云同步、权威礼物和云端机器人 | 与本机 HTTP/WS、Bilibili 平台和直播软件术语区分正确 |

### 3.1 源码、生成物和运行时数据

- `package.json` 随包收集 `src/**/*`、`public/**/*`、图标与生产依赖，排除维护元数据和独立分发素材；原生助手由忽略的 `build/audio-assistant/` 经 `extraResources` 进入安装包。
- 开发数据位于仓库根 `data/`，由 `.gitignore` 排除；`node_modules/`、`release/`、`tmp/` 和日志也有明确边界。
- 安装版业务数据、浏览器数据、日志和更新目录由 desktop data owner 与 NSIS 维护；升级备份/恢复和默认卸载保留符合 ADR-0015/0016。
- 已跟踪图标输入/输出与忽略的原生构建中间件不是同一类文件。没有证据表明运行时数据库或秘密被写入 ASAR。

## 4. P2：明确的回执错误与共享目录边界债务

### F-01 [P2] `shared/browser-source-frame.js` 反向依赖 overlay 并持有运行时资源

- **位置：** `public/js/shared/browser-source-frame.js:1-24`；消费者 `public/js/admin/browser-source-preview.js:5`、`public/js/overlays/scene-renderer.js:3,30,63`。
- **证据：** 文件从 `../overlays/component-style-effects.js` 导入工厂，以模块级 `WeakMap` 保存效果控制器，configure/dispose 显式创建和释放 DOM 效果资源。[模块化规范 §2.1、§6](../architecture/engineering/modularity-standard.md) 将 Stable Shared 限定为纯 helper/契约，不承载运行时资源；这里存在实际的规则偏离。
- **影响与边界：** 目录归属可能让后续消费者低估生命周期职责。但当前两个消费者均有显式释放调用；`import` 本身没有创建观察器或滤镜，不能据此断言泄漏、重复绑定或运行故障。P2 表示边界债务，不表示紧急用户故障。
- **建议：** 在处理该边界时，将现有适配模块归入明确的 browser-source/overlay 运行时 owner，保留两个消费者共用 configure/dispose 的方式，不新增运行时层或复制实现。依赖方向调整按 `PLANS.md` 执行，并同步相关 import、owner 路径与现有 browser-source 验证；不改场景 URL 或持久化格式。

### F-04 [P2] 非订阅 API 连接测试把供应商固定报告为 DeepSeek

- **位置：** `src/ai/deepseek-client.js:235-276`；现有 provider 解析 `:115-119`；公开出口 `src/server/routes/ai-routes.js:178-190`；界面消费者 `public/js/admin/ai-assistant-settings.js:281-293`。
- **证据：** Doubao 和 ChatGPT 订阅有专门分支，其他 API 配置成功时都返回 `provider: 'deepseek'`。模拟 `fetchImpl` 返回成功的 Chat Completions 响应后，Kimi 配置得到下列结果，没有访问外部网络或真实账号：

  ```json
  {"configuredProvider":"kimi","endpointProvider":"kimi","returnedProvider":"deepseek","requestHost":"api.moonshot.cn","network":"stub only"}
  ```

- **影响与边界：** `/api/ai/test` 和兼容的 `/api/ai/test/deepseek` 会返回错误的供应商元数据。当前设置页按请求侧 provider/label 展示结果，没有使用 `result.provider`；模型请求日志则已调用 `describeModelEndpoint()`。因此不能把本项扩大为“已导致界面或请求日志归属错误”，也没有证据表明请求被发给了错误供应商。
- **建议：** 保留响应字段和兼容路由，复用现有 `describeModelEndpoint(url, protocol, modelProvider).provider` 解析，覆盖 `auto` 配置，不能简单用可能仍为 `'auto'` 的 `config.modelProvider`。扩展 `test/ai/ai-provider-adapters.test.js` 已有 Kimi 连接用例的返回值断言，并检查 auto/custom 语义；无需另建测试设施。本项可独立于 F-03 修正。

## 5. P3：命名与文档消歧

以下项目不要求为了清单单独重构。F-07、F-15 是可独立修正的文档事实错误，其余主要随相关代码的实质维护处理。

### F-03 [P3] 多供应商统一模型门面仍以 DeepSeek 命名

- **位置：** `src/ai/deepseek-client.js:9-56,78-104`；`src/server/ai-runtime.js:32-41`；`src/ai/ai-assistant-service.js:47-59`。
- **证据：** `createDeepSeekClient` 实际承担 Doubao、ChatGPT 订阅及多个 API 供应商的统一出口，注入依赖仍命名为 `deepseek`。内部已有按配置分流和 endpoint 解析，不是因名称而固定发送给 DeepSeek。
- **误读：** 文件/工厂名比真实职责窄，容易误判 adapter 与统一门面的边界；尚无因该内部名称导致错误路由的证据，原 P2 偏重。
- **建议：** 随模型模块维护考虑统一为 `model-client.js` / `createModelClient` / `modelClient`；改名前核对内部消费者。仅在确有兼容消费者时保留旧出口，并说明退出条件。`deepseekResponsesUrl`、`deepseekApiKey`、错误码及兼容路由保持不变，不批量改所有 DeepSeek 字样。

### F-05 [P3] `remote-gift-cursor-store.js` 同时保留旧 JSON store 与当前 source 身份规则

- **位置：** `src/electron/remote-gift-cursor-store.js:8-18,38-81,99-104`；生产调用 `src/electron/remote-gift-controller.js:5,131-139`。
- **证据：** 文件同时导出旧 `remote-gift-cursor.json` store 和生产使用的 `createRemoteGiftSourceKey`。当前 controller 只导入 source key；检索 `src/`、`public/` 和 `test/` 未发现旧 JSON store 的调用。[存储参考](../reference/backend/storage.md) 已明确 SQLite `gift-sync-store` 持有当前进度，JSON 不再作为状态源。
- **误读：** 活跃身份算法位于旧 store 文件中，查找 owner 不直观；但当前没有双写或第二份活动 cursor 状态源，原报告将未来误接的可能性提到 P2 缺乏证据。
- **建议：** 最低成本是在文件中标明当前状态 owner 与旧导出的状态；下次修改 source 规则时再考虑独立 `remote-gift-source.js`。旧 store 的删除不属于本项必需整改。不得改变 `gift-source-v2`、哈希输入或现有 SQLite source 对应关系。

### F-06 [P3] `update-ipc.js` 名称窄于其桌面外壳 IPC 职责

- **位置：** `src/electron/ipc/update-ipc.js:5-98`；组合根 `src/electron/main.js:450-468`；桥 `src/electron/preload.js:53-99`。
- **证据：** 除更新外，该 registrar 还注册应用信息、数据/日志目录、GitHub、资源完整性、重启、兼容礼物展示和窗口最小化/最大化/关闭。
- **误读：** 文件名不利于定位窗口/目录相关通道；但这些能力仍属于同一桌面外壳，已有明确注册表，无须据此拆分 IPC 或调整权限。
- **建议：** 随相关维护补职责注释，或统一内部文件/工厂为 `desktop-shell-ipc.js` / `registerDesktopShellIpc`，同步 main、测试与 owner 文档。所有 `desktop:*` 通道、载荷、来源校验和 `songAssistantDesktop` 全局名不变。

### F-07 [P3] “礼物姬六页共用单次初始化入口”的文档表述不准确

- **位置：** `public/js/admin/gift-assistant.js:7-13`；`public/js/admin/app.js:77-95,187-189`；`docs/reference/frontend/app.md:362`。
- **证据：** `initGiftAssistant()` 只初始化滚动礼物、许愿和冲刺；全屏感谢由 `initGiftFrame()`、大航海由 `initGuardThanks()` 在启动时初始化，盲盒属于 settings 组合。六个 feature ID 复用 loader，不代表六页的业务绑定均由同一 initializer 拥有。
- **误读：** 文档会让维护者找错业务初始化入口；当前 `gift-assistant.js` 有单次初始化保护，未发现由此造成重复绑定。原 P2 以及“三个不同初始化 owner”的标题均不够准确。
- **建议：** 修正 owner 文档，按实际能力列出初始化归属，区分共享加载触发器与业务初始化；无需重命名工厂或重排六页。

### F-09 [P3] 原生 `OpenInput` 被输出路径复用，错误提示仍称输入设备

- **位置：** `native/audio-assistant/AudioDevices.cs:81-89`；输出调用 `PlaybackOutputs.cs:54,87`、`PlaybackOutputContext.cs:22`；真实输入调用 `DeviceCapture.cs:18`。
- **证据：** `OpenInput(id, loopback)` 在 `loopback=true` 时选择 `DataFlow.Render`；这对 loopback 采集是正确的。纯输出设备解析、创建和健康检查也复用它，端点方向选择仍正确，但异常文本统一为“输入设备不可用”。
- **误读：** 输出调用中的方法名与错误文本容易让人误查输入设备。未证明输出端点选择或播放功能错误，不能因 Render 出现在输入 helper 就判断数据方向反了。
- **建议：** 下次维护设备路径时让 helper 名称覆盖端点解析，并按使用场景澄清错误文本；`OpenEndpoint(id, DataFlow flow)` 是一种可选实现，不是修复播放故障的必需 API 改造。若改内部 API，覆盖输入/loopback/输出调用并运行现有原生验证；不改 IPC 字段。

### F-10 [P3] `gift-export-runtime` 实际还持有同步与来源切换门面

- **位置：** `src/server/gift-export-runtime.js:7-65`；`src/server.js` 中以 `giftRuntime` 使用。
- **证据：** 除导出准备/设置外，还包含 gift cards、`configureGiftSync`、投影重建、远端历史清理、active source 切换与广播。
- **误读：** 按文件名查找来源切换 owner 时可能绕过它，或把同步功能误认为可随导出功能移除。
- **建议：** 随相关维护补充文件头职责即可；确需改名时使用覆盖现状的 `gift-runtime` 命名并同步消费者和 owner 文档。不拆分状态，不改 HTTP/WS。

### F-12 [P3] 通用 `hasExactOrigin` 归属在 local-media allowlist 模块

- **位置：** `src/electron/local-media-access.js:60-66,83`；非媒体调用包括 `ipc/main-window-ipc.js`、`client-appearance.js`、`audio-media-cors.js`、`desktop-resource-integrity.js`。
- **证据：** 函数只比较两个 URL 的 `origin`，却被多类 IPC、CORS、外观与资源检查依赖。
- **误读：** 可能把它误当 local-media 专用规则修改，或为避开音频模块依赖而复制另一份判断。
- **建议：** 随相关维护明确其桌面来源比较职责即可。若需要移动，选择职责一致的窄 owner，并覆盖已有来源校验测试；`external-url-policy.js` 当前负责外链打开与登录导航，不因名称含 URL 就当然适合接收受信 IPC 的 origin 判定。保持比较语义，不合并不同安全策略、不新建通用 utils 聚合桶。

### F-15 [P3] 主进程 owner 文档存在多处旧符号和入口表述漂移

- **位置：** `docs/reference/desktop/main.md:194,210-229`；当前实现 `src/electron/entry.js:3-20`、`src/electron/main.js:450-507`、`src/electron/desktop-runtime.js`。
- **证据：** 文档仍写 `configureUpdateIpc/configureMusicIpc/configureBilibiliIpc`、`updateMgr`、顶层 `desktopRuntime`，与当前 `register*`、更新适配器和 `lifecycleState.runtime` 不符；`createDesktopRuntime` 链接也指向 main。“entry 只依赖 Electron”还遗漏组合根加载失败后尽力加载本地诊断模块的路径。
- **误读：** 按文档搜索会找不到真实调用点，可能恢复旧接线或删除入口诊断回退。
- **建议：** 只更新符号、定义链接和入口表述，不改生命周期顺序。代码本身无需因此调整。

### F-20 [P3] `HomeService._applyBackgroundUpdate()` 名义私有，实际是跨模块公开写入口

- **位置：** `public/js/playback/services/home-service.js:266-282`；真实调用 `public/js/playback/controller.js:99-113`。
- **证据：** 组合根直接调用该方法，并依赖布尔结果决定渲染与提示；下划线却通常表示类内部 helper。
- **误读：** 与同类中其他下划线 helper 的内部使用习惯不一致；不过这不是 JavaScript `#private`，调用合法，现有注释与 playback 文档也已记录后台刷新用途，风险有限。
- **建议：** 下次维护该回调时，考虑方法与唯一生产调用统一为 `applyBackgroundUpdate()`，同步 playback owner 与相关测试；保持请求代际和平台校验。无需为这一符号安排独立重构。

## 6. 合理设计、兼容边界与排除项

### 6.1 原报告中移出问题计数的 9 项

以下保留代码事实与排除理由，不列入整改清单，也不以新编号重新包装为问题。

| 原项 | 复核事实与依据 | 处理结论 |
| --- | --- | --- |
| F-02：Storage 引用礼物别名 | `src/bilibili/gift/guard-gift-aliases.js:3-29` 仅导出不可变别名和纯函数，两个 Storage 消费者使用同一礼物身份语义；没有加载 Bilibili runtime 或可变服务状态。模块化规范 §2.1 允许 Infrastructure 依赖 Domain contracts；没有证据仅凭目录位置将该纯导出认定为私有实现。 | 撤销 P2。可以明确其契约用途，但不要求搬到 shared，更不应重复实现别名。若发现真实的契约变更冲突，再评估 owner。 |
| F-08：两种 `sceneMode` | `component-preview-client.js:22,26,40,50` 是函数内布尔值；`scene-extra-components.js:18` 是背景配置字段。前者来自 `isSceneComponent()`，不读取或写入后者，没有共同状态或字段转换。 | 撤销 P2。相同单词在不同作用域表达不同模式并不足以构成跨层冲突，没有混用证据。 |
| F-11：shared 的礼物身份校验 | `src/shared/gift-identity.js:29-47` 校验礼物 ID、名称、variant 哈希和价格/币种/背包身份，不处理加班时长或规则执行；报错也是通用的重新选礼物提示。当前生产消费者是 `overtime-contract.js:57-60`，[身份规格](../../specs/gift-identity-overtime.md#ownership-and-verification) 已将该 shared 文件列为 owner。 | 撤销 P3。只有一个消费者不等于放错目录，未证明需要把纯身份校验搬入 overtime。 |
| F-13：`migrateUserDataFromAppData` 名称较宽 | `src/electron/main.js:814-832` 只复制 `Partitions`，函数前注释明确说明；`docs/reference/desktop/main.md:213` 也将该阶段标为登录分区迁移，完整数据迁移由另一阶段负责。 | 撤销 P3。较具体的内部名称属于可选改进，现有上下文已足以区分职责；没有迁移缺漏或重复迁移的证据。 |
| F-14：`songAssistantDesktop` 历史桥名称 | `preload.js:53-99` 与 `docs/reference/desktop/preload.md:58-83` 清楚列出当前桌面能力和调用方，是受兼容约束的公共命名空间。 | 撤销 P3。保留公共桥；可补历史说明，但不能仅因产品名称演变就认定存在另一产品或要求新增桥。 |
| F-16：README 未直链构建文档 | 双语 README 的文档区已链接文档总索引和架构入口；架构入口可到达 `docs/reference/engineering/build.md`，后者明确区分桌面启动与 Node 调试。没有错误命令或失效入口。 | 撤销 P3。添加直接构建链接是可选的导航优化，不能把多一次文档跳转计作架构/命名缺陷。 |
| F-17：`noScroll` 的兼容语义 | `blindbox.js:40,59-62,185-190` 在隐藏手动滚动条时启用自动翻页；`scene-extra-components.js:160` 的用户标签为“自动翻页”，`docs/reference/frontend/overlays.md:423-424` 已完整解释旧参数与 `blindboxAutoPages` 的关系。 | 撤销 P3。行为与现有兼容契约一致，没有判断方向接反的证据；无需修改 URL、配置或内部名称。 |
| F-18：浏览器预览的 remote 名称 | `component-preview-remote.js:6,88-112` 的工厂及连接器，通过同源 `/api/component-preview` 与桌面持有的预览会话通信；`docs/reference/frontend/overlays.md` §6.4 已描述网页与客户端中继。 | 撤销 P3。remote 是相对会话 owner 的合理命名，不自动表示云服务器；当前没有误接 LIRA Server 的证据。 |
| F-19：组件分片位于 `toolbox/` | `public/pages/admin/live-components/page.html:187-195` 显式 include 旧目录中的五份分片，`docs/reference/frontend/pages.md` 记录实际路径，现有测试也按这些路径读取。 | 撤销 P3。是可追踪的历史布局，没有错误路由或重复渲染证据，不因导航分组变化安排文件搬迁。 |

### 6.2 其他合理设计与已登记债务

| 候选 | 不列为问题的原因 |
| --- | --- |
| `src/server.js`、`src/electron/main.js` 等文件较大 | 当前主要是组合与统一生命周期；模块化债务已有 owner 和保护，行数不是自动拆分条件 |
| `window.AdminApp`、IIFE、`shared/utils.js` | legacy 边界、递减规则和兼容条件已登记，不重复计为新发现 |
| `src/bilibili/gift/index.js` context fallback | 已登记的兼容 facade，生产组合显式注入窄 store |
| `component-preview*` 历史命名 | 同时覆盖兼容 URL、消息协议和中继会话；文档已区分编辑器、预览会话与正式 `/scene` 输出 |
| `/songs` ↔ `songs.html`、`/songlist`，`/lyrics` ↔ `lyric-window.html` | 已文档化公共 URL 映射，不能为名字整齐直接改 URL |
| Playback 两类 cache manager | 一个管理前端内容缓存，一个管理后端音乐文件缓存操作；真实函数与 owner 足以区分，不应合并 |
| `scene-output-projection.js` | 实际签发/验证“活动组件类型投影回执”，API 与测试使用同一术语，不是错误命名为数据投影 |
| `profile-projection.js` | 按 scope/profile 缓存会员与提醒计算，返回副本；名称与职责一致 |
| `src/fonts/` | 字体目录、下载、校验、缓存与 stylesheet owner 清楚，属于设备级可重建资源 |
| `src/shared/bilibili-value-contract.js` 等领域名 shared 文件 | 是纯稳定跨层契约，不能仅因含领域名机械迁回平台 runtime |
| `remote-license-client` / `license-operations` 聚合多领域端点 | 属已记录渐进整理范围；本次不重复立为新架构问题 |
| `liraLicense`、`license:*`、旧 source key 等公共名称 | 公共或持久化兼容成本高于改名收益，不要求改名 |
| OBS 与哔哩哔哩直播姬 | 均为浏览器源消费方；Bilibili 是直播平台，术语未见混用 |
| `roomId` 与 `streamerId` | 前者是 Bilibili 外部房间属性，后者是稳定租户身份；未发现把 roomId 当授权边界的命名结论 |

## 7. 建议处理顺序

### 值得独立处理的事项

1. **F-04：** 修正连接测试的 provider 回执，复用现有 endpoint/provider 解析，扩展已有 Kimi 用例并核对 auto/custom 语义；不同时批量重命名模型模块。
2. **F-07、F-15：** 修正文档中错误的初始化归属、旧符号和定义链接，按当前实现核对；无需改业务接线。
3. **F-01：** 作为范围明确的边界债务评估归属调整。若实施，按 `PLANS.md` 处理依赖方向变更，保留现有生命周期和两个消费者共用实现；不将其包装为已发生的资源故障。

### 随相关代码下次修改时处理

- **F-03、F-05、F-06、F-09、F-10、F-12、F-20：** 优先选择注释、错误文本或必要的局部名称消歧；没有相关实质变更时可以不动。不要为完成清单批量触碰模型、原生音频、场景、播放和存储。
- §6.1 的 9 项不产生迁移或改名任务。尤其不要求移动礼物别名与身份校验、重命名持久化 `sceneMode/noScroll`，或搬迁五份页面分片。

**最终结论：保留当前架构并局部消歧。** 不建议新增服务、框架、前端构建步骤、DI 容器，或大规模目录/公共契约重命名。

## 8. 验证与同步结果

- 本次复核已运行 `npm run verify:architecture`：**28 项通过，0 失败**。覆盖现有 ESM 标识符、选定依赖方向、Storage/组合根/overlay/Admin legacy 等架构门禁及规模报告测试。
- 本次复核已运行 `npm run verify:docs`：**10 项通过，0 失败**，覆盖当前/历史文档相对链接与导航；仍有现存的 module-type 警告，不影响结果。
- 已核对原 20 个 F 编号均有且仅有一个处置结果：11 个问题条目、9 个记录项，与 P1/P2/P3 计数一致。
- `git diff --check` 通过；两份未跟踪审查文件另与复核前快照执行 `--no-index --check`，均无 whitespace 问题。Git 的 LF/CRLF 提示不影响结果。
- F-04 使用当前生产工厂和模拟 `fetchImpl` 复现：配置/解析均为 Kimi，返回仍为 DeepSeek；未修改源码或永久测试，未访问真实服务。已有 Kimi 连接测试验证请求格式，但没有断言连接结果的 provider。
- 门禁输出的文件规模信息只是 review signal，没有被转换为本报告的问题；门禁通过也不证明所有命名和前端语义依赖正确。
- 本次仅修订报告与配套提示词，报告索引的现有链接继续有效。不改实现，因此无需运行业务全量测试；未做真实账号、网络、Electron、原生设备或安装器验收。
- 测试同步：未改变行为，未修改测试；F-04 的断言补充属于后续修复建议，当前缺陷仍存在。
- 技术文档同步：报告修正问题归类，提示词补充严重度与排除条件；F-07、F-15 的 owner 文档漂移仍如实记录，未在本次报告复核中顺带整改。
- 用户指南同步：未改变功能、入口或操作步骤，无需改用户指南；F-16 仅保留为可选导航优化。

### 剩余限制

本报告提供当前静态结构与名称的证据及判断，不证明所有运行时行为正确，也不构成每个局部变量的穷举审查。F-04 的模拟响应证明返回字段不一致，不能替代供应商在线验收；F-09 未经原生设备复现，不判定音频方向故障。未重新构建安装包，安装边界结论来自现行打包配置与已有验证路径，而非本轮新生成的安装证据。

**复核计数：P1 0、P2 2、P3 9；另 9 项为记录项，不计入问题数。最终结论：保留当前架构并局部消歧。**

## 9. 整改实施与验证（2026-10-28）

用户授权按复核报告实施后，11 项均已处理。9 个记录项保持排除结论，未据此迁移礼物别名/身份校验、重命名公共桥或配置键、搬迁历史页面分片。实施记录见[归档计划](../../specs/plans/archive/2026-10-28-client-architecture-naming-remediation.md)。

### 9.1 逐项结果

| 编号 | 已落实的改动 | 当前证据与验证 |
| --- | --- | --- |
| F-01 | 将现有 browser-source DOM 适配器移入 overlays，Admin 预览与 scene renderer 更新导入，保留同一 configure/dispose 实现 | [browser-source-frame.js](../../public/js/overlays/browser-source-frame.js)；新增目录枚举依赖检查在移动前失败、移动后通过；已有浏览器源编辑、保存、发布、重开及保密验证 9/9 通过 |
| F-03 | 统一多供应商门面为 `model-client.js` / `createModelClient`，助手服务注入改为 `modelClient`，同步 ChatGPT 解析消费者及测试 fixture | [模型门面](../../src/ai/model-client.js)、[AI 组合根](../../src/server/ai-runtime.js)；生产源码、测试和当前 owner 文档没有旧工厂/模块引用，AI 相关 309/309 通过；配置键、专属 DeepSeek 分支和兼容路由保留 |
| F-04 | 成功回执复用现有 endpoint/provider 解析，正确返回 Kimi、auto/custom 与官方 DeepSeek 归属 | 扩展[现有供应商适配测试](../../test/ai/ai-provider-adapters.test.js)并同步 custom URL 的原断言；旧实现先复现 3 个失败，修复后供应商相关 30/30、AI 309/309 通过；没有新增真实网络请求 |
| F-05 | 在旧 JSON store 和活跃 source key 定义处分别说明状态与身份归属 | [remote-gift-cursor-store.js](../../src/electron/remote-gift-cursor-store.js) 仅新增职责注释；SQLite 仍是生产进度 owner，哈希输入及旧导出未改；来源身份隔离测试通过 |
| F-06 | 内部 registrar 改为 `desktop-shell-ipc.js` / `registerDesktopShellIpc`，同步 main、测试 fixture 与桌面参考 | [桌面外壳 IPC](../../src/electron/ipc/desktop-shell-ipc.js) 相对旧实现仅工厂及导出名称改变；通道、载荷、来源/帧校验保持原样，来源校验与 shutdown 等相关测试通过 |
| F-07 | 文档明确滚动/许愿/冲刺、全屏感谢、大航海和盲盒各自的业务初始化 owner，与共享 loader 区分 | [Admin 参考](../reference/frontend/app.md) 与 `gift-assistant.js`、`app.js`、settings 组合对照；未改业务绑定或导航 |
| F-09 | 用 `OpenEndpoint(id, DataFlow)` 表达端点解析；输入/loopback 保持 Capture/Render，输出显式 Render，错误文本区分方向 | [AudioDevices.cs](../../native/audio-assistant/AudioDevices.cs) 及五处调用；隔离 SDK 10.0.402 locked restore/publish 成功；已有 NativeChecks、只读端点方向/错误提示检查及 9 个 Windows 输出选项的静音写入/停止检查通过 |
| F-10 | 在现有礼物门面说明来源选择、同步回调、卡片和导出职责 | [gift-export-runtime.js](../../src/server/gift-export-runtime.js) 仅新增职责注释，未拆分状态或新增 facade |
| F-12 | 明确 `hasExactOrigin` 是供 desktop IPC、权限和媒体适配器共用的纯 origin 比较；调用方继续拥有帧、路由和权限校验 | [local-media-access.js](../../src/electron/local-media-access.js) 仅新增职责注释；没有合并不同 URL 安全策略，相关 IPC、外观和本地媒体测试通过 |
| F-15 | 修正入口失败诊断、register 符号、更新适配器、`lifecycleState.runtime`、适配器定义链接与就绪恢复次序 | [main 参考](../reference/desktop/main.md) 逐项对照实现；来源隔离先启动、云同步完成后恢复本地工作由 readiness controller 协调，未改启动代码 |
| F-20 | `HomeService.applyBackgroundUpdate()` 与 controller 调用统一为公开回调名称 | [首页服务](../../public/js/playback/services/home-service.js) 与[controller](../../public/js/playback/controller.js)；请求代际、平台检查与返回值保持原样，相关播放生命周期与前端测试通过 |

### 9.2 验证与同步

- AI 直接相关测试：**309/309**；桌面 IPC、关闭、来源身份及播放生命周期：**100/100**；补充播放前端测试：**29/29**。
- 现有 canvas/browser-source 与 scene browser-source 测试：**9/9**，实际预览、保存、发布与重开通过；fixture 使用合成来源与独立会话。
- `npm run check`：**1683 个 JavaScript 文件通过**；`npm run verify:architecture`：**29/29**（新增 shared 反向依赖保护）；`npm run verify:docs`：**10/10**。保留既有 module-type/VM Modules 提示，没有为消除提示改变运行模式。
- 原生：用仓库已有的隔离 10.0.402 SDK，在本任务 `tmp/` 发布新工作程序和 NativeChecks；兼容性、维护退出/恢复、空闲状态、输入格式与生命周期、模型加载、音量、DSP 和歌曲生命周期通过。已有 playback output 检查对 9 个 WASAPI/DirectSound/WaveOut 输出选项发送静音 PCM，验证打开、写入、停止、旧 stream 拒绝及进程释放。
- 技术文档：同步 AI、桌面、Admin/Playback/overlay owner、模块化规则、当前规格/计划中的源码路径；历史材料只修复移动源码的 Markdown 链接目标，保留原基线与结论。
- 用户指南：没有功能入口、操作步骤或配置格式变化，指南与交互引导无需修改；已有套件补充 provider、共享依赖方向与端点方向检查，旧 provider 断言按修复后的真实契约更新，其他消费者测试跟随内部名称。
- 自有原生测试进程已退出；临时 fixture 数据的递归清理被自动审批以 `blocked by policy` 拒绝，相关目录保留在仓库 `tmp/`，没有改用其他方式删除。

未执行真实模型账号/网络、真实录音、听感、外接 ASIO 硬件或安装器验收；没有替换用户正在运行的工作程序，也未提交、打包或部署。本轮完成的是这 11 项整改，不代替其他计划中待补的实播或发布验收。
