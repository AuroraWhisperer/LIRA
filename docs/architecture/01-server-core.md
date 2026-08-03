# 后端核心 — HTTP 服务器、路由、WebSocket

> 涉及文件：`src/server.js`, `src/server/*`, `src/shared/utils.js`

---

## 技术选型

- **HTTP 框架**：无。使用 Node.js 原生 `http.createServer`，手工路由分发。
- **WebSocket**：手写 RFC 6455 实现，零第三方依赖。
- **路由模式**：前缀分发 + METHOD+路径 精确匹配。
- **请求体解析**：手动读取 Stream → JSON.parse，限制 16MB。
- **静态文件服务**：手工 MIME 推断 + `fs.readFileSync`。

---

## 入口文件：`src/server.js`

### 启动流程

```
require('server.js')
    │
    ├─ 解析路径常量 (ROOT_DIR, PUBLIC_DIR, DATA_DIR, DB paths)
    ├─ createDatabases() → 4 个 SQLite DB 连接
    ├─ createSettingsStore(songDb) → 设置读写
    ├─ createDomainServices({ db, settingsStore }) → 领域服务
    ├─ initLyricsService() → 歌词缓存目录
    ├─ giftService.repairGiftV2Events() → 礼物数据修复
    ├─ settingsStore.migrate*() → 设置迁移
    ├─ domainServices.songs.ensureCategory('默认')
    ├─ domainServices.queue.clearOnStartup()
    ├─ runStartupRetention() → 按配置清理过期数据
    │
    ├─ http.createServer(requestHandler)
    ├─ server.on('upgrade', wsUpgradeHandler)
    ├─ registerShutdownSignals() → SIGINT/SIGTERM/SIGHUP
    │
    └─ (若 require.main === module) → startServer()
```

### 请求处理流程

```
HTTP Request
    │
    ├─ 路径 = /ws?
    │   └─ 返回 400 错误（提示用 WebSocket 客户端）
    │
    ├─ 路径以 /api/ 开头？
    │   └─ apiRoutes.handleApi(apiContext, req, res, url)
    │       ├─ 读取 body（如需要）
    │       ├─ 按 prefix → routes[method + path] 分发
    │       └─ 返回 JSON { ok, ... }
    │
    └─ 否则
        └─ servePageOrAsset(PUBLIC_DIR, req, res, url)
            ├─ 无扩展名 → 返回 index.html
            ├─ 有扩展名 → MIME 推断 + fs.readFileSync
            └─ 不存在 → 404
```

### API Context（领域上下文）

`createApiContext()` 将领域服务聚合为分组对象，注入路由层：

```javascript
{
  maxBodyBytes,        // 16MB
  broadcastSnapshot,   // WebSocket 广播函数
  songs:   { list, save, delete, toggle, import, listCategories },
  queue:   { add, handleAction },
  superChat: { handleAction },
  gifts:   { resetSprint, getHistory, getBlindBoxStats, search },
  debug:   { getGiftMessages, getGiftMessageStats, clearGiftMessages },
  data:    { clearSongLibrary, clearSuperChats, clearPlayback, ... },
  playback: playbackStore,
  theme:   themeStore,
  bilibili: { liveStatus, configure, reconnect, updateStatus, auth },
  settings: { defaults, get, set },
  system:  { getHealth, getState, getMetrics, shutdown },
  music:   { registry, getCacheStats, clearCache }
}
```

### 生命周期管理

**启动**：
1. `lifecycle.cleanupOwnPortOccupant()` — 清理旧进程占用的端口
2. `lifecycle.listenWithFallback()` — 端口递增重试（3000 → 3001 → …）
3. 记录 `startedPort`
4. `configureBilibiliListener()` — 启动 Bilibili 弹幕连接
5. 可选：`openAdminPageIfNeeded()` — AUTO_OPEN_ADMIN 环境变量启用

**关闭**：
1. `isShuttingDown = true`（防止重复关闭）
2. 执行 `preShutdownHook`（Electron 端保存播放器状态）
3. `bilibiliClient.stop()` — 断开弹幕连接
4. 向所有 WebSocket 客户端发送 `{ type: 'shutdown' }`
5. 关闭所有 socket
6. `server.close()` + `closeAllConnections()`
7. `optimizeDatabases(db)` — 执行 PRAGMA optimize
8. `closeDatabases(db)` — 关闭 4 个 SQLite 连接
9. `process.exit(0)`

---

## WebSocket 实现：`src/server/ws.js`

### 设计思路

完整的 WebSocket 协议自实现，包括：
- **握手**：SHA1 + Base64 accept key 计算
- **帧解析**：支持 7bit / 16bit / 64bit 长度，mask 解码
- **帧编码**：支持 3 种长度编码等级
- **控制帧**：支持 Close (0x8) 和 Ping/Pong (0x9/0xA)

### 数据帧格式（编码时）

