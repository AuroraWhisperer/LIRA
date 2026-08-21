# LIRA 启动性能与运行卡顿测评报告

> 测评日期：2026-08-21<br>
> 测评对象：LIRA Electron 桌面客户端及其同进程 Node.js 后端、Admin renderer<br>
> 测评性质：代码审计 + 本机隔离基线 + 现有生命周期日志复核<br>
> 综合评价：**B-（基础性能良好，但存在启动长尾和明显的状态刷新放大链路）**

## 1. 执行摘要

本次复核没有发现“当前数据库太大，所以软件持续启动缓慢”的证据。当前本地数据规模很小，隔离空库后端启动也只需要几十毫秒。现有生命周期日志显示，大多数成功启动在 1 秒左右进入 `READY`，但确实出现过 8.799 秒和 9.577 秒的长尾。

原性能分析中的多数代码事实成立，但其中一部分把“存在风险的代码路径”写成了“已经测实的瓶颈”。本报告给出的修正结论是：

1. **当前最明确的结构性问题是 Admin 刷新放大。** 首次加载存在重复 `/api/state`，WebSocket 快照又会触发歌曲和状态重载；每次状态加载还会完整重绘队列、SC、表单和礼物区域，并请求盲盒统计。
2. **8–10 秒启动长尾真实存在，但根因尚未定位。** 端口清理代码可以等待两轮 7.5 秒，是高度可疑路径；串行 Cookie 恢复和升级数据迁移也在窗口创建前执行。现有日志没有分阶段耗时，不能只凭总耗时断言是端口清理。
3. **Admin 的 257 KB HTML 不是已证实的后端瓶颈。** 本机连续组合 30 次，耗时中位数只有 2.490 ms。需要进一步测的是 Chromium 解析、模块初始化、网络请求和 DOM 重绘，而不是单纯的服务器拼页。
4. **礼物高峰存在同步 I/O 叠加风险。** 礼物解析、同步 SQLite、同步日志、最终快照和 renderer 重绘处于同一应用进程内；但本次没有礼物压测和 Event Loop 延迟曲线，不能把它写成已经测实的卡顿根因。
5. **常驻 RAF、250 ms 定时器和全屏模糊确实存在，但影响等级不同。** 加班机 RAF 会持续运行；游戏定时器在未进行你画我猜时立即返回；80 px 全屏模糊是否造成 GPU 卡顿必须由 Electron Performance trace 证明。

## 2. 测评范围与限制

### 2.1 纳入范围

- Electron 从 `START` 到创建主窗口的启动链路；
- 旧服务端口清理、Cookie 恢复、数据库初始化、迁移与启动清理；
- Admin HTML 组合、ES 模块加载、初始接口请求和状态重绘；
- WebSocket 快照构造、序列化和 renderer 消费；
- Bilibili 礼物处理中的同步数据库与同步日志；
- Admin 加班机、游戏定时器和全屏播放模糊效果。

### 2.2 未纳入或尚未完成

- 没有采集 Electron renderer 的 DevTools Performance trace；
- 没有采集 GPU、绘制帧率、Long Task 或内存时间线；
- 没有模拟真实直播间的礼物峰值和多个 OBS 客户端；
- 没有对真实用户数据库执行迁移、写入或压测；
- 没有修改任何生产代码，因此本报告是测评与建议，不是优化结果验收。

## 3. 测试环境与方法

| 项目 | 环境 |
|---|---|
| 操作系统 | Windows x64 |
| Node.js | v24.15.0 |
| 桌面运行时 | Electron 43.2.0 |
| 后端 | 同进程 Node.js + `node:http` + `node:sqlite` `DatabaseSync` |
| 前端 | Vanilla JavaScript ES modules + 原生 CSS |
| 测试日期 | 2026-08-21 |

本次采用三类证据：

1. **代码事实**：检查启动顺序、同步 I/O、数据库查询、快照广播和前端事件链；
2. **隔离基线**：每次使用新的临时目录和随机端口启动后端，测量启动、`/api/state` 和 `/api/songs`，结束后删除临时目录；
3. **历史运行证据**：从现有 `desktop.log` 中按 run id 配对 `START` 与 `READY`，只统计完成启动的记录。

隔离基线不读取或迁移仓库中的真实 `data/`。历史日志只提取时间戳和生命周期事件，不把账号、Cookie、弹幕、礼物内容或其他用户数据写入本报告。

## 4. 综合测评

| 维度 | 评价 | 证据置信度 | 结论 |
|---|---|---:|---|
| 空库后端启动 | 良好 | 高 | 3 次隔离启动均低于 70 ms |
| 桌面启动稳定性 | 待改善 | 中 | 中位数 681 ms，但有 8.799 s、9.577 s 长尾，根因未分段 |
| Admin 服务端拼页 | 良好 | 高 | 32 个 fragment、257,040 bytes，组合中位数 2.490 ms |
| Admin 首次数据加载 | 较差 | 高 | 存在重复 state/songs 请求和多次完整状态渲染 |
| 实时状态更新效率 | 较差 | 高 | 每个 snapshot 都会完整 `getState()`，renderer 对所有 snapshot 安排歌曲重载 |
| 多客户端 WebSocket | 中等风险 | 高 | 同轮快照会合并，但 JSON 仍按 socket 重复序列化，未处理写入背压 |
| 礼物峰值处理 | 中高风险 | 中 | 同步 SQLite 和同步日志已确认，实际峰值影响未压测 |
| 常驻 renderer 任务 | 中等风险 | 中 | 加班机 RAF 常驻；游戏闲置定时器开销很低 |
| 全屏视觉效果 | 待验证 | 低 | 80 px blur 存在，但没有 GPU trace |
| 性能可观测性 | 较差 | 高 | 缺少端口、Cookie、数据库、窗口和 ready-to-show 分段耗时 |

