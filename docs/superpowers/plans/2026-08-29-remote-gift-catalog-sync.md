# Remote Gift Catalog Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让桌面端加班姬从 lira-server 的全局礼物目录读取可选礼物，同时保留现有本地搜索、SSH 测试入口和 ICP 公网页面，并通过缓存与本地 WebSocket 更新降低延迟和请求量。

**Architecture:** lira-server 在现有公开礼物 API 下增加一个扁平快照端点，复用全局 SQLite 快照、内存 memoization、ETag 和公共缓存；既有分页/详情 API 与网页不变。Electron 主进程通过已配置的授权 API base 使用条件 GET 获取该公开快照，在 `data/overtime-gift-catalog.json` 保存规范化缓存；本地 server 先返回缓存，授权恢复和低频定时器触发后台刷新，变化通过现有本地 `/ws` 广播给 Admin。远程不可用时保留最后成功远程快照并继续支持旧本地目录/本地 Markdown 搜索。

**Tech Stack:** Node.js CommonJS/Express 5/better-sqlite3（server），Electron main + Node HTTP runtime（client），Vanilla JavaScript ES modules、EventBus 和现有 WebSocket，Node `node:test`。

## Global Constraints

- 不新增进程、服务、框架、运行时依赖或数据库；继续使用模块化单体和现有 `LIRA_LICENSE_API_BASE`。
- 生产远程地址必须 HTTPS；测试 SSH 只允许显式配置的 `http://127.0.0.1:<port>`。
- 设备 access token 只在 Electron main process 使用，不能进入 renderer、URL、日志或缓存文件。
- 全局礼物目录仍属于 server catalog DB，不复制进主播租户库；同步失败不得覆盖最近成功快照。
- 保留 `/api/public/gifts`、`/api/public/gifts/:groupId`、本地 `/api/overtime/gifts` 和 `/api/overtime/gifts/local/search` 的兼容响应与行为。
- 新增外部接口必须同步更新 server requirement、acceptance criteria、protocol 文档和自动化测试；公共目录不是 Device API 的受保护路由，其字段与缓存语义在 `docs/protocol/client-server-api.md` 维护，不改变现有 Device API OpenAPI 的路由清单。

---

### Task 1: Server flat catalog snapshot contract

**Files:**

- Modify: `D:/Work/lira-server/src/modules/gifts/gift-catalog-queries.js`
- Modify: `D:/Work/lira-server/src/modules/gifts/service.js`
- Modify: `D:/Work/lira-server/src/routes/gifts-public.js`
- Test: `D:/Work/lira-server/test/gift-public-routes.test.js`
- Test: `D:/Work/lira-server/test/gift-client-catalog.test.js`

**Interfaces:**

- Produces `service.listClientCatalog()` returning `{ catalog: 'all', version, updatedAt, stale, sources, count, gifts }`.
- Produces `GET /api/public/gifts/catalog` returning `{ ok: true, ...snapshot }` with `ETag` and `Cache-Control: public, max-age=300, stale-while-revalidate=1800`.
- Each gift contains only `id`, `name`, `battery`, `rmb`, `priceRaw`, `coinType`, `bagGift`, and safe relative `imageUrl`.

- [x] **Step 1: Add a regression for the flat endpoint and conditional response.**

  Extend the public route fixture with `listClientCatalog`, request `/gifts/catalog`, assert the explicit fields and cache header, then repeat with `If-None-Match` and assert `304`.

- [x] **Step 2: Add the query/service memoized snapshot.**

  Read the newest successful gift sync run and active code rows with parameterized SQL. Cache the read-only result by successful run ID and throw `CATALOG_NOT_READY` when no successful run exists.

- [x] **Step 3: Register the route without changing existing route ordering semantics.**

  Put the exact `/gifts/catalog` route before the `/:groupId` route, reuse the existing rate limiter and cache helper, and map readiness failures to the existing `503`/`Retry-After: 60` response.

- [x] **Step 4: Verify server gift tests.**

  Run `node --test test/gift-public-routes.test.js test/gift-client-catalog.test.js test/gift-catalog-service.test.js` from `D:/Work/lira-server` and confirm the old grouped endpoint tests still pass.

### Task 2: Main-process remote cache and local runtime composition

**Files:**

- Create: `D:/Work/Live/src/bilibili/gift/remote-catalog-cache.js`
- Create: `D:/Work/Live/src/bilibili/gift/hybrid-catalog.js`
- Modify: `D:/Work/Live/src/server/domain-services.js`
- Modify: `D:/Work/Live/src/server.js`
- Modify: `D:/Work/Live/src/electron/main.js`
- Modify: `D:/Work/Live/src/electron/license/remote-license-client.js`
- Modify: `D:/Work/Live/src/electron/license/license-manager.js`
- Test: `D:/Work/Live/test/remote-catalog-cache.test.js`
- Test: `D:/Work/Live/test/remote-license-client.test.js`

**Interfaces:**

- `createRemoteGiftCatalogCache({ dataDir, fetchRemote, onUpdated, now, pollIntervalMs })` exposes `getSnapshot`, `refresh`, `start`, and `stop`.
- `createHybridGiftSaleCatalogService({ local, dataDir, fetchRemote })` exposes the existing `getSnapshot`, `refresh`, and `searchLocal` plus `refreshRemote`, `start`, and `stop`.
- `remoteLicenseClient.getGiftCatalog(etag, token?)` sends `GET /api/public/gifts/catalog` with optional `If-None-Match` and reports `{ notModified, etag }` for `304`; the public catalog caller omits the optional bearer token.
- `licenseManager.getGiftCatalog({ etag })` sanitizes the response and appends only the validated configured API base needed to resolve image paths.

