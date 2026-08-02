# 认证与登录系统 — Cookie、加密快照、登录窗口

> 涉及文件：
> - [src/electron/auth-manager.js](src/electron/auth-manager.js) — QQ音乐 + 网易云 Cookie 管理
> - [src/electron/bilibili-auth.js](src/electron/bilibili-auth.js) — Bilibili Cookie 管理
> - [src/electron/login-window.js](src/electron/login-window.js) — 音乐平台登录窗口
> - [src/electron/main.js](src/electron/main.js) — Bilibili 登录窗口（内联）、Cookie 恢复、IPC 处理器
> - [src/electron/preload.js](src/electron/preload.js) — contextBridge 暴露的安全 API

---

## 安全模型

```
渲染进程 (沙箱)
  contextIsolation: true
  nodeIntegration: false
  sandbox: true (登录窗口) / false (主窗口)
      │
      └─ preload.js → contextBridge
          ├─ window.songAssistantDesktop (窗口/更新IPC)
          ├─ window.musicAPI (音乐登录IPC)
          └─ window.bilibiliAuth (Bilibili登录IPC)
```

---

## Chromium 分区（Partition）

每个平台使用独立的持久化分区，Cookie 互不干扰：

| 平台 | 分区名 | 磁盘路径 |
|------|--------|----------|
| QQ音乐 | `persist:music-qq` | `{userData}/Partitions/music-qq/` |
| 网易云 | `persist:music-netease` | `{userData}/Partitions/music-netease/` |
| Bilibili | `persist:bilibili` | `{userData}/Partitions/bilibili/` |

---

## 登录 URL

| 平台 | URL |
|------|-----|
| QQ音乐 | `https://y.qq.com/` |
| 网易云 | `https://music.163.com/` |
| Bilibili | `https://live.bilibili.com/` |

---

## Cookie 域名过滤

只有匹配允许域名的 Cookie 才会被保存/恢复/导出。

### QQ音乐

```
允许 Cookie 域名: .qq.com, .y.qq.com, y.qq.com
关键 Cookie: uin, qqmusic_uin, qqmusic_key, qm_keyst, p_skey, skey, wxuin, p_uin, pt2gguin, superuin
认证 Cookie (决定登录态): qqmusic_key, qm_keyst
```

### 网易云

```
允许 Cookie 域名: .163.com, .music.163.com, music.163.com
关键 Cookie: MUSIC_U, __csrf
认证 Cookie: 回退到 keyCookies (MUSIC_U, __csrf)
```

### Bilibili

```
允许 Cookie 域名: .bilibili.com, bilibili.com, .live.bilibili.com, live.bilibili.com
关键 Cookie: DedeUserID, SESSDATA, bili_jct
登录判断: 三者全部存在 → loggedIn (比音乐平台更严格)
```

---

## 登录窗口

### 通用模式

```
1. 创建 BrowserWindow
   - 指定 partition (隔离 Cookie)
   - sandbox: true, contextIsolation: true, nodeIntegration: false, 无 preload
   - 拒绝所有权限请求 (setPermissionRequestHandler → false)

2. 加载登录 URL

3. 导航安全:
   - 允许的 host → loginWindow.loadURL() (在原窗口内)
   - 不允许 → shell.openExternal() (系统浏览器)
   - 始终返回 { action: 'deny' }

4. Cookie 监听:
   - loginSession.cookies.on('changed', onCookieChanged)
   - 800ms 防抖 → persistCookieSnapshot()
   - 每次变更 → checkLoginComplete()

5. 登录完成检测:
   - 主路径: cookie change 事件 → getAuthState() → loggedIn → 自动关闭
   - 安全网: setInterval(checkLoginComplete, 1500ms)

6. 窗口关闭:
   - 清除定时器
   - 移除 Cookie 监听器
   - 最终强制 persistCookieSnapshot()
   - resolve promise → { snapshot, state }
```

### 允许的登录导航域名

**QQ音乐:**
`y.qq.com`, `i.y.qq.com`, `graph.qq.com`, `ssl.ptlogin2.qq.com`, `xui.ptlogin2.qq.com`, `ui.ptlogin2.qq.com`, `ptlogin2.qq.com`, `qq.com`

**网易云:**
`music.163.com`, `interface.music.163.com`, `interface3.music.163.com`, `passport.163.com`, `reg.163.com`, `163.com`

**Bilibili:**
`bilibili.com`, `www.bilibili.com`, `live.bilibili.com`, `passport.bilibili.com`, `api.bilibili.com`, `api.live.bilibili.com`, `space.bilibili.com`, `message.bilibili.com`, `member.bilibili.com`, `account.bilibili.com`

