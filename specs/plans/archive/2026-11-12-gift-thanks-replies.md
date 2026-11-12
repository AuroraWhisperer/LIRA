# 礼物与大航海答谢文案库

Status: Completed

## User correction — sending mode belongs to the scene

用户明确纠正：舰长、提督、总督分别选择普通／@，同一等级的候选共用该方式；礼物场景同样只保留一处选择。初次实现未发布，因此直接把新设置的 mode 从消息移到场景，不增加对未发布中间格式的兼容。旧双模板兼容继续保留。

1. 将共享校验、服务端选择与 OpenAPI 改为 `{enabled,mode,messages:[{text}]}`，验证随机抽取不改变场景模式及各等级独立。
2. 将 UI 选择器移到场景工具栏，联动该组全部预览；验证切换场景、增删、保存、重新读取，普通昵称解析保持。
3. 同步相关测试、接口和使用说明，完成聚焦检查、隔离 Electron 查看及双仓 diff 检查后归档。

## Goal

只增强弹幕互动中的礼物答谢、大航海答谢。参考梦游机器人按场景管理候选文案及普通／原生 @ 预览的优点，让每个场景维护多条回复，结算完成后随机选一条。礼物、舰长、提督、总督分别选择发送方式，同场景全部候选共用。

## Current behavior and ownership

- `public/js/admin/danmaku-gift-thanks.js` 编辑两个单句，`gift-thanks-text-editor.js` 拥有原子参数块；`public/js/shared/gift-thanks-templates.js` 强制三个参数各一次。
- Electron `gift-interaction-controller.js`、`ipc/gift-interaction-ipc.js` 复用 `cloud-sync-controller.js` 的账号代次与队列。
- Server `src/lib/gift-interaction-format.js` 格式化，`src/modules/danmaku/gift-interaction-service.js` 对已确认分组创建一次发送任务，`src/storage/cloud-settings-store.js` 持有租户设置。已有去重、金额结算和任务取消保持原所有权。
- 现有测试：Server `gift-thanks-templates`、`gift-interaction`、`gift-interaction-format`、`gift-interaction-settings` / HTTP；Live `gift-interaction-controls`、`fixed-reply-frontend`、`fixed-reply-editor-electron`。

## Decisions and compatibility

- 新增可选云设置 `giftThanksReplies`；`giftThanksTemplates` 保持原契约供旧客户端使用。新设置省略时保留；未保存时从原两条文案生成四个场景，默认不改变当前发送效果。
- 每个场景 `{enabled, mode:'plain'|'mention', messages:[{text}]}`，1–20 条；每条最多 120 Unicode 字符，中文参数可选、每个最多一次，禁止未知标记和控制字符。可只保留一句固定回复，多句只随机抽文本，发送方式由该场景固定。
- 用户主动编辑旧模板时只替换对应场景第一条候选，保留其他候选和开关；普通字段影响 gift，大航海字段影响三个等级。普通云上传不携带该字段，不会清空新设置。
- 新客户端只在服务器返回新设置时开放文案库，旧服务器保留原编辑器。IPC 保留原通道，新增受限保存通道与可选 snapshot 字段，不暴露认证信息。
- 场景按礼物事件的购买类型／等级选择，不按赠送者身份。每个已结算组只抽一次并冻结发送任务；原生 @ 使用可信 UID 和真实昵称预留长度，不靠正文里的 @ 字符冒充。
- 没有金额参数时不展示金额；使用时仍由服务器提供完整结算金额、盲盒差额和未知成本限定。保留四段／40 UTF-16 单元上限，不截断身份、礼物和金额。

## Non-goals

不改欢迎、关键词、AI、定时弹幕、礼物结算、去重、动画叠加层或直播软件。无新依赖、进程、数据库表；不提交、打包或部署，不发送真实直播弹幕。

## Milestones and verification

- [x] 扩展共享文案规则与 Server 保存／读取／随机发送；验证场景选择、一次抽取、@ 长度、旧配置保留、SQLite 重开和租户隔离。
- [x] 扩展受限 IPC 与现有编辑器：场景选择、场景发送方式、添加／删除、原创示例文案、即时预览、失败保留／账号清理；前端与 IPC 用例通过。
- [x] 使用隔离 Electron 夹具验证正常编辑保存、重新加载与预览，查看桌面画面；自有进程及临时配置已清理。
- [x] 同步规格、客户端 preload/main/pages/app、两处用户指南、Server requirement/acceptance/protocol/OpenAPI；本次更正后的双端文档门禁通过。
- [x] 检查两个仓库本任务 diff、`git diff --check` 和状态；保留所有既有及并行修改。

## Rollback

仅反向撤销本任务补丁。新设置采用可选追加形式，不修改生产数据，不删除或重建数据库，不使用整文件 checkout/reset。

