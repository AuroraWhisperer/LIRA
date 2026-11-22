# LIRA 技术参考

本目录记录当前实现的接口、状态、算法、配置和操作细节。系统边界与决策见 [架构](../architecture/README.md)，需求与验收标准见 [规格](../../specs/README.md)。每类完整契约只在下表对应的主文档中维护；其他文档保留必要上下文并附链接，不重复复制字段表、常量表或配置块。

## 后端 `backend/`

| 文档 | 内容 |
| --- | --- |
| [server-core.md](backend/server-core.md) | 本地 HTTP/WS 与生命周期：端口、环境变量、请求管线、管理认证/展示凭据及启动关闭次序 |
| [ws.md](backend/ws.md) | WebSocket 传输（手写 RFC 6455）、管理快照契约、消息类型与广播原因全集 |
| [api.md](backend/api.md) | **本地 HTTP API 端点全量注册表**：方法、路径与领域契约 |
| [storage.md](backend/storage.md) | 存储层：数据目录、SQLite 表与迁移系统、保留策略、设置分组与存储约定 |
| [ai.md](backend/ai.md) | AI 互动助手：模型服务、工具调用、配额与审计、密钥加密 |
| [overtime.md](backend/overtime.md) | 加班机：本地领域服务权威倒计时、礼物结算幂等管线、规则与盲盒 |
| [music/qq-provider.md](backend/music/qq-provider.md) | QQ 音乐上游 API 逆向工程（GTK、zzcSign、QRC） |
| [music/netease-provider.md](backend/music/netease-provider.md) | 网易云上游 API 逆向工程（weapi 双 AES+RSA、端点与字段映射） |
| [music/services.md](backend/music/services.md) | 音乐域服务：Provider 注册表、曲库、队列、匹配、缓存、歌词状态、**歌词解析器（LRC/YRC/QRC）** |
| [music/wesing.md](backend/music/wesing.md) | 全民 K 歌采集栈：日志扫描、QRC 解密、PowerShell/C# 监视、播放时钟 |
| [bilibili/protocol.md](backend/bilibili/protocol.md) | B 站直播协议：HTTP API、WBI 签名、WS 二进制帧、自实现 protobuf、解析器 |
| [bilibili/danmaku.md](backend/bilibili/danmaku.md) | 本地弹幕监听、去重与命令解析；云端签到/抽签边界 |
| [bilibili/gift.md](backend/bilibili/gift.md) | 服务器权威礼物、客户端投影与本地醒目留言服务 |

## 前端 `frontend/`

| 文档 | 内容 |
| --- | --- |
| [pages.md](frontend/pages.md) | 页面与入口 URL 清单、`public/` 模块地图、CSS 与静态资源 |
| [comms.md](frontend/comms.md) | 前后端通信：token 注入、fetch 约定、WS 客户端、桌面桥 |
| [app.md](frontend/app.md) | Admin 应用与公共框架（EventBus/DI/StateService）及业务模块 |
| [playback.md](frontend/playback.md) | 播放引擎：状态机、音源解析、本地文件、队列持久化 |
| [overlays.md](frontend/overlays.md) | 展示页（叠加层）：队列/歌单/盲盒/加班机/礼物特效/歌词/弹幕/小游戏/转盘/开播画面/时钟 |
| [danmaku-motion.md](frontend/danmaku-motion.md) | 固定弹幕逐款动效、公共职责、制作提示词与体感验收 |

## 桌面端 `desktop/`

| 文档 | 内容 |
| --- | --- |
| [main.md](desktop/main.md) | 主进程：窗口、会话、数据路径、`local-media://`、请求头规则、原生音频助手/播放输出与关闭握手 |
| [windows.md](desktop/windows.md) | 辅助窗口：音乐登录窗、B 站登录窗、豆包登录窗与全屏取色窗口 |
| [auth.md](desktop/auth.md) | 登录与会话：分区模型、登录地址、Cookie 加密快照、云端凭据同步与注入契约 |
| [preload.md](desktop/preload.md) | IPC 注册表、`contextBridge` 桥与调用方地图 |
| [update.md](desktop/update.md) | 自动更新运行时状态机、资源完整性检查与状态载荷 |