```
[FIN+opcode] [MASK+length] [extended length] [payload]
     1B            1B           0-8B              N bytes
```

- opcode 0x1 = 文本帧（JSON）
- MASK 位始终为 0（服务器→客户端不 mask）
- 长度 < 126：单字节；< 65536：2 字节扩展；更大：8 字节扩展

### 广播模式

```
状态变更 → broadcastSnapshot(reason)
    → 遍历所有 socket → sendWebSocket(socket, payload)
    → payload = JSON.stringify({ type: 'snapshot', reason, state })
```

**reason** 用于前端区分更新来源：
- `'bilibili:danmaku'` — 弹幕点歌
- `'bilibili:superchat'` — SC 点歌
- `'bilibili:gift'` — 礼物记录
- `'live:status'` — 直播状态变化
- `'connect'` — 新客户端连接

### 状态快照

`getState()` 返回的完整快照：
```javascript
{
  queue,            // 当前点歌队列
  superChats,       // 醒目留言列表
  gifts,            // 礼物统计
  giftSprint,       // 礼物冲刺状态
  settings,         // 所有设置
  categories,       // 歌曲分类
  songCount,        // 歌库歌曲总数
  liveStatus,       // Bilibili 连接状态
  bilibiliDiagnostics // 弹幕诊断信息
}
```

> **架构要点**：每次状态变更都推送**完整快照**而非增量更新。这简化了前端状态同步（直接用快照替换本地状态），代价是带宽消耗。对于点歌助手的数据量（队列 < 500 条，SC < 200 条），这个开销很小。

---

## 路由系统：`src/server/api-routes.js`

### 路由注册

每个路由文件导出 `{ prefixes, routes }`：
- `prefixes`：URL 前缀数组（如 `['/api/songs']`）
- `routes`：以 `"METHOD /subpath"` 为 key 的处理器映射

### 路由解析流程

```
/api/songs/list?category=默认
         │
         ├─ 匹配 prefix: "/api/songs"
         ├─ 剩余路径: "/list"
         ├─ 查找 routes["GET /list"]
         ├─ 找到 → 调用 handler(apiContext, req, res, searchParams, body)
         ├─ 未找到 → 405（方法存在但不对）或 404（路径不存在）
         └─ 始终返回 JSON
```

### 现有路由清单（12 个模块）

| 路由模块 | 前缀 | 功能 |
|----------|------|------|
| `song-routes.js` | `/api/songs` | 歌曲 CRUD、分类、导入 |
| `queue-routes.js` | `/api/queue` | 队列管理（添加、置顶、删除、完成） |
| `superchat-routes.js` | `/api/superchat` | SC 列表、状态变更 |
| `gift-routes.js` | `/api/gifts` | 礼物历史、冲刺、盲盒 |
| `music-routes.js` | `/api/music` | 音乐搜索、歌词、播放 URL |
| `playback-routes.js` | `/api/playback` | 播放器状态、收藏、歌单 |
| `settings-routes.js` | `/api/settings` | 设置读写 |
| `theme-routes.js` | `/api/theme` | 主题预设 CRUD |
| `bilibili-routes.js` | `/api/bilibili` | 直播监听配置 |
| `system-routes.js` | `/api/system` | 健康检查、状态、关闭 |
| `data-routes.js` | `/api/data` | 数据清空、保留策略 |
| `debug-routes.js` | `/api/debug` | 礼物消息调试 |

---

## HTTP 工具：`src/server/http-utils.js`

### JSON 响应

```javascript
sendJson(res, 200, { ok: true, data: [...] })
// → Content-Type: application/json; charset=utf-8
// → CORS: Access-Control-Allow-Origin: *
```

### 静态文件服务

`servePageOrAsset(publicDir, req, res, url)`：
- 无扩展名的路径 → 尝试 `路径.html`，再尝试 `路径/index.html`
- 安全：拒绝 `..` 路径遍历
- MIME 映射：`.html/.css/.js/.json/.png/.svg/.ico/.woff2`
- Cache-Control：`public, max-age=3600`（1 小时）
- ETag/If-None-Match：304 响应支持

### 请求体读取

`readRequestBody(req, maxBytes)`：
- 限制 16MB（MAX_BODY_BYTES）
- 返回 Buffer，由路由层 JSON.parse
- 超限返回 413

---

## 系统指标：`src/server/system-metrics.js`

供 `/api/system` 路由使用，收集：
- 进程内存（RSS / heapTotal / heapUsed）
- 运行时间（process.uptime）
- Node.js 版本
- 数据库大小

---

## 端口与生命周期：`src/server/lifecycle.js`

- `cleanupOwnPortOccupant()`：杀掉占用目标端口的旧进程（Windows `netstat` + `taskkill`）
- `listenWithFallback()`：从 startPort 开始递增尝试，直到成功监听
- 超时与重试机制：避免竞态条件