综合等级 `B-` 表示：**当前小数据量下的基础响应并不慢，但启动长尾、Admin 刷新放大和高频同步 I/O 会降低可预测性；还缺少运行时 profiling 来确认用户感知卡顿的占比。**

## 5. 实测结果

### 5.1 当前本地数据规模

| 数据库 | 主文件大小 | 当前行数 |
|---|---:|---:|
| `song-request-data.db` / `songs` | 196,608 bytes | 1 |
| `gift-data.db` / `gift_events` | 102,400 bytes | 2 |

两个 WAL 文件测量时均为 0 bytes。这个样本只能说明当前工作区数据很小，不能代表长期直播后的数据库规模。

结论：**当前数据量不是冷启动主要原因。**

### 5.2 隔离空库后端基线

| 样本 | 后端启动 | `/api/state` | `/api/songs` |
|---:|---:|---:|---:|
| 1 | 69.87 ms | 13.33 ms | 3.14 ms |
| 2 | 38.47 ms | 5.37 ms | 2.17 ms |
| 3 | 38.73 ms | 3.68 ms | 2.24 ms |
| **中位数** | **38.73 ms** | **5.37 ms** | **2.24 ms** |

该基线只覆盖 Node 后端，不包含 Electron 初始化、Cookie 恢复、Admin 解析、ES 模块加载和 `ready-to-show`，因此不能直接当作完整桌面启动时间。

### 5.3 Admin HTML 组合

| 指标 | 结果 |
|---|---:|
| Fragment 数量 | 32 |
| 组合后 UTF-8 大小 | 257,040 bytes（251.02 KiB） |
| 连续测量次数 | 30 |
| 最小耗时 | 2.109 ms |
| 中位数 | 2.490 ms |
| P95 | 3.252 ms |
| 最大耗时 | 3.826 ms |

结论：同步读取 32 个 fragment 的设计值得维护，但**以当前磁盘缓存和页面规模看，服务端组合本身不是 8–10 秒启动长尾的解释**。页面在 renderer 中的解析和初始化仍需独立测量。

### 5.4 历史桌面启动分布

现有日志中共找到 9 次同时包含 `START` 和 `READY` 的成功启动：

```text
224, 236, 244, 623, 681, 970, 1274, 8799, 9577 ms
```

| 指标 | `START → READY` |
|---|---:|
| 最快 | 224 ms |
| 中位数 | 681 ms |
| 最慢 | 9,577 ms |
| 明显长尾 | 8,799 ms、9,577 ms |

这组数据说明启动慢是**长尾问题而不是每次都慢**。`READY` 在 `BrowserWindow` 创建后记录，但主窗口还要等 `ready-to-show` 才展示，所以它不是最终可交互时间。

## 6. 相关代码与证据

### 6.1 端口清理可能等待两轮 7.5 秒

默认清理超时定义为 7,500 ms：

```js
const PORT_CLEANUP_TIMEOUT_MS = 7500;
const PORT_CLEANUP_POLL_MS = 120;
```

