# 加班姬直播间目录与服务器礼物搜索实施计划

## Goal

恢复加班姬主礼物选择器以当前配置直播间的 Bilibili 礼物面板、盲盒和当前账号可用背包为准；把弹窗中的手动搜索入口改为服务器全局礼物搜索，并将命中礼物的服务器缓存图片下载到桌面端本地缓存后以同源 URL 展示和保存。

## Non-goals

- 不改变礼物事件接收、去重、加班规则结算或 overlay 协议。
- 不修改三份本地 Markdown 礼物映射，也不删除旧的本地搜索 HTTP 端点。
- 不让 renderer 直接请求 Bilibili 图片地址，也不新增客户端从弹幕包推断图片地址的逻辑。
- 不重做 lira-server 的礼物同步管线；服务器已经记录最后成功的 Bilibili `image_source_url` 并维护内容哈希图片缓存。
- 不为服务器当前确实缺少上游图片的礼物伪造或猜测图片。

## Current Behavior

- `createHybridGiftSaleCatalogService()` 的 `getSnapshot()` 和 `refresh()` 以服务器全局目录为主，导致打开选择器和顶部同步按钮不再表示当前直播间可送礼物。
- Admin 顶部显示“服务器目录 / 同步服务器礼物”，弹窗按钮仍显示并调用“搜索本地礼物”。
- 远程快照把图片规范化为配置服务器的绝对 `/gift-media/images/<basename>` URL。实际图片返回 `200 image/webp`，但 lira-server 的全局 Helmet 响应包含 `Cross-Origin-Resource-Policy: same-origin`；本地 Admin 为 `127.0.0.1:3000`、隧道服务器为 `127.0.0.1:13000`，Chromium 因跨 origin 拦截后触发占位图。
- 本地 `data/overtime-gift-catalog.json` 只缓存服务器元数据，不缓存图片字节。

## Ownership

- 直播间在售目录：`src/bilibili/gift/sale-catalog.js`。
- 服务器元数据缓存与条件刷新：`src/bilibili/gift/remote-catalog-cache.js`。
- 两种目录的用途编排：`src/bilibili/gift/hybrid-catalog.js`。
- 本地 HTTP 编排与静态图片响应：`src/server/routes/overtime-routes.js`、`src/server/api-context.js`、`src/server/http-server.js`、`src/server/http-utils.js`。
- 组合根：`src/server/domain-services.js`。
- Admin 消费者：`public/js/admin/overtime.js`、`public/pages/admin/toolbox/overtime.html`。
- 行为规范与事实文档：`specs/overtime-gift-sale-refresh_design.md`、`specs/remote-gift-catalog-sync_design.md`、`docs/architecture/backend/overtime.md`、`docs/architecture/backend/api.md`。
- 直接测试：`test/remote-catalog-cache.test.js`、`test/remote-overtime-catalog.test.js`、`test/overtime-routes.test.js`、`test/frontend-admin-shell.test.js`、`test/frontend-queue.test.js`，以及新增的图片缓存聚焦测试。

## Compatibility Constraints

- 保留现有 `/api/overtime/gifts`、`/api/overtime/gifts/refresh` 和 `/api/overtime/gifts/local/search` 路径；其中前两个按用户当前明确要求恢复直播间目录语义。
- 新增的服务器搜索只接受 1–100 字符名称或 ID，不接受客户端 URL、文件名、路径或租户身份。
- 服务器图片只允许来自组合根配置的 HTTPS origin，或显式 `127.0.0.1` HTTP 隧道 origin，并且路径必须是单一 `/gift-media/images/<basename>`。
- 本地缓存只写入运行时 `data/overtime-gift-images/`；不写 `public/`、asar、Markdown 或规则数据库之外的持久格式。
- 图片下载限制为 15 秒、5 MiB、禁止重定向；校验 raster 图片签名与扩展名，使用同目录临时文件原子替换。
- 本地图片读取只允许固定缓存目录中的安全 basename 和 raster 扩展名；拒绝遍历、编码绕过和其他方法。
- 保留现有服务器绝对图片 URL 的规则校验兼容性，同时允许新的 `/overtime-gift-images/<basename>` 本地路径。
- 保留工作区内所有无关未提交改动。