> 匹配方式: `host === allowed || host.endsWith('.' + allowed)` — 子域名通配

---

## Cookie 快照加密

### 持久化流程

```
persistCookieSnapshot(platform, dataDir):
  1. 从分区读取所有允许的 Cookie
     session.fromPartition(partition).cookies.get({})
     过滤: 域名匹配允许列表

  2. 构建 payload:
     { platform, savedAt: ISO时间, cookies: [...] }
     cookies 字段: name, value, domain, path('/'), secure, httpOnly, expirationDate

  3. 安全门: safeStorage.isEncryptionAvailable() === false → 抛异常
     (绝不写入明文快照)

  4. safeStorage.encryptString(JSON.stringify(payload))
     → Windows 上使用 DPAPI (每用户/每机器绑定)
     → 输出 Buffer

  5. 写入文件:
     fs.writeFileSync(path, encrypted.toString('base64'), 'utf8')
     存储为 base64 编码的 UTF-8 文本

  6. 返回 { savedAt, cookieCount }
```

### 快照文件路径

| 平台 | 文件 |
|------|------|
| QQ音乐 | `{userData}/music-auth/qq.cookies.enc` |
| 网易云 | `{userData}/music-auth/netease.cookies.enc` |
| Bilibili | `{userData}/bilibili-auth/cookies.enc` |
| Bilibili 明文导出 | `{userData}/bilibili-auth/cookies.txt` ⚠️ |

> ⚠️ `cookies.txt` 是 Bilibili 专用的明文 Cookie header 字符串，供脚本工具使用（如 `capture-gifts.js`）。包含完整 `SESSDATA`、`bili_jct`。

### 恢复流程

```
restoreCookieSnapshot(platform, dataDir):
  1. 快照文件不存在 → return null
  2. safeStorage 不可用 → return null
  3. Buffer.from(fs.readFileSync(path, 'utf8'), 'base64')
     → safeStorage.decryptString() → JSON.parse
  4. 逐个 cookie: loginSession.cookies.set(toElectronCookieDetails(cookie))
  5. 异常 → 吞噬, return null
```

### Electron Cookie 详情转换

```javascript
toElectronCookieDetails(cookie):
  domain: cookie.domain (保留前导点)
  path: cookie.path || '/'
  secure: cookie.secure !== false
  httpOnly: cookie.httpOnly !== false
  url: `${protocol}://${domain.replace(/^\./, '')}${path}`
  expirationDate: 仅当 Number.isFinite 时设置
    // 会话 Cookie 没有 expirationDate → 恢复后仍是会话 Cookie
    // → 重启后可能丢失
```

---

## 启动时 Cookie 恢复

```
startDesktopApp() 中的恢复流程:

1. await restoreMusicCookieSnapshots()
   - 按顺序恢复: qq → netease
   - 遍历 MUSIC_LOGIN_CONFIG 的 keys

2. await restoreBilibiliCookieSnapshot()

3. 然后才启动 HTTP 服务器
   → Provider 启动时就能读取到 Cookie

执行时机: 在主窗口创建之前
         在服务器启动之前
         所以第一个 API 调用就已经有 Cookie
```

---

## 登出

```
logoutMusicAccount(platform, dataDir) / logoutBilibiliAccount(dataDir):
  1. loginSession.clearStorageData({
       storages: ['cookies', 'localstorage', 'indexdb', 'websql']
     })
  2. 删除 .enc 快照文件
  3. Bilibili 额外: 删除 cookies.txt
  4. 返回最新 auth state
```

---

## 登录态判断

### 音乐平台

```javascript
getMusicAuthState(platform, dataDir):
  cookieNames = session 中所有匹配域名的 Cookie 名称集合
  presentKeyCookies = keyCookies ∩ cookieNames
  loggedIn = authCookies 中任意一个存在于 cookieNames
    // QQ: qqmusic_key 或 qm_keyst 任意一个
    // 网易云: 回退到 keyCookies (MUSIC_U 或 __csrf 任意一个)

返回:
  { platform, name, loggedIn, cookieCount, keyCookieNames,
    encryptedSnapshotExists, lastSavedAt, encryptionAvailable }
```

### Bilibili

```javascript
getBilibiliAuthState(dataDir):
  loggedIn = DedeUserID && SESSDATA && bili_jct 三者全部存在  // 更严格
  uid = Number(DedeUserID.value) || 0
  hasSessdata = SESSDATA 是否存在

