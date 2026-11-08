# Shared Gift Images Implementation Plan

**Status:** Completed

**Goal:** 所有需要礼物原图的本地弹幕复用桌面图片缓存；样式通过共享接口选择原图或静态帧，大航海使用本地舰徽，文字不等待图片。

**Architecture:** 保留现有礼物目录、下载队列和 `/overtime-gift-images/` 交付路径。礼物资源模块把已接受事件的准确来源 URL 映射为本地资源，只有实际 GET 图片才调用原缓存下载；前端共享显示接口处理静态转换和舰徽。

**Tech Stack:** Node.js 24 CommonJS、浏览器 ES modules、原生 Canvas；无新依赖。

## Boundaries And Current Behavior

- Server 按已结算 variant 发送来源 URL；本地弹幕目前直接访问 B 站，与目录磁盘缓存分离。
- `remote-gift-image-cache.js` 已有 4 并发、同文件请求合并、5 MiB 限制、HTTPS 来源校验、禁止重定向及原子写入。
- `gift-static-image.js` 已合并单文档静态转换，但失败立即移除缓存、异步结果可能覆盖更新后的图片。
- 不更改云端事件协议、礼物身份、目录初始化策略、账户隔离、设置键、样式布局或动图选项；保留所有已有用户修改。

## Ownership And Interfaces

- `src/bilibili/gift/gift-image-resources.js`: `resolveSource(source)` 只映射、登记资源，不下载；`ensureImage(imagePath)` 只准备已经登记的资源。复用 hybrid catalog 所有的 image cache。
- `remote-gift-image-cache.js`: 增加来源图片的确定性路径/下载入口，仍走唯一下载队列、安全检查和原子写入；旧目录缓存文件和 index schema 保持兼容。
- `hybrid-catalog.js`: 资源模块与目录版本接线；`src/server.js` 将资源端口提供给场景输出与现有图片路由。
- `scene-runtime.js`: 仅映射已接受的输出事件，独立弹幕和组合场景一致；不阻塞事件，不为无图样式下载。
- `gift-image-http.js` / `http-server.js`: 读取磁盘失败时按登记信息按需准备；未知路径不联网，只有正常授权运行时允许新下载。
- 前端 `gift-image.js`: 原图/静态图/舰徽公共显示入口；各样式继续拥有显示与失败时的装饰规则。保持锁定的 `danmaku-renderer-core.js` 不变。
- 合同：`docs/reference/backend/overtime.md`、`docs/reference/backend/api.md`、`docs/reference/frontend/overlays.md`、`docs/reference/frontend/pages.md`。

## Milestones

- [x] 资源与交付：准确 URL 匹配已缓存目录图片；未缓存资源惰性准备；未知来源拒绝；失败冷却；本地场景接线。
  - 验证：首次实际请求下载 1 次，并发请求仍为 1 次，热缓存/重启离线为 0 次，新 URL 不复用旧图；未显示/未登记不下载。
- [x] 前端共享显示：Glass、通用原图弹幕、许愿文本和礼物动效通过公共入口；静态帧复用、异步更新不串图、舰徽保留千舰切换。
  - 验证：现有 gift-image-fallback、danmaku renderer、gift-motion browser 用例及静态转换竞态用例。
- [x] 同步说明、聚焦检查、隔离场景验证及 diff 复核；归档完成证据。

## Verification

聚焦运行 `npm test -- --file=<相关测试文件>`，浏览器用例通过仓库既有 fixture 运行；`npm run verify:docs`、`npm run verify:architecture`；最终 `git diff --check` 和 `git status --short`。不用真实用户数据，不重启用户应用。

## Failure Handling And Rollback

图片失败不延迟/删除礼物文字；保持样式已有主题/占位回退，失败资源短时冷却避免每条消息重试。精确移除本次改动即可恢复原路径；不删除缓存、迁移数据、重置仓库或回滚其他未提交修改。

## Done When

同一资源复用现有磁盘缓存和下载队列；未渲染的图片不新增请求；静态显示不循环解码原动图；聚焦验证通过、文档与实现一致、无临时或运行时文件进入改动。未构建或发布安装包。

## Verification And Closeout — 2026-11-07

