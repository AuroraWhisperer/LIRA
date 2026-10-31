# 礼物答谢文案编辑实施计划

Status: Complete

## Goal

把固定回复最后一行改为两列：左侧查询回复，右侧礼物答谢。主播可直接修改当前默认答谢文案，使用中文参数块插入称呼、礼物和数量、金额与盲盒差额；预览、保存、恢复默认均可直接操作。保存结果用于服务器真实答谢。

## Current Behavior And Ownership

- `public/pages/admin/toolbox/danmaku.html` 与 `danmaku-fixed-replies.js` 拥有总览和单活动编辑区；查询独占一行。
- `public/js/admin/gifts/interaction-controls.js` 与 Electron `gift-interaction-controller.js` 拥有两项服务器开关、账号栅栏、串行保存和同步状态；礼物页有独立入口。
- Server `src/lib/gift-interaction-format.js` 生成普通／免费／大航海答谢；`gift-interaction-service.js` 持有租户数据库并在组结算后格式化，现有 scheduler 负责发送。
- Server `streamer-sync-settings.js` 与 `cloud-settings-store.js` 拥有配置校验和租户持久化；沿用完整 Device 配置写入，不增设鉴权入口。
- 技术文档：Live `docs/reference/frontend/app.md`、`pages.md`、`desktop/preload.md` 与 `main.md`；Server `docs/protocol/gift-interaction.md`、Device／Management OpenAPI、requirements 与 acceptance criteria。用户指南归 `usage-guide-danmaku-replies.html`。

## Design And Compatibility

- 新增可选云配置 `giftThanksTemplates: { gift, guard }`，未保存时使用现有原文；省略写入保留已保存值，保存不启用答谢。普通／免费使用 gift，大航海使用 guard。
- 默认 `gift = 感谢{称呼}投喂{礼物}；{金额}`，`guard = 感谢{称呼}开通{礼物}；{金额}`。保留现有称呼及航海等级、汇总礼物、金额／盲盒差额、免费不显示金额的规则。
- 每份模板最多 120 个 Unicode 字符，单行非空；三个受支持参数各保留一次，未知或残缺标记拒绝保存。称呼、礼物和金额不可在发送时截断，沿用每条 40 UTF-16、最多四条和整体拒绝规则。
- 前端显示不可拆开的中文参数块，普通文字原生编辑；不引入富文本格式。现有许愿编辑器拥有字体、格式和图片契约，因此仅沿用其原生编辑／安全 DOM 模式，另建纯文本模板编辑器。
- 纯模板校验及分段模块在两端保存同源内容，Live 浏览器与 Electron 共用，Server 使用对应 `.mjs` 模块。金额计算留在现有服务端 formatter，预览只使用明确标为示例的数据。
- renderer 新增受限 `setGiftThanksTemplates(templates)`，经既有精确来源 IPC、账号栅栏和保存队列写入；状态增加可选模板快照。旧服务缺字段时禁用模板保存并说明升级，原开关继续可用。
- 两个开关入口通过原同步事件互相更新；一个弹幕页 controller 管理两个开关，模板编辑器消费该 controller 的状态，不新增重复刷新请求。账号切换清空草稿，失败保留草稿。
- 不改变礼物结算、租户隔离、鉴权、发送调度或历史账本，不启用真实答谢、不发送测试弹幕，不提交、推送或部署。

## Milestones And Verification

- [x] 1. Server 配置、格式化与实际发送接入。扩展所属 settings、formatter、service 测试，证明默认兼容、自定义实际发送、免费／盲盒／航海、非法输入、租户独立及重开持久化。
- [x] 2. Electron 受限保存与状态快照。扩展 `test/gifts/gift-interaction-controls.test.js`，证明受限入参、账号变化、失败及旧服务无模板字段行为；保留既有开关覆盖。
- [x] 3. 两列入口、参数块、草稿和预览。扩展既有 `fixed-reply-frontend` 与隔离 Electron 夹具，验证编辑、插入／删除／撤销／粘贴、预览、保存／恢复默认、账号切换、两个开关同步及单次请求。
- [x] 4. 同步规范和指南，检查真实 Electron 页面一次；运行 Live `npm run verify:docs`、适用语法／架构检查和 Server `npm run docs:check`。最后检查两仓 touched diff、`git diff --check` 和 `git status --short`。