返回:
  { name, loggedIn, uid, cookieCount, keyCookieNames, hasSessdata,
    encryptedSnapshotExists, lastSavedAt, encryptionAvailable,
    exportedCookieExists }
```

---

## Cookie → API 请求头

```javascript
getMusicCookieHeader(platform):
  // 从分区读取所有允许的 Cookie
  // 拼接为: "name1=value1; name2=value2; ..."
  // 非空 name+value 的 Cookie 才包含

getBilibiliCookieHeader() / getBilibiliUid():
  // 同上, 分别返回 Cookie 字符串和 uid 数字
```

---

## 服务器端的 Cookie 注入

```
main.js → serverModule.startServer({
  musicAuth: {
    getAuthState: (platform) => authMgr.getMusicAuthState(platform, dataDir),
    getCookieHeader: (platform) => authMgr.getMusicCookieHeader(platform)
  },
  bilibiliAuth: {
    getAuthState: () => bilibiliAuth.getBilibiliAuthState(dataDir),
    getCookieHeader: () => bilibiliAuth.getBilibiliCookieHeader(),
    getUid: () => bilibiliAuth.getBilibiliUid()
  }
})

server.js → createMusicProviderRegistry({ getAuthState, getCookieHeader })
         → qq/netease Provider 持有回调引用
         → 每次 API 调用时 getSafeCookieHeader() → 实时读取分区 Cookie

server.js → refreshBilibiliAuthCache()
         → 缓存 cookieHeader + uid 到同步变量
         → BilibiliDanmakuClient 构造时传入
         → 用于 WebSocket 连接的 Cookie 和 API 请求
```

---

## 请求头注入（webRequest）

Chromium 层自动注入 Referer/Origin，防止第三方 API 因缺乏请求头被拒：

```
*.music.163.com, *.music.126.net:
  → Referer: https://music.163.com/

*.qqmusic.qq.com, *.gtimg.cn, *.y.qq.com:
  → Referer: https://y.qq.com/
  → Origin: https://y.qq.com

*.bilibili.com, *.hdslb.com:
  → Referer: https://www.bilibili.com/
  → Origin: https://www.bilibili.com
```

---

## userData 目录结构

```
{安装目录}/data/              ← app.setPath('userData', ...)
├── Partitions/
│   ├── music-qq/             ← QQ音乐 persist: 分区
│   ├── music-netease/        ← 网易云 persist: 分区
│   └── bilibili/             ← Bilibili persist: 分区
├── music-auth/
│   ├── qq.cookies.enc        ← DPAPI 加密的 QQ Cookie 快照
│   └── netease.cookies.enc   ← DPAPI 加密的网易云 Cookie 快照
├── bilibili-auth/
│   ├── cookies.enc           ← DPAPI 加密的 Bilibili Cookie 快照
│   └── cookies.txt           ← ⚠️ 明文 Bilibili Cookie header
├── song-request-data.db      ← 点歌主库
├── super-chat-data.db        ← SC 库
├── gift-data.db              ← 礼物库
└── music-data.db             ← 播放器库

{安装目录}/logs/
└── desktop.log               ← 运行日志
```

> 打包版 userData 在安装目录下的 `data/`，卸载时一并删除。
> 开发版 userData 在项目根目录的 `data/`。

---

## 旧数据迁移

```
migrateUserDataFromAppData():
  旧路径: %APPDATA%/点歌助手/Partitions/
  新路径: {userData}/Partitions/
  条件: 旧路径存在 且 新路径不存在
  操作: fs.cpSync(oldPartitions, newPartitions, { recursive: true })
  失败: 非致命, 记录日志
  执行时机: startDesktopApp() 的第一步
```

---

## 安全要点

| 项目 | 说明 |
|------|------|
| 快照加密 | `safeStorage` (DPAPI on Windows)，绝不写入明文（除 Bilibili cookies.txt 外） |
| 解密失败 | 吞噬异常 → `return null`，当作未登录 |
| 登录窗口沙箱 | sandbox:true, contextIsolation:true, 无 preload, 所有权限拒绝 |
| 导航限制 | 仅允许列表内的 host，其他跳系统浏览器 |
| 子域名通配 | `host.endsWith('.qq.com')` 接受所有子域名 |
| 会话 Cookie | 无 expirationDate 的 Cookie 恢复后仍是会话 Cookie，重启可能丢失 |
| 登录判断差异 | QQ/网易云: 任意认证 Cookie 即 loggedIn；Bilibili: 必须三者全有 |
| 明文风险 | Bilibili cookies.txt 存有完整 SESSDATA + bili_jct，设计如此 |