- 第一批 5 文件 72 项、第二批 8 文件 76 项聚焦检查通过，包含资源 HTTP、缓存并发/完整性/离线、共享前端竞态、所有消息 renderer、目录生命周期、场景接线及现有礼物动效浏览器检查；最终修正后重跑受影响 5 文件 55 项通过。共 148 个不同用例，未跑全仓库完整测试。
- `npm run verify:architecture` 30 项通过；17 个相关 JS 文件 `node --check` 与样式镜像 `--check` 通过。文档门禁发现本计划缺 Status 行，修正后 10 项通过；归档导航再次核验。
- 聚焦资源测试实测：目录初始化与两个图片消费者共用一次上游下载；重启后的缓存读取不新增上游请求；HEAD、未登记 URL、未授权请求均不发起下载；失败冷却结束后恢复。来源被多个 variant 共享时禁止猜测最近成功旧图。
- 隔离 `/scene` 使用真实页面、两个样式 iframe 和合成流，图片字节来自仓库 B 站 WebP/PNG 样本：Glass 静态首帧与灵动弹幕原图共用一次下载；慢图期间文字已显示；PNG 可解码；提督图标按千舰状态更新；重复缺图只请求一次。全程 3 个上游请求（两张正常图和一张故障图）、浏览器外部图片请求 0 次、页面脚本错误 0 个；Glass 输出 WebP 不含 ANIM。截图保留在 `tmp/shared-gift-images-qa-k74s7U/shared-gift-images.png`。浏览器、fixture、缓存任务及临时缓存已清理。
- 同步 frontend/backend/API 参考及职责路由。沉笺的真实图片被旧 `giftImage` 默认规则拦截，纳入现有固定原图规则并重新生成 Node 镜像；布局和控制项未改。用户操作、已有指南和引导没有新增步骤或设置，不另写重复说明。
- 共享 core 与云端协议未改；保留目录初始化策略、旧图片 URL/index 格式和所有其他未提交工作。未实播、提交、打包或发布。

## Consumer Audit Follow-up — 2026-11-07

- 用户追问实际消费者后，补查发现原完成范围未覆盖 Admin 礼物选择器、最近礼物/盲盒列表、通知、加时规则、文本框及全部许愿卡片。旧入口本来已使用目录磁盘缓存，但尚未统一显示接口；现已迁入 `gift-image.js`。横幅/通知保留各自错误装饰，通过 `bindGiftImage` 接入；批量列表通过 `setGiftArtworkFallbacks` 接入。头像、主题装饰和仅显示等级的舰徽仍由各自模块负责，不强行合并不同职责。
- 实际检查另复现横幅与通知仅允许 WebP，导致缓存 PNG 被当作缺图；两处改为复用来源解析器，并扩充现有 variant/图片解析用例。没有改变礼物身份、动图选项、已存设置或网络下载策略。
- 聚焦回归第一批 75 项通过，1 项因相邻服务器检出不符合版本锁而未运行；使用已有 `tmp/overtime-start-qa/server-contract` 固定版本目录后该项通过。补充批次 34 项通过（其中 5 项与前批重合），本轮共 105 个不同聚焦用例，未执行全仓库测试。
- 在线验证从真实 B 站 CDN 获取打 call WebP（20,714 字节）和疯狂打 call PNG（20,718 字节），经真实缓存下载器、图片 HTTP 路由和 `/scene` 输出进入 Glass 与灵动弹幕两个 iframe：各资源只下载 1 次，重复消息新增 0 次，浏览器外部图片请求 0 次、脚本错误 0 个；Glass 静态 WebP 不含 ANIM。提督图位随模拟房间人数切换千舰款。
- 隔离 Electron 复用既有测试宿主的真实 preload、会话鉴权和图片路由，在合成组件展示区挂载实际选择器、五种许愿卡片、横幅、加时规则、文本框、最近礼物和通知 renderer；12 个组件图位及 2 条通知图片解码成功，选择器可交互，无脚本错误。组件展示记录是合成数据，不宣称验证了生产服务器、真实收礼、完整管理页操作或 OBS/直播姬实播。
- 重建图片缓存模块并注入断网 fetch 后，两份真实下载字节仍通过 HTTP 返回 200，网络尝试为 0。证据保留在 `tmp/shared-gift-consumers-MUTp15/results.json`、`scene-real-images.png`、`electron-gift-consumers.png`。技术接口说明同步；没有新增用户操作、设置或限额，无需改用户指南和引导。
- 文档门禁 10 项、架构门禁 30 项及 19 个相关 JS 文件语法检查通过。所有本轮浏览器、Electron、HTTP fixture 已关闭，隔离运行时与缓存已删除，仅保留 QA 证据。最终差异检查清理了旧批量 helper 移除后留下的文件尾空行。