## 工程 `engineering/`

| 文档 | 内容 |
| --- | --- |
| [build.md](engineering/build.md) | npm 脚本、JS 与原生音频依赖、electron-builder 配置、NSIS 安装脚本、发布流水线与运行模式 |
| [test.md](engineering/test.md) | `node:test` 测试体系、覆盖地图、分层验证、静态检查、诊断脚本与测试取舍约定 |
| [code-signing.md](engineering/code-signing.md) | 已有签名/验签工具契约、当前接入状态与限制 |

## 其他参考

- [交互式引导](frontend/interactive-tour.md)：当前引导入口、状态与文件职责。
- [第三方模型配置指南](../guides/third-party-api-support.md)：面向使用者的操作说明。

## 本机样式与外置套装

套装按样式清单分类安装，成员数量不固定；图片、视频、字体等资源独立于安装包分发，运行逻辑由客户端内置组件负责。「月渡花汀」是这类资源套装的一个示例，后续套装可按需增减成员，或包含多个同类样式。

| 要查的内容 | 归属文档 |
| --- | --- |
| 作者 ZIP 结构、版本更新、月渡花汀导出与主播操作 | [制作和导入指南](../guides/component-style-packages.md) |
| 导入预览、确认安装、删除接口及文件限制 | [组件样式库 API](backend/api.md#组件样式库) |
| 安装目录、不可变资源、重复导入和软删除 | [本地组件样式库存储](backend/storage.md#本地组件样式库) |
| 客户端入口、画布选用与图层替换 | [Admin 应用](frontend/app.md) |
| 图片/视频外观字段与动态内容区域 | [本地媒体样式](frontend/overlays.md#本地媒体样式) |
| 受信预设、资源映射与旧场景兼容 | [资源型样式](frontend/overlays.md#资源型样式) |
| EXE 素材排除与独立套装导出 | [工程打包](engineering/build.md) |

## 事实地图(单一事实源归属)

需要查询容易混淆的细分实现细节或跨目录治理文档时，按下方归属直接进入对应章节；其余整文件索引见上方各目录表：

| 专题与细分契约 | 归属章节 / 文档 |
| --- | --- |
| 场景发布、独立组件来源及浏览器预览会话接口 | [backend/api.md](backend/api.md#本地场景)、[预览会话](backend/api.md#浏览器组件预览) |
| 场景来源渲染、完整版本切换与共享外观投影 | [frontend/overlays.md](frontend/overlays.md#本地场景浏览器来源) |
| `roomId` 规范化算法 / `customReplyRules` 解析规则 | [backend/api.md](backend/api.md) §2.1–§2.2 |
| Bilibili 用户信息合并、字段投影与房间运行生命周期 | [backend/bilibili/danmaku.md](backend/bilibili/danmaku.md) §10 |
| 礼物目录来源、精确 ID 图片缓存与 `theme-presets.json` 结构 | [backend/overtime.md](backend/overtime.md) §1.5 / [frontend/pages.md](frontend/pages.md) §6.1 |
| 叠加层 CSS 变量（`--overlay-*`）完整注入表 | [frontend/overlays.md](frontend/overlays.md) §1.2 |
| 外部 QQ / 网易云采集、固定平台歌词与智能播放仲裁 | [backend/music/services.md](backend/music/services.md) §13 |
| 歌词解析器（LRC/YRC/QRC 行模型、逐字词、时间容差） | [backend/music/services.md](backend/music/services.md) §14 |
| 模块化、低耦合与组合根约束 | [modularity-standard.md](../architecture/engineering/modularity-standard.md) |
| AI 变更的归属模块、契约、调用方与测试路由表 | [ai-workflow.md](../architecture/engineering/ai-workflow.md) |
| 遗留边界、迁移方向与增量执行状态 | [legacy-boundaries.md](../architecture/engineering/legacy-boundaries.md) |
| 功能规格状态与验收证据 | [specs/README.md](../../specs/README.md) |
| 架构图表（D2 源与 PNG、Mermaid 时序图） | [diagrams/](../architecture/diagrams/) |
| 架构决策记录（ADR） | [adr/](../architecture/adr/) |
