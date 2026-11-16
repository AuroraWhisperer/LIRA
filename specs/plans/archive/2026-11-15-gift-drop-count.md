# 礼物掉落数量实施计划

Status: Completed

## 目标

把「数量倍率」改为「掉落数量」：每条最终结算记录触发一次，默认 30 个，可调 1–100 个，与卡片的实际送礼份数无关。预览使用一次示例结算。同一批图片从结算时开始计时，共用截止时间；顶部无空位时等待，截止前腾出空间才放行，到期仍未显示的直接作废。

## 当前行为与归属

- `public/js/shared/gift-motion-settings.js` 拥有两端控件、默认值和参数读取；当前默认 8 倍。
- `src/storage/settings-defaults.js` 提供持久设置默认值；`src/bilibili/gift/motion-config.js` 校验并构造本机结算事件。
- `src/server/overlay-projection.js` 投影公开播放字段；`public/js/shared/gift-drop-physics.js` 当前按 `num × quantityMultiplier` 生成，单次代表数量上限 60、同屏上限 400。
- `public/js/shared/gift-motion-samples.js` 当前生成三笔各 5 份的预览，导致默认预览 120 张而单份正式礼物只有 8 张。
- 客户端和画布复用字段定义及参数控件，继续使用现有自动保存和双向同步。
- 合同归属：`docs/reference/backend/storage.md`、`backend/ws.md`、`frontend/overlays.md`、`frontend/pages.md`；用户说明归属 `public/pages/admin/toolbox/gift.html` 和 `usage-guide-guard-thanks.html`。

## 兼容与范围

- 新设置使用 `giftDropCount`，新事件使用 `motion.count`。旧倍率设置不转换成数量，不删除用户存储；没有新字段时使用 30，避免旧值 8 被误当成 8 个。
- 旧事件显式携带 `quantityMultiplier` 时仍按原算法播放；新事件同时出现两字段时以 `count` 为准。投影保留旧字段的兼容读取。
- 保留 `num`、金额、触发条件、独立事件 ID、2 秒随机下落准备窗口、到期退场与同屏 400 个上限。按用户补充要求，等待和随机延迟不再增加寿命，未显示图片到期不补播。实际送礼数量超过代表图数量时，沿用最后一张显示余量。
- 不改变数据库结构、账号范围、鉴权、场景格式、摇摇乐行为或资源请求。无需 SQL 数据迁移。
- 不操作真实用户数据，不提交或打包，不调整无关样式。

## 实施与验证

- [x] 在现有 `test/gifts/gift-motion-effects.test.js` 更新数量行为：默认单份生成 30 张，保存数量独立于真实份数，预览与正式事件一致，旧倍率事件兼容；先运行确认新要求失败。
- [x] 更新字段、存储默认值、投影、物理生成和预览入口；同步 `test/scenes/shared-appearance.test.js` 和 `test/gifts/gift-motion-browser.test.js` 的新事件契约。
- [x] 在已有 Electron 双向保存场景中把一个参数改为数量，验证新字段经桌面和画布保存、重开回填；使用原有隔离夹具，不控制用户应用。
- [x] 更新技术参考、问号说明、用户指南及会误导的参数截图。
- [x] 运行聚焦检查：`npm test -- --file=test/gifts/gift-motion-effects.test.js --file=test/gifts/gift-motion-settings.test.js --file=test/scenes/shared-appearance.test.js --file=test/server/runtime-event-publication.test.js --file=test/gifts/gift-motion-browser.test.js`。
- [x] 运行隔离桌面检查：`npm run test:desktop -- --file=test/desktop/shared-canvas-appearance-electron.test.js --test-name-pattern="motion, advanced lyrics"`。
- [x] 运行 `npm run verify:docs`、`npm run verify:architecture`（本地设置与公开投影边界）、修改文件语法检查和 UI detector；检查最终 diff、`git diff --check`、`git status --short`。

## 失败处理与完成条件

失败时保留隔离证据，只修复这次数量链路；必要时逐项反向应用本任务差异，不覆盖其他修改。默认和保存后的数量在正式生成、预览和两端设置中一致，兼容及容量规则通过，文档与帮助准确、最终差异无运行数据后完成。无需完整发布套件或真实送礼验收。

## 补充要求与验证（第二轮）

- [x] 范围缩至 1–100，已保存超出范围的值按现有读取规则收敛至 100；两端控件和校验复用字段定义。
- [x] `gift-drop-physics.js` 使用结算统一截止时间，增加顶部入场空位检查。等待图片隐藏、不参与碰撞；过期等待图片立即丢弃，已入场图片保留原 600ms 退场。增加前先回收过期项，避免隐藏页面遗留容量。
- [x] `gift-motion-player.js` 按是否已放行控制显示，过期且素材尚未显示的节点禁止首次出现；补齐旧倍率参数经过播放器规范化后的兼容传递。`gift-effects-component.js` 的预览周期不再叠加随机下落延迟。每次加入掉落后同步移除已经结束的 DOM 节点，页面隐藏时同样有界。
- [x] 扩展现有物理回归，覆盖统一到期、满屏后期限前放行、期限后丢弃及过期容量回收；扩展已有真实浏览器用例验证截止时间、迟到事件、图片加载超时不补播及后台节点回收。
- [x] 更新既有 Electron 保存用例的数值至合法范围，运行第一轮同组聚焦用例与单项 Electron，另运行 `test/gifts/gift-effects-overlay.test.js`。
- [x] 同步存储/页面/叠加层参考、问号帮助、指南与截图。实际播放检查密集掉落、顶部等待和到期释放；运行修改文件语法、文档门禁和最终差异检查。