Run focused Node files with the repositories' existing runners. Broaden only for an observed contract consumer impact. No full release gate or deployment is requested.

## Rollback Or Failure Handling

保留既有未提交修改。只检查和撤回本任务的具体补丁；服务不支持新增字段或保存失败时保留草稿，不提示已保存。测试只使用 `tmp/` 和内存数据库，隔离 Electron 测试自行关闭并清理。

## Desktop QA Inventory

- 总览最后一行两列、查询和礼物答谢同排：隔离 Electron 的 bounding boxes 与总览截图。
- 展开／收起复用单编辑区，默认两份文案及三个中文块可见：已有 browser suite 和编辑区截图。
- 修改普通文字、删除／补回参数、撤销重做、安全粘贴：browser suite；原生输入后预览即时更新。
- 普通／盲盒／免费示例切换，金额及差额完整：共享 formatter 测试和桌面示例选择。
- 保存和恢复默认不打开开关、一次操作一次请求：controller、browser、桌面 IPC 测试。
- 异常探索：失败保存保留草稿并经标题刷新恢复；账号切换／退出后丢弃旧草稿和迟到响应。由 browser 和 controller tests 覆盖，桌面补查失败／恢复。
- 显示检查：使用夹具请求的 1440×1000 原生桌面窗口（本机实际内容区 1426×849），检查两列、参数块、预览、保存操作和实际宽度，无需新增非目标手机场景。

## Done When

上述四项验证完成：截图所在行形成两列；新手可使用已填默认文案和中文参数块编辑、预览、恢复及保存；服务器真实发送使用当前租户已保存模板，既有准确金额、分组、发送限制及隔离继续成立；文档、指南与测试一致。源码完成与线上部署分开报告。

## Verification Results

工作区基线：Live `7caf830e`，Server `87f1c0de`，本任务未提交。

- Live 功能、指南、markup 与隔离 Electron 联合 48 项通过；末次参数编辑／双入口开关同步 9 项通过，IPC／模块边界 32 项通过，ESM 范围检查与文件规模检查通过。修正退出账号后的迟到快照、非法模板快照应显式返回未确认状态，以及示例已无法完整发送时仍可保存的边界。
- Server 格式、真实 detector 结算组到发送任务、设置、HTTP、SQLite 重开、分组及云设置联合 101 项通过；将模板 SQL 准备移到订阅前后，末次相关 77 项通过，包含构造失败清理和两份 OpenAPI 的模板校验。
- Live `npm run check` 通过（1683 个 JS 文件，复用有效缓存）；两端模板模块字节一致，Server 修改文件语法检查通过；Impeccable detector 无发现。
- Live 文档门禁 10 项、Server 文档门禁 58 项通过；技术参考、规格、协议/OpenAPI/fixture、需求/验收/追踪及两处使用指南同步。架构所有权不变，无新增进程、依赖、本地设置键或 SQLite schema。
- 默认契约检查因当前 Server HEAD 高于锁定提交而拒绝；复用已有只读隔离检出运行 `npm run verify:contracts -- D:/Work/Live/tmp/release-5.4.3/server-contract`，锁定 `67119e81` 的 10 份旧契约 fixture 通过。新增字段由当前服务端测试验证，没有擅自更新锁定版本。
- 手动隔离 Electron 验证了两列、中文块、普通文字编辑、盲盒／免费预览、失败后标题刷新重试及重载读回。关闭开关后保存文案仍保持关闭；QA 应用已关闭，测试 profile 已清理，仅保留 `tmp/` 截图证据。

未打包、提交、推送或部署，也未向真实直播间发送测试消息。启用新功能需要包含本任务改动的桌面进程及服务器版本。