来源：[src/server.js](../src/server.js#L30-L34)

清理旧服务时先等待一次；如果旧服务没有退出，会发送 `SIGTERM`，随后再等待一次：

```js
await requestLocalShutdown(port, host, readSessionToken(options.dataDir), fetchImpl);
if (await waitForPortRelease(port, host, options)) {
  if (runtimeForPort) removeRuntimeInfo(options.dataDir, runtimeForPort);
  return;
}

// ...确认 PID 属于 LIRA 后...
process.kill(pid, 'SIGTERM');
await waitForPortRelease(port, host, options);
```

来源：[src/server/lifecycle.js](../src/server/lifecycle.js#L65-L110)

因此，“端口清理最多等待 7.5 秒”不准确。极端路径仅两轮端口等待就接近 15 秒，另有健康检查和关闭请求的超时。但现有日志没有记录这两轮实际耗时，所以只能把它列为高优先级假设，不能认定为已证实根因。

### 6.2 窗口创建前还有 Cookie 恢复和完整后端启动

```js
await restoreMusicCookieSnapshots();
await restoreBilibiliCookieSnapshot();

lifecycleState.runtime = createDesktopRuntime(serverRuntimeModule, {
  dataDir: pathState.dataDir,
  safeStorage
});

var serverInfo = await lifecycleState.runtime.start(serverOptions);
createMainWindow(serverInfo.baseUrl);
```

来源：[src/electron/main.js](../src/electron/main.js#L157-L191)

音乐 Cookie 按平台串行恢复，每个 Cookie 也逐个 `await cookies.set(...)`：

```js
for (var i = 0; i < platforms.length; i++) {
  await restoreMusicCookieSnapshot(platforms[i]);
}
```

来源：[src/electron/main.js](../src/electron/main.js#L448-L452)

```js
for (const cookie of Array.isArray(payload.cookies) ? payload.cookies : []) {
  await loginSession.cookies.set(toElectronCookieDetails(cookie));
}
```

来源：[src/electron/auth-manager.js](../src/electron/auth-manager.js#L112-L124)

这说明 `START → READY` 同时覆盖 Cookie 恢复、端口处理、数据库初始化和窗口创建，现有总耗时不能直接归因给其中一个阶段。

### 6.3 五个 SQLite 数据库同步打开和迁移

```js
databases.songDb = openSqliteDatabase(/* ... */);
databases.superChatDb = openSqliteDatabase(/* ... */);
databases.giftDb = openSqliteDatabase(/* ... */);
databases.musicDb = openSqliteDatabase(/* ... */);
databases.checkinDb = openSqliteDatabase(/* ... */);

databases.songDb.exec(schema.SONG_TABLE_SCHEMA);
// ...其余 schema...
runAllMigrations(databases, options);
```

来源：[src/storage/database.js](../src/storage/database.js#L31-L63)

底层使用同步数据库 API：

```js
const database = new DatabaseSync(filePath);
database.exec(pragmas.map((p) => `${p};`).join('\n'));
```

来源：[src/storage/database.js](../src/storage/database.js#L240-L252)

启动时还会执行礼物修复、默认分类、队列清理和可选 retention：

```js
giftService.repairGiftV2Events({ db });
domainServices.songs.ensureCategory('默认');
domainServices.queue.clearOnStartup();
runStartupRetention();
```

来源：[src/server.js](../src/server.js#L169-L176)

当前小库下这些操作很快；大库、首次迁移或异常退出后的恢复场景才是重点测量对象。

### 6.4 Admin 每次请求同步组合 32 个 fragment

```js
function composeAdminHtml(publicDir) {
  return ADMIN_FRAGMENT_PATHS
    .map(relativePath => fs.readFileSync(path.join(publicDir, relativePath), 'utf8'))
    .join('');
}
```

来源：[src/server/admin-page.js](../src/server/admin-page.js#L10-L55)

Admin 路由每次请求都会调用组合函数：

```js
if (isAdminPage) {
  try {
    sendContent(null, Buffer.from(composeAdminHtml(publicDir)));
  } catch (error) {
    sendContent(error);
  }
  return;
}
```

来源：[src/server/http-utils.js](../src/server/http-utils.js#L164-L170)

代码事实成立，但 2.490 ms 的实测中位数说明不能仅凭 `readFileSync` 和 257 KB 就把它定性为主要启动瓶颈。

### 6.5 首次加载和快照存在请求放大

应用启动时先连接 WebSocket，再执行 `reloadAll()`：

```js
stateService.connectSocket();
await stateService.reloadAll();
```

来源：[public/js/admin/app.js](../public/js/admin/app.js#L95-L97)

`reloadAll()` 先加载状态，再加载歌曲；而 `reloadSongs()` 末尾又加载一次状态：

```js
async reloadAll() {
  await this.reloadState();
  await this.reloadSongs();
}

async reloadSongs() {
  // ...请求 /api/songs...
  this.songs = payload.data || [];
  await this.reloadState();
}
```

来源：[public/js/admin/state.js](../public/js/admin/state.js#L111-L165)

因此单次 `reloadAll()` 已经固定产生：

```text
GET /api/state
GET /api/songs
GET /api/state
```

任何 WebSocket snapshot 又会安排一次 240 ms 后的 `reloadSongs()`，它随后再调用 `reloadState()`：

```js
if (payload.type === 'snapshot') {
  // ...接收完整状态并发布 STATE_LOADED...
  this.scheduleSongReload();
}

scheduleSongReload() {
  clearTimeout(this.songReloadTimer);
  this.songReloadTimer = setTimeout(() => {
    this.reloadSongs().catch(showError);
  }, 240);
}
```

来源：[public/js/admin/state.js](../public/js/admin/state.js#L43-L67) 和 [public/js/admin/state.js](../public/js/admin/state.js#L179-L183)

这意味着正常 WebSocket 首次连接后，Admin 通常还会补发一轮 songs + state。更重要的是，这个逻辑不检查 snapshot reason：礼物、设置、SC、队列等状态变化也会触发歌曲列表重载。

### 6.6 每次状态加载都会完整渲染并请求盲盒统计

```js
function renderState(appState, songs) {
  renderSuperChatQueue(superChats);
  window.AdminApp.forms.fillForm(settings);
  window.AdminApp.gifts.renderGiftPanel(/* ... */);
  window.AdminApp.gifts.loadBlindBoxStats();

  // ...
  list.innerHTML = queueItems.map(/* ... */).join('');

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', /* ... */);
  });
}
```

来源：[public/js/admin/queue.js](../public/js/admin/queue.js#L77-L194)

盲盒请求有并发保护，但请求期间收到新调用会设置 pending，并在完成后补发一次：

```js
if (blindBoxStatsLoading) {
  blindBoxStatsPending = true;
  return;
}

// ...请求完成后...
if (blindBoxStatsPending) {
  blindBoxStatsPending = false;
  loadBlindBoxStats();
}
```

来源：[public/js/admin/gifts/blindbox.js](../public/js/admin/gifts/blindbox.js#L79-L120)

这是当前证据最充分的 renderer 风险：同一份业务变化可能引起状态广播、完整 DOM 重建、事件重新绑定、歌曲重载、状态重载和盲盒统计重载。

### 6.7 WebSocket 已合并同轮快照，但仍重复序列化

```js
function broadcastSnapshot(context, reason) {
  if (sockets.size === 0) return;
  pendingSnapshot = { context, reason };
  if (snapshotFlushQueued) return;
  snapshotFlushQueued = true;
  queueMicrotask(() => {
    snapshotFlushQueued = false;
    const next = pendingSnapshot;
    pendingSnapshot = null;
    if (!next || sockets.size === 0) return;
    const payload = { type: 'snapshot', reason: next.reason, state: next.context.getState() };
    for (const socket of Array.from(sockets)) {
      sendWebSocket(socket, payload);
    }
  });
}
```

来源：[src/server/ws.js](../src/server/ws.js#L237-L252)

同一事件循环轮次内的多个快照会合并，`getState()` 每次 flush 只执行一次。这一点减轻了原分析所描述的风险。但 `sendWebSocket()` 对每个 socket 再做一次 JSON 序列化：

```js
function sendWebSocket(socket, payload) {
  sendWebSocketFrame(socket, Buffer.from(JSON.stringify(payload)), 0x1);
}
```

来源：[src/server/ws.js](../src/server/ws.js#L281-L283)

`getState()` 包含队列、SC、礼物、礼物冲刺、检测状态、加班机、设置、分类、标签、歌曲数量、歌词和 WeSing 等完整状态：

```js
function getState() {
  return {
    queue: domainServices.queue.getSnapshot(),
    superChats: domainServices.superChats.getSnapshot(),
    gifts: domainServices.gifts.getSnapshot(),
    giftSprint: domainServices.gifts.getSprintSnapshot(),
    giftDetection: domainServices.gifts.getStatus(),
    overtime: domainServices.overtime.getSnapshot(),
    settings: settingsStore.getSettings(),
    categories: domainServices.songs.listCategories(),
    tags: domainServices.songs.listTags(),
    songCount: domainServices.songs.count(),
    // ...live、歌词和 WeSing 状态...
  };
}
```

来源：[src/server.js](../src/server.js#L411-L428)

其中标签会读取所有非空标签歌曲，礼物冲刺会执行聚合查询。当前数据很小时开销低，但数据量和客户端数量增长后需要重新测量。

### 6.8 礼物路径叠加同步数据库与同步日志

每个成功解析的礼物至少记录一条可读日志：

```js
console.log(formatBilibiliGiftLog(gift, {
  connectionGeneration: this.connectionGeneration,
  connectionAttempt: this.connectionAttempt
}));
```

来源：[src/bilibili/danmaku/message-handlers.js](../src/bilibili/danmaku/message-handlers.js#L222-L226)

Electron 会把 `console.log/info/debug/warn/error` 包装为同步文件追加：

```js
fs.appendFileSync(filePath, formatLogLine({
  timestamp: context.now(),
  // ...
  message: redactedMessage
}), 'utf8');
```

来源：[src/electron/terminal-log.js](../src/electron/terminal-log.js#L41-L53)

礼物检测同时执行同步查询、更新、插入和去重：

```js
let row = gift.platformId ? findGiftByPlatformIdentity(giftDb, gift) : null;
if (!row) row = findRecentGiftCommandDuplicate(context, gift);

if (row) {
  updateGiftEventIfProgressed(context, row, gift, { updateSprint: false });
  giftDb.prepare(/* UPDATE */).run(detectedAtMs, Number(row.id));
  row = readGift(giftDb, row.id);
} else {
  row = insertProgressGift(giftDb, gift, /* ... */);
}
```

来源：[src/bilibili/gift/detection-service.js](../src/bilibili/gift/detection-service.js#L39-L91)

礼物最终确认时才触发 `bilibili:gift` snapshot，并非每个原始礼物包都立即广播完整快照。原分析的风险方向成立，但事件时序应按“解析/进度 → 最终确认 → snapshot”描述。

### 6.9 常驻 renderer 任务的影响不能等量看待

加班机初始化后永久调度 RAF；只要存在 overtime state，每帧都会更新文字和 class：

```js
function updateClock(nowMs) {
  if (overtimeState) {
    // ...计算时间...
    clock.textContent = value;
    clock.classList.toggle('is-calendar', /[天年]/.test(value));
    clock.classList.toggle('is-finished', value === '该下播了');
  }
  requestAnimationFrame(updateClock);
}
```

来源：[public/js/admin/overtime.js](../public/js/admin/overtime.js#L228-L239)

游戏模块每 250 ms 调用一次更新，但非你画我猜进行中时立即返回：

```js
setInterval(updateDrawClock, 250);

function updateDrawClock() {
  if (activeGameSession?.game !== 'draw-guess'
      || activeGameSession.state?.phase !== 'drawing'
      || !drawClock) return;
  // ...
}
```

来源：[public/js/admin/games.js](../public/js/admin/games.js#L42-L43) 和 [public/js/admin/games.js](../public/js/admin/games.js#L339-L345)

全屏播放器使用 80 px 模糊：

```css
.player-fs-bg {
  position: absolute;
  inset: 0;
  filter: blur(80px);
  transform: scale(1.15);
}
```

来源：[public/css/playback/fullscreen.css](../public/css/playback/fullscreen.css#L24-L32)

RAF 是明确的持续工作；游戏闲置 timer 的单次成本很低；模糊效果的 GPU 成本取决于窗口尺寸、显卡、可见性和合成路径，必须用 trace 验证。

## 7. 对原性能结论的真实性复核

| 原结论 | 判定 | 修正 |
|---|---|---|
| 当前数据库规模不是启动慢主因 | 成立 | 当前样本和隔离基线均支持 |
| 旧端口清理会造成启动长尾 | 可能成立 | 路径真实，但当前日志没有阶段证据 |
| 旧端口清理最多等待 7.5 秒 | 不成立 | 极端情况下可等待两轮，接近 15–16 秒 |
| Electron 等后端完成后才建窗口 | 成立 | 其前还有串行 Cookie 恢复，原结论不完整 |
| 升级分区迁移可能同步阻塞 | 成立 | 仅旧目录存在且新目录不存在时触发，不是每次启动 |
| Admin 由 32 个 fragment、约 257 KB 组成 | 成立 | 数字复核一致 |
| Admin 服务端拼页是明显启动瓶颈 | 不成立 | 本机中位数 2.490 ms，只能继续怀疑 renderer 初始化 |
| Admin 首次加载有重复 state 请求 | 成立 | `reloadAll()` 固定产生两次 state |
| 任意 snapshot 都会安排歌曲重载 | 成立 | 未按 snapshot reason 过滤 |
| 快照会引发完整状态重绘 | 成立 | 队列、SC、表单、礼物和盲盒统计均参与 |
| 每轮广播重新构造完整状态 | 成立 | 同一轮会合并，`getState()` 每次 flush 执行一次 |
| 每个 socket 重复 JSON 序列化 | 成立 | `sendWebSocket()` 内部 stringify |
| 礼物高峰叠加同步日志与 SQLite | 成立 | 实际卡顿程度未压测 |
| 游戏 250 ms timer 会持续造成明显负载 | 证据不足 | 闲置时立即返回，预计影响很低 |
| 全屏 blur 会造成 GPU 卡顿 | 待验证 | 代码风险存在，没有 GPU trace |

## 8. 风险优先级

### P0：先补启动阶段耗时证据

在不改变启动顺序的前提下，分别记录：

1. `START`；
2. 旧分区迁移结束；
3. 音乐 Cookie 恢复结束；
4. Bilibili Cookie 恢复结束；
5. 端口清理结束；
6. 数据库创建与迁移结束；
7. 礼物修复、队列清理和 retention 结束；
8. `BrowserWindow` 创建；
9. `ready-to-show`；
10. Admin 首次可交互。

没有这些分段数据，就不能可靠解释 8–10 秒长尾。

### P1：消除 Admin 请求和重绘放大

- `reloadAll()` 不应重复加载 state；
- snapshot 只有 `songs:*` 原因才应刷新歌曲列表；
- 盲盒统计应在礼物变化或面板需要时刷新；
- 队列、SC、表单和礼物视图应根据相关状态变化分别更新，而不是所有 snapshot 都完整重绘。

这是当前最有把握改善用户感知卡顿的方向。

### P2：降低快照构造和多客户端广播成本

- 记录 `getState()` 总耗时以及每个子查询耗时；
- 对同一 payload 只执行一次 `JSON.stringify()`；
- 记录 payload bytes、socket 数量和 `socket.write()` 背压；
- 在数据增长后重新评估标签扫描、SC 列表、队列列表和礼物聚合。

### P3：压测礼物高峰下的同步 I/O

- 在临时数据库上重放可控礼物事件；
- 记录每秒事件数、同步日志次数、SQLite 耗时、snapshot 数量和 Event Loop delay；
- 再决定是否需要日志缓冲、批处理或更窄的领域事件。

### P4：用 renderer/GPU trace 决定视觉优化

- 比较加班机 RAF 启用前后主线程时间；
- 比较全屏 blur 开关前后的 GPU、Raster 和帧率；
- 检查页面隐藏时是否仍执行不必要的动画与 DOM 写入。

## 9. 建议的正式验收场景

后续优化完成后，应至少用以下场景验收，而不是只看一次启动：

| 场景 | 采样要求 | 主要指标 |
|---|---|---|
| 正常桌面启动 | 连续 20 次 | `START → ready-to-show` P50/P95/最大值、各阶段耗时 |
| 旧服务占用端口 | 优雅关闭、无法关闭各 5 次 | 两轮等待是否触发、最终启动耗时和错误语义 |
| 首次升级迁移 | 小/中/大 Chromium 分区副本 | 迁移耗时、窗口出现时间、数据完整性 |
| Admin 首次加载 | 空库和中等数据各 5 次 | 请求数、JS 执行、DOM、Long Task、可交互时间 |
| 高频 snapshot | 多种 reason、1/5/10 个客户端 | `getState()`、序列化、payload、Event Loop delay |
| 礼物峰值 | 明确的阶梯事件速率 | SQLite、日志、snapshot、Long Task、丢包和重复处理 |
| 全屏播放 | blur 开/关 | FPS、GPU/Raster 时间、renderer CPU |

推荐的 Admin 行为验收条件：

- 初始加载不出现无业务必要的重复 `/api/state`；
- 非歌曲 snapshot 不请求 `/api/songs`；
- 同一时刻大量 snapshot 被合并且不会形成持续补发请求；
- 礼物或 SC 更新不重建与其无关的歌曲筛选和表单 DOM；
- 所有优化保持 HTTP、WebSocket、IPC、设置和持久化契约不变。

## 10. 最终结论

LIRA 当前不是“数据库已经拖垮启动”的状态。正常启动样本和空库后端基线都比较快，问题集中在两类：

1. **启动时间不稳定**：少数 8–10 秒长尾已被日志证实，但缺少阶段埋点，旧端口清理只是最可疑路径之一；
2. **实时更新链路过宽**：snapshot 会触发完整状态消费、DOM 重绘、歌曲重载、状态重载和盲盒统计，这条链路在直播高峰下最可能放大卡顿。

因此，正确的工程顺序不是立即大规模重构，而是：**先补分段耗时 → 修复已确认的 Admin 刷新放大 → 压测礼物与多客户端快照 → 最后依据 renderer/GPU trace 决定动画和模糊优化。**

## 11. 消除潜在影响因素的实施规划

### 11.1 总体目标与约束

目标不是把所有同步代码都改成异步，而是在不改变 HTTP、WebSocket、IPC、登录恢复、设置和持久化契约的前提下，消除已经确认的请求/渲染放大，定位启动长尾，再按实测结果处理高频 I/O 和视觉任务。

实施采用五个阶段，每阶段都要有独立回归和可比较的指标。任何阶段如果需要改变公共响应形状、WebSocket 消息语义、Cookie 恢复顺序、SQLite 事务边界或 Electron 权限边界，应先停在设计评审，不直接混入性能修复。

### 11.2 Phase 0 — P0 启动分段定位

**目标：**把 8–10 秒现象拆成可归因的阶段，先证明端口清理、Cookie、迁移、数据库或窗口展示到底是谁在等待。

**涉及文件：**

- `src/electron/main.js`
- `src/server.js`
- `src/server/lifecycle.js`
- `test/server-lifecycle.test.js`
- `test/electron-main-modules.test.js`

**实施步骤：**

1. 在 Electron 启动路径记录以下结构化阶段名和耗时：`start`、`partition-migration`、`music-cookie-restore`、`bilibili-cookie-restore`、`port-cleanup`、`database-init`、`startup-repair`、`runtime-ready`、`window-create`、`ready-to-show`。
2. 为 `cleanupOwnPortOccupant()` 增加可选的内部阶段回调或计时结果，至少区分健康检查、优雅关闭等待、强制终止等待；日志只写毫秒、结果和是否触发，不写 token、Cookie、路径或用户内容。
3. 保持当前等待和关闭语义不变，先只测量，不在同一阶段缩短超时。
4. 在生命周期测试中覆盖：无旧服务、优雅退出、优雅退出超时后强制终止、强制终止后端口仍未释放四条路径。

**验收门槛：**连续 20 次桌面启动能得到 `START → ready-to-show` 的 P50/P95/最大值，并且每个长尾样本都有阶段归因；若仍有无法归因的长尾，停止后续端口策略改动，先补充日志。

### 11.3 Phase 1 — P1 消除 Admin 请求放大

#### Task 1：合并首次 state 请求

**涉及文件：**

- `public/js/admin/state.js`
- `public/js/admin/app.js`
- `test/frontend-admin-shell.test.js`（必要时新增针对 state service 的聚焦测试）

**实施步骤：**

1. 让 `reloadAll()` 保留一次 `reloadState()`，再调用不重复 state 的歌曲加载路径，例如为 `reloadSongs()` 增加明确的内部 `reloadState: false` 选项；普通外部调用仍保持现有默认行为。
2. WebSocket snapshot 继续更新内存中的完整状态，但只在 reason 以 `songs:` 开头时调用 `scheduleSongReload()`；`bilibili:*`、`superchat:*`、`settings`、`queue:*`、`theme:*` 不再触发歌曲列表请求。
3. 保留现有 240 ms 去抖，只把它限制在歌曲确实可能变化的 reason 上。
4. 为初始加载、歌曲变更 snapshot、礼物 snapshot 和设置 snapshot 写请求计数测试，明确断言不会出现额外 `/api/songs` 或重复 `/api/state`。

**验收门槛：**正常首屏最多一轮 state + 一轮 songs；非歌曲 snapshot 不触发 `/api/songs`；HTTP 和 WebSocket 响应格式不变。

#### Task 2：把全量 render 改成按领域更新

**涉及文件：**

- `public/js/admin/queue.js`
- `public/js/admin/gifts/blindbox.js`
- `public/js/admin/app.js`
- `public/js/admin/state.js`
- `test/frontend-admin-shell.test.js`

**实施步骤：**

1. 在 Admin state 事件中携带内部 `reason` 或领域变更标记，不改变网络消息格式；HTTP 初始加载使用 `initial`，歌曲、队列、礼物、设置分别归类。
2. `queue.js` 保存上一次的 queue、SC、settings、gift、liveStatus 和 categories 引用/版本，只在对应领域变化时调用对应的 DOM render 函数；不要用每次 `JSON.stringify` 全状态作为比较手段。
3. 将队列列表、SC 列表、表单、礼物面板、歌曲分类筛选拆成独立的最小更新函数；只有 queue 变化才重建 `queueList` 并重新绑定操作按钮。
4. 从 `renderState()` 移除每次调用的 `loadBlindBoxStats()`；盲盒模块在首次可见时加载一次，收到 `Events.GIFT_RECEIVED` 或用户主动打开统计面板时刷新。
5. 测试状态只改变歌词、设置、礼物、歌曲和队列时，分别断言不相关容器没有重新渲染；测试盲盒首载、礼物事件和面板打开各只产生预期请求。

**验收门槛：**礼物/SC 更新不重建歌曲队列和歌曲筛选；设置更新不重建礼物表；盲盒统计不随每个普通 snapshot 补发请求；现有按钮事件仍只绑定一次。

### 11.4 Phase 2 — P2 限制快照与礼物高峰成本

#### Task 3：降低 WebSocket 快照序列化和完整状态读取

**涉及文件：**

- `src/server/ws.js`
- `src/server.js`
- `src/music/song-service.js`
- `src/bilibili/gift/query-service.js`
- `test/websocket-transport.test.js`
- `test/server-smoke.test.js`

**实施步骤：**

1. 保留现有同轮 snapshot 合并；在 flush 内对 payload 只做一次 `JSON.stringify()`，向每个 socket 复用同一个 Buffer，控制帧仍走原路径。
2. 为 `getState()` 增加低开销的内部耗时统计，分别记录 tags、gift sprint、gift recent、queue、SC 和其它状态域，不在默认日志中打印完整状态。
3. 为仅在歌曲变更时变化的 categories/tags/songCount 增加运行时缓存；由歌曲保存、删除、导入、启停路由使对应缓存失效。
4. 为仅在礼物 final/reset/clear 时变化的 gift recent/gift sprint 增加缓存；进度事件只更新检测状态，不强制重扫不变的聚合域。
5. 先不引入 Worker、独立进程或新的数据库连接；只有 Event Loop delay 和查询耗时证明 `DatabaseSync` 仍是主要瓶颈时，才另行提出架构决策。
6. 测试快照合并仍保留最新 reason；测试多个 socket 收到相同 payload；测试缓存失效后下一次快照能读到新歌曲/礼物数据。

**验收门槛：**多 socket 下每轮只序列化一次；非相关领域变化不会重新扫描 tags 或 gift sprint；完整 snapshot 的公共字段和 reason 枚举不变。

#### Task 4：降低礼物 burst 的同步 I/O

**涉及文件：**

- `src/bilibili/gift/detection-service.js`
- `src/bilibili/gift/event-service.js`
- `src/bilibili/danmaku/message-handlers.js`
- `src/electron/terminal-log.js`
- `src/electron/main.js`
- `test/gift-detection-service.test.js`
- `test/electron-main-modules.test.js`

**实施步骤：**

1. 先在临时数据库压测中记录每礼物的 detection、dedupe、update、insert、finalize 和日志耗时，区分“数据库慢”与“日志慢”。
2. 复用 `detection-service` 内的 prepared statement，避免每个礼物反复解析相同 SQL；保持每个礼物的现有事务、去重和 finalization 语义。
3. 合并或降级重复的礼物诊断日志：保留 final、错误和必要审计字段；对连续的 ignored/进度决策使用计数摘要，避免每个无效包都同步落盘。
4. 只有压测证明 `appendFileSync` 造成明显 Event Loop delay 时，才把 `terminal-log.js` 改为有序异步批量写入；该改动必须提供 shutdown flush、队列上限、写入失败告警和日志顺序测试，不能静默丢失 final/error 日志。
5. 不把 SQLite 写入简单移到异步 Promise；`DatabaseSync` 的事务边界和礼物结算幂等性必须保持。若需要 Worker 才能达标，另立 ADR 和迁移计划。

**验收门槛：**在临时数据库和固定礼物速率下，记录 Event Loop delay、每秒日志行数、SQLite p95、snapshot 数和 final 处理延迟；优化后不得出现重复结算、丢 final 事件或日志关闭时截断。

### 11.5 Phase 3 — P3 停止不必要的 renderer 常驻工作

#### Task 5：让 Overtime RAF 按状态和可见性运行

**涉及文件：**

- `public/js/admin/overtime.js`
- `test/frontend-admin-overtime.test.js`（如现有 Admin 测试不覆盖该模块则新增）

**实施步骤：**

1. 保存 `rafId`，仅在状态为 running 且 `document.visibilityState === 'visible'` 时启动循环。
2. paused/finished/disabled 状态只渲染一次，不再每帧写 `textContent` 和 class。
3. 监听 `visibilitychange`，隐藏页面时 `cancelAnimationFrame`，重新可见且仍在运行时恢复。
4. 只有显示值变化时才写 DOM，避免同一秒内重复设置相同字符串。

**验收门槛：**暂停加班机和隐藏 Admin 页面时没有持续 RAF；运行状态仍保持平滑倒计时；模块销毁或页面关闭时没有遗留 RAF。

#### Task 6：让游戏计时器只在 draw-guess 活跃时存在

**涉及文件：**

- `public/js/admin/games.js`
- `test/frontend-games.test.js`

**实施步骤：**

1. 用 `drawClockTimer` 记录计时器句柄；进入 `draw-guess/drawing` 时启动，离开 drawing、结束游戏或收到 shutdown 时清理。
2. 使用递归 `setTimeout` 或受控 interval 只更新活跃游戏；移除模块初始化时永久存在的 `setInterval(updateDrawClock, 250)`。
3. 测试空闲、开始、暂停、结束和重新开始五种状态的 timer 数量与清理行为。

**验收门槛：**闲置 Admin 没有游戏计时器；drawing 状态的倒计时精度和现有 UI 文案不变。

### 11.6 Phase 4 — P4 处理低优先级静态资源与 GPU 风险

#### Task 7：缓存静态 Admin fragment 组合结果

**涉及文件：**

- `src/server/admin-page.js`
- `test/admin-page-composition.test.js`

**实施步骤：**

1. 在进程内缓存由固定 `PUBLIC_DIR` 组合出的 HTML，避免每次 Admin 路由请求重新执行 32 次 `readFileSync`。
2. 保留测试对 fragment 顺序、唯一 ID、token 注入和不同 `publicDir` 的覆盖；缓存键必须包含绝对 publicDir，避免测试或多实例串数据。
3. 不把缓存误当作启动优化：首次组合耗时和 renderer 解析仍要单独测量。

**验收门槛：**Admin 响应体和 headers 不变；同一进程第二次请求不再重复读取 fragment；测试环境之间不存在缓存污染。

#### Task 8：用 trace 决定 fullscreen blur 是否修改

**涉及文件：**

- `public/css/playback/fullscreen.css`
- 播放页面对应的 renderer 性能采集说明

**实施步骤：**

1. 先在同一窗口尺寸和素材下采集 blur 80 px 开/关的 FPS、GPU、Raster、renderer CPU 和 Long Task。
2. 只有 blur 明确占用主要 GPU/Raster 时间时，才采用最小视觉退化方案：降低 blur 半径或换成静态渐变背景，并保留全屏视觉层级。
3. 若 trace 显示瓶颈来自图片解码、动画或 DOM，而不是 blur，撤销 blur 方向，修复真正的 owner。

**验收门槛：**视觉回归截图通过，GPU/Raster 指标有可重复改善；没有 trace 证据时不改 80 px 数值。

### 11.7 阶段顺序与回滚策略

建议按以下顺序逐阶段合并，每阶段单独跑回归，不把 P0–P4 混成一次大改：

```text
P0 分段计时
  ↓
P1 Admin 请求去重 + 领域化 render
  ↓
P2 snapshot 序列化/状态缓存 + 礼物 burst 测量与优化
  ↓
P3 Overtime RAF + 游戏 timer 生命周期
  ↓
P4 fragment 缓存 + 有 trace 依据的 blur 调整
```

每个阶段的回滚边界是该阶段自身的文件和测试；不使用 `git reset --hard`、整目录 checkout 或删除用户数据。若某阶段的指标没有改善，保留测量结果，回退该阶段实现，不继续叠加下一阶段。

### 11.8 完成定义

全部潜在因素只有在以下条件同时满足时，才可称为“已消除或已证伪”：

- 8–10 秒启动长尾有分阶段证据，端口、Cookie、迁移和数据库各自的 P95 已知；
- 首屏不再重复请求无业务必要的 state/songs，非歌曲 snapshot 不刷新歌曲；
- 无关状态变化不会触发大范围 DOM 重建或盲盒统计补发；
- 多 socket snapshot 只序列化一次，并有 payload/backpressure 观测；
- 礼物 burst 的 SQLite、日志、Event Loop delay 和 final 延迟有固定场景基线；
- Overtime/游戏空闲时不保留持续 RAF/timer；
- fragment 缓存和 blur 调整均有响应体、视觉和性能回归；
- `npm run verify:quick`、相关 `node:test`、Electron 流程验证和最终 `git diff --check` 全部通过；
- HTTP、WebSocket、IPC、认证、设置、持久化和礼物结算契约没有变化。