## 验证记录

- 修改前数量回归按预期失败：单份实际 8 张而要求 30 张，新 count 字段尚未生成；修改后五个聚焦文件 33/33 通过。
- 隔离 Electron 的指定双向保存用例 1/1 通过，包含数量修改、失败保留与重试、画布重开；未运行该文件其他无关用例。
- 独立隔离 Electron 显示「掉落数量 / 30 个 / 1–400」，截图更新至 `public/img/usage-guide/E/gift-frame-settings.webp` 及文档对应副本；测试进程已关闭。
- 架构 30/30、九个改动 JavaScript 文件语法通过。UI detector 只提示原有隐藏的导入样式缩略图没有静态 src，该图由运行时设置，不属于这次数量调整。
- 文档首次检查发现本计划的中文状态标记不被门禁识别，已改为 `Status`。随后检查本任务条目通过，活动计划检查被并行修改的 `2026-11-15-queue-notice-colors.md` 状态暂时阻挡；其余 9 项通过，最终结果以收尾检查为准。
- 当前修改保留同工作区并行的点歌设置等改动。未提交、打包、替换正在运行的安装版或进行真实送礼。
- 清理 `tmp/gift-drop-count-Gs4t3Q/` 时已校验绝对路径位于仓库 tmp 内，删除仍被自动审批拒绝，仅返回 `blocked by policy`。未换工具或重试绕过；隔离进程已关闭，合成数据与中间截图留在该忽略目录，不进入产品差异。

## 第二轮验证记录

- 六个相关文件 43/43 通过（`tmp/test-results/run-leOL0d`）；隔离 Electron 双向保存、失败重试与重开回填 1/1 通过（`run-MHWGDB`）。
- 隐藏页面的新事件回收用例先重现 201 个遗留节点而预期 100；播放器加入统一节点清理后，浏览器与礼物效果入口两文件 8/8 通过（`run-JTc2TP`）。这次补检覆盖最后的播放器改动，无需重复其他已通过检查。
- 隔离 Electron 界面显示掉落数量默认 30、最小 1、最大 100，帮助问号已初始化；指南的两份 1327×342 图片已更新。检查期间没有页面错误，测试进程已关闭。
- 真实播放器一次加入四批各 100 张、大小 180px，观察到顶部满屏后等待；其中短时批次 98 张从未入场，到期后全部移除且不补播。剩余批次截止时仅保留已显示的 79 张执行原有退场，600ms 后节点为零。
- 11 个相关 JavaScript 文件语法通过，最后修改的播放器和浏览器用例再次通过语法检查。UI detector 仍仅报告原有动态导入样式缩略图缺少静态 src，未改动无关内容。
- 技术参考、使用指南、问号说明和参数截图已同步；导航及交互导览不描述本次参数或计时细节，无需改动。WS 新字段沿用第一轮契约，第二轮没有新增接口字段。源码交付，未提交、打包、发布或进行真实送礼。
- 第二轮隔离目录 `tmp/gift-drop-deadline-7BgGAO/` 在进程关闭且绝对路径校验后尝试清理，也被自动审批以 `blocked by policy` 拒绝；未重试删除，截图和合成数据保留于忽略目录。
- 收尾 `verify:docs` 为 9/10；唯一失败是并行任务 `2026-11-15-danmaku-text-controls.md` 的状态格式未被活动计划校验识别。本任务归档、全部相对链接及其余检查通过，未修改其他任务计划。最终 `git diff --check` 通过；工作区继续保留并行点歌提示、弹幕文字等修改，本任务没有运行数据或敏感材料进入差异。

## 停留时长补充调整

- 用户进一步要求两款礼物感谢均使用 1–30 秒。共享字段将掉落、摇摇乐的范围统一为 1–30，默认仍为 20；客户端和画布滑块、保存校验与事件读取共用定义，旧超范围时长按读取规则限制在新范围内，无持久化迁移。
- 新增的 1 秒播放用例先复现随机准备延迟耗尽寿命。掉落准备窗口改为最多 2 秒且不超过设定时长一半，保留从结算统一计时和到期取消；四个相关文件 31/31 通过（`tmp/test-results/run-bJwJYj`）。
- 隔离 Electron 验证两款控件均为 1–30、步长 1、默认 20，并分别保存 1 秒成功；无页面错误，进程已关闭。帮助、存储/页面/叠加层参考、用户指南和两份参数截图同步；其余入口文档不含时长范围，无需修改。截图及隔离材料保留于 `tmp/gift-duration-range-19XLhl/`。
- 三个本轮修改的 JavaScript 文件语法通过；文档门禁仍为 9/10，唯一失败仍是无关弹幕文字计划的状态格式。UI detector 仍仅提示既有动态样式缩略图缺少静态 src，实际参数面板正常；未扩大修改范围。

## 超范围保存补充调整

- 用户明确不区分新旧设置，超限直接按边界处理，不因超限报错。现有 motion owner 在保存数值动效参数时先限制到共享字段上下限，设置页与画布沿用同一入口，无迁移或额外控件。
- 更新现有保存、结算与画布用例：两款超限时长保存为 30 秒，超限数量保存为 100，读回与播放保持一致；保留真正非法输入的整批写入保护。修改前复现两项超限保存失败（`tmp/test-results/run-UiQB8t`），修改后四个聚焦文件 51/51 通过（`tmp/test-results/run-V7OMWV`），motion owner 语法检查通过。
- API、存储参考与使用指南同步为统一边界处理，不再以旧设置描述本次规则。滑块范围、界面布局及截图不变，本轮未重复 Electron 检查。