## Desktop QA inventory

- 四组独立文案、各组普通／@、添加／删除／示例、场景开关：前端用例验证草稿与各控件；Electron 用例验证真实 preload / IPC 保存及重新加载。
- 普通昵称与原生 @、随机抽一条、按购买等级路由：Server 领域用例验证真实任务；桌面查看普通和 @ 预览，确认长文案仍可编辑。
- 非顺利路径：空白候选禁用保存；失败保存保留跨场景草稿；账号退出清掉旧草稿；旧服务器继续使用原编辑器。
- 视觉初始状态：请求 1440 × 1000 的隔离 Electron 窗口，由显示器可用空间调整到 1440 × 913；共享编辑器场景选择、第一条文案和保存按钮可见。多条列表使用编辑器内部滚动，普通／@ 和大航海预览已查看；截图及配置只放 tmp 并已清理。

## Initial verification results — 2026-11-12

下列是初次实现的历史证据；发送方式的粒度以本次用户更正为准，最新验证见更正收尾。

- Server：`gift-thanks-templates`、`gift-interaction`、`gift-interaction-format`、`gift-interaction-settings`、`gift-interaction-settings-http` 五个相关文件共 97 项。初次 96/97，失败表明大航海的真实 giftId 不一定为 `guard-N`；复用现有购买等级解析后 `gift-interaction` 38/38。新增 OpenAPI 校验发现全空白文案被 schema 放过，修正后 `gift-interaction-settings` 21/21；其余成功结果有效。
- Live：`node --experimental-vm-modules --test test/gifts/gift-interaction-controls.test.js test/bots/fixed-reply-frontend.test.js test/desktop/fixed-reply-editor-electron.test.js` 28/28。真实 IPC 的异步状态推送曾清掉成功提示，修正后完整运行通过。
- 后续桌面复核遇到并行欢迎模块 `createWelcomeLibrary` 初始化异常。礼物测试入口改为仅初始化该场景，避免依赖无关编辑器；新增桌面用例定向复验 1/1，人工复核空白阻止保存、普通／@ 保存后重新读取及四场景均通过。未修改欢迎产品代码。
- `npm run check`：1,886 个 JS 文件通过（29 个重查、1,857 个复用）；`npm run verify:architecture` 29/29。新增共享实现双端逐字比对一致；Impeccable 检测返回空问题集。
- Server `npm run docs:check` 59/59。Live `npm run verify:docs` 9/10；失败为并行计划缺少有效活动状态：首次定位到 `2026-11-12-time-welcome.md`，归档收尾复查先定位到新出现的 `2026-11-12-interaction-thanks.md`。未改动这些计划。
- 两仓 `git diff --check` 通过。没有新增生产数据、秘密、依赖或运行产物；未提交、打包、部署或发送真实弹幕。新能力需发布相应客户端和服务器版本。
- 技术文档与用户指南同步；新手引导入口未变，因此无需修改 `interactive-tour-config.js`。现有进程、发送器、租户设置表与所有权边界未变，无需新 ADR；固定服务端版本锁未变，新增字段使用当前工作副本的 AJV、HTTP、控制器及 Electron 检查。

## Correction verification results — 2026-11-12

- 已将发送方式统一移至场景：礼物、舰长、提督、总督各选普通或 @；候选仅保留文本。随机抽取不会改变场景方式，旧模板编辑保留场景方式，普通回复继续解析已保存昵称。
- Live 三个相关测试文件 29/29；Server 文案、互动、设置与 HTTP 四个相关测试文件 87/87。覆盖多候选共用方式、等级独立、SQLite 重开、旧模板兼容、失败草稿与账号清理、已排队任务不受后续改动影响。
- 实际隔离 Electron 1440 × 913 查看：舰长选择 @ 后两条候选同步预览；提督仍为普通；切回舰长保留 @。真实 preload / IPC 保存后的数据只有场景 mode，测试完成后已关闭应用并清理专属临时目录。
- 编辑器与共享模块语法检查通过；Impeccable 检测无问题，双端共享模块 SHA256 一致。Live 文档门禁 10/10、Server 59/59，前次并行计划状态阻塞已解除。
- 技术契约、OpenAPI、规格及两处使用指南已同步。引导入口、架构所有权未改变，无需调整引导配置或新增 ADR。双仓差异复核仅收尾本任务，保留既有和并行修改；源码完成，未提交、打包、部署或发送真实弹幕。

## Done when

四类候选能编辑、保存、重新读取；各场景可独立选择普通或原生 @ 且一次事件只抽一个文本候选；旧模板、并发账号隔离、完整礼物金额和排队行为经相应测试验证；桌面操作可用且文档一致。源码完成与线上部署分别报告。