- [x] **Step 1: Test cache persistence, single-flight, 304, and stale fallback.**

  Use a temporary data directory and fake fetcher. Assert a second concurrent refresh makes one request, a `304` keeps gifts unchanged, a failed refresh leaves the JSON cache intact, and a new cache instance reads the persisted snapshot immediately.

- [x] **Step 2: Extend the remote request boundary.**

  Add an opt-in metadata/304 path to the existing request helper without changing other methods. Cap and reject unsafe ETag header values, preserve the 1 MiB response limit, and keep redirect/HTTPS/loopback validation unchanged.

- [x] **Step 3: Compose the hybrid catalog.**

  Prefer the normalized remote snapshot for the picker, retain the local catalog as a no-remote fallback, keep local Markdown search unchanged, and resolve only `/gift-media/images/` paths against the configured server origin. Never accept a client-supplied base URL or streamer id.

- [x] **Step 4: Wire lifecycle and authorization.**

  Pass a main-process callback through `serverOptions.remoteGiftCatalog`, start/stop the cache with the local runtime, trigger `refreshRemote({ force: true })` during `resumeAuthorizedWork`, and broadcast `{ type: 'gift-catalog:update', snapshot }` only after a changed remote revision.

- [x] **Step 5: Verify focused client tests.**

  Run `node --test test/remote-catalog-cache.test.js test/remote-license-client.test.js test/overtime-routes.test.js` from `D:/Work/Live`.

### Task 3: Admin picker and local WebSocket update

**Files:**

- Modify: `D:/Work/Live/public/js/admin/state.js`
- Modify: `D:/Work/Live/public/js/shared/event-bus.js`
- Modify: `D:/Work/Live/public/js/admin/overtime.js`
- Modify: `D:/Work/Live/public/pages/admin/toolbox/overtime.html`
- Test: `D:/Work/Live/test/frontend-admin-shell.test.js`
- Test: `D:/Work/Live/test/frontend-queue.test.js`

**Interfaces:**

- StateService emits `Events.GIFT_CATALOG_UPDATED` for the local WS message type `gift-catalog:update`.
- The picker continues to consume `GET /api/overtime/gifts` and uses `snapshot.gifts`; only labels/status wording changes from room “在售” to server catalog synchronization.

- [x] **Step 1: Handle the update event.**

  Validate the message shape, emit the new EventBus constant, and do not mutate the full application snapshot or trigger unrelated song reloads.

- [x] **Step 2: Apply remote snapshots in the existing picker.**

  Subscribe once in `init`, preserve fixed guard entries and local-search behavior, accept absolute server image URLs, and render stale/source/version information with text nodes/template literals already used by the module.

- [x] **Step 3: Update accessible copy and verify selectors.**

  Rename the status and refresh button to identify the server catalog while leaving element ids and local-search button ids unchanged; update only tests that assert copy or event wiring.

### Task 4: Normative documentation and acceptance evidence

**Files:**

- Modify: `D:/Work/lira-server/docs/requirements/system-rules.md`
- Modify: `D:/Work/lira-server/docs/requirements/acceptance-criteria.md`
- Modify: `D:/Work/lira-server/docs/requirements/traceability.md`
- Modify: `D:/Work/lira-server/docs/protocol/client-server-api.md`
- Modify: `D:/Work/lira-server/docs/protocol/README.md`
- Modify: `D:/Work/lira-server/docs/architecture/overview.md`
- Modify: `D:/Work/lira-server/docs/architecture/data-boundaries.md`
- Modify: `D:/Work/lira-server/README.md`
- Modify: `D:/Work/Live/specs/overtime-gift-sale-refresh_design.md`
- Create: `D:/Work/Live/specs/remote-gift-catalog-sync_design.md`

**Interfaces:**

- Define `REQ-GIFT-004` and `AC-GIFT-004` for one-request flat snapshots, ETag revalidation, and old-snapshot retention.
- Document production `https://api.lirahub.cn` and explicit SSH `http://127.0.0.1:<port>` as the same configurable base contract; do not add a hardcoded deployment URL.

- [x] **Step 1: Record requirement, acceptance, and traceability rows.**

  Link the server route/query/cache implementation and client cache/WS tests to the new IDs, leaving existing gift IDs and statuses intact.

- [x] **Step 2: Document the public endpoint and boundary.**

  Describe payload fields, 200/304/503 semantics, relative image paths, public-web compatibility, and why no remote WebSocket or new service is introduced.

- [x] **Step 3: Add the technical design security checkpoint.**

  Record authentication/token handling, URL validation, stale-data behavior, XSS-safe rendering, and test commands in `specs/remote-gift-catalog-sync_design.md`.

### Task 5: Full risk-based verification

**Files:**

- No new production files; inspect all changed files and existing dirty worktree entries.

- [x] **Step 1: Run server checks.**

  Run `npm test` and `npm run docs:check` in `D:/Work/lira-server`.

- [x] **Step 2: Run client checks.**

  Run `npm run check`, `npm run verify:architecture`, and the focused remote/overtime/frontend tests in `D:/Work/Live`.

- [x] **Step 3: Review boundaries and diff.**

> Verification note: the server's full `npm test` and `npm run docs:check` each
> retain one pre-existing line-cap failure in the unrelated
> `public/admin/app.js`; all catalog-focused checks pass.

Run `git diff --check` in both repositories, inspect `git status --short`, confirm no token/secret/generated runtime file is in the diff, and verify the existing public grouped API and local Markdown fallback remain intact.