## Proposed Changes

1. 调整 hybrid facade：`getSnapshot()` 与 `refresh()` 始终走直播间目录；远程目录继续后台条件刷新，但只供新的 `searchRemote()` 使用。搜索时尝试强制条件刷新，失败且已有远程缓存时使用旧缓存，按名称/ID 返回至多 100 条。
2. 新增小型远程礼物图片缓存模块：只下载搜索命中的、已规范化的服务器图片；复用有效本地文件，失败的单张图片降级为空路径，不让整次搜索失败。
3. 新增 `POST /api/overtime/gifts/server/search`，并为 `/overtime-gift-images/<basename>` 增加只读 GET/HEAD 响应。旧本地搜索端点保留兼容但 Admin 不再调用。
4. Admin 恢复“在售目录 / 刷新在售礼物”，搜索按钮和结果说明改成服务器语义；远程目录 WebSocket 推送不再覆盖主直播间目录。
5. 更新规则图片路径校验以及规范、架构和 API 文档，使目录所有权、缓存边界和兼容端点与新行为一致。

## Milestones

1. **目录所有权和服务器搜索**：先用测试证明 hybrid 的主读取/刷新走本地、远程搜索独立过滤和缓存降级，再修改服务。验证：`node --test test/remote-catalog-cache.test.js test/remote-overtime-catalog.test.js`。
2. **安全图片缓存与本地响应**：测试 URL 限定、大小/类型校验、原子缓存复用、路径遍历拒绝和 GET/HEAD，再接入路由。验证：新增图片缓存测试和 `test/overtime-routes.test.js`。
3. **Admin 与契约文档**：更新文案、端点和推送处理，并同步规范/架构事实。验证：`node --test test/frontend-admin-shell.test.js test/frontend-queue.test.js`。
4. **集成验收**：在本地 Admin 刷新直播间目录、搜索服务器礼物并确认图片从 `127.0.0.1:3000/overtime-gift-images/...` 成功加载。验证：浏览器运行时检查、聚焦测试、diff 检查。

## Verification

- `node --test test/remote-gift-image-cache.test.js test/remote-catalog-cache.test.js test/remote-overtime-catalog.test.js test/overtime-routes.test.js`
- `node --test test/frontend-admin-shell.test.js test/frontend-queue.test.js test/overtime-service.test.js`
- 对实际 Admin 执行一次直播间刷新和一次服务器搜索，检查主目录来源、结果图片 `naturalWidth` 和网络 URL。
- `git diff --check`
- `git diff -- <task-owned files>` 并检查所有新增/修改行都对应本任务。
- `git status --short`，确认没有运行时缓存、密钥、截图或生成文件进入工作区 diff。

## Rollback Or Failure Handling

若实现或验证出现不可接受风险，停止运行时并仅用补丁反向修改本计划列出的任务文件；不使用 reset、blanket checkout 或目录删除。测试临时目录由测试自身清理，真实 `data/overtime-gift-images/` 属于可重新下载的运行时缓存，不纳入 Git，也不在本任务中主动删除。

## Done When

- 顶部目录读取和刷新只展示当前直播间可送礼物，服务器后台推送不会覆盖它。
- 弹窗按名称或 ID 搜索服务器目录，最多返回 100 条；旧本地搜索端点仍可供兼容调用。
- 有服务器图片的搜索结果显示本地同源缓存图，重搜不重复下载；无图或单图下载失败时仅该礼物显示占位图。
- 新增路径和下载边界通过安全聚焦测试，既有加班规则、事件、结算和 overlay 行为不变。
- 规范/架构/API 文档与实现一致，所有聚焦验证通过，最终 diff 和状态已检查。
