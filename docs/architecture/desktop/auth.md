# 登录与会话:Cookie 分区、加密快照与注入契约

> 涉及文件:[src/electron/auth-manager.js](../../../src/electron/auth-manager.js)、[src/electron/bilibili-auth.js](../../../src/electron/bilibili-auth.js)、[src/electron/login-window.js](../../../src/electron/login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)、[src/electron/main.js](../../../src/electron/main.js)(恢复时序与注入)

本文档是登录会话的**唯一事实源**:分区模型、登录 URL、Cookie 域名与关键 Cookie、快照加密格式、恢复时序、服务器注入契约只在此成表。窗口行为(尺寸/导航/权限)见 [windows.md](windows.md),IPC 通道见 [preload.md](preload.md) §2。

## 1. 分区模型(唯一成表处)

每个平台使用独立 **persist 持久化分区**,Cookie 互不干扰;分区目录落在 userData 下的 `Partitions/`(数据目录树见 [../backend/storage.md](../backend/storage.md) §2):

| 平台 | 分区 | 出处 |
|---|---|---|
| QQ音乐 | `persist:music-qq` | [auth-manager.js:12](../../../src/electron/auth-manager.js#L12) |
| 网易云音乐 | `persist:music-netease` | [auth-manager.js:21](../../../src/electron/auth-manager.js#L21) |
| Bilibili | `persist:bilibili` | [bilibili-auth.js:12](../../../src/electron/bilibili-auth.js#L12) |

> 历史文档曾写 `persist:qqmusic-login` / `persist:bilibili-login`,已纠正。

## 2. 登录 URL(唯一成表处)

| 平台 | 登录 URL | 出处 |
|---|---|---|
| QQ音乐 | `https://y.qq.com/` | [auth-manager.js:13](../../../src/electron/auth-manager.js#L13) |
| 网易云音乐 | `https://music.163.com/` | [auth-manager.js:22](../../../src/electron/auth-manager.js#L22) |
| Bilibili | `https://live.bilibili.com/` | [bilibili-auth.js:13](../../../src/electron/bilibili-auth.js#L13) |

> 历史文档曾把 Bilibili 登录 URL 误写为 passport 子域下的 `/login` 页面,已纠正。`passport` 子域仍在**允许导航域名**清单内(§3),登录窗口内的实际跳转不受影响。

## 3. 平台配置与 Cookie 过滤

平台配置(来源 [auth-manager.js:9-27](../../../src/electron/auth-manager.js#L9-L27)、[bilibili-auth.js:10-22](../../../src/electron/bilibili-auth.js#L10-L22)),**唯一成表处**:

| 平台 | 允许 Cookie 域名 | 关键 Cookie(keyCookies) | 认证 Cookie(authCookies) |
|---|---|---|---|
| QQ音乐 | `.qq.com`、`.y.qq.com`、`y.qq.com` | `uin`、`qqmusic_uin`、`qqmusic_key`、`qm_keyst`、`p_skey`、`skey`、`wxuin`、`p_uin`、`pt2gguin`、`superuin` | `qqmusic_key`、`qm_keyst` |
| 网易云 | `.163.com`、`.music.163.com`、`music.163.com` | `MUSIC_U`、`__csrf` | 缺省 → 回退 keyCookies |
| Bilibili | `.bilibili.com`、`bilibili.com`、`.live.bilibili.com`、`live.bilibili.com` | `DedeUserID`、`SESSDATA`、`bili_jct` | 三者缺一不可(§4) |

Cookie 域名匹配(`isAllowedMusicCookie`/`isAllowedBilibiliCookie`):`domain === allowed` 或 `domain === hostAllowed`(剥离前导点)或 `domain.endsWith('.' + hostAllowed)` — 子域名通配([auth-manager.js:45-53](../../../src/electron/auth-manager.js#L45-L53)、[bilibili-auth.js:36-44](../../../src/electron/bilibili-auth.js#L36-L44))。

**允许导航域名**(登录窗内跳转/外链判定,见 [windows.md](windows.md) §2-§3):

| 平台 | allowedHosts |
|---|---|
| QQ音乐 | `y.qq.com`、`i.y.qq.com`、`graph.qq.com`、`ssl.ptlogin2.qq.com`、`xui.ptlogin2.qq.com`、`ui.ptlogin2.qq.com`、`ptlogin2.qq.com`、`qq.com` |
| 网易云 | `music.163.com`、`interface.music.163.com`、`interface3.music.163.com`、`passport.163.com`、`reg.163.com`、`163.com` |
| Bilibili | `bilibili.com`、`www.bilibili.com`、`live.bilibili.com`,以及 passport、`api.bilibili.com`、`api.live.bilibili.com`、`space.bilibili.com`、`message.bilibili.com`、`member.bilibili.com`、`account.bilibili.com` 子域(完整清单见 [bilibili-auth.js:14-19](../../../src/electron/bilibili-auth.js#L14-L19)) |

匹配方式 `host === allowed || host.endsWith('.' + allowed)`,仅接受 `https:`/`http:`([auth-manager.js:55-64](../../../src/electron/auth-manager.js#L55-L64)、[bilibili-auth.js:46-55](../../../src/electron/bilibili-auth.js#L46-L55))。

## 4. 登录态判断

- **音乐平台** `getMusicAuthState(platform, dataDir)`([auth-manager.js:126-153](../../../src/electron/auth-manager.js#L126-L153)):`loggedIn = authCookies 中任一存在`(QQ 即 `qqmusic_key` 或 `qm_keyst` 之一;网易云回退到 keyCookies,即 `MUSIC_U` 或 `__csrf` 之一)。
- **Bilibili** `getBilibiliAuthState(dataDir)`([bilibili-auth.js:127-163](../../../src/electron/bilibili-auth.js#L127-L163)):**`DedeUserID`、`SESSDATA`、`bili_jct` 三者全部存在**才 `loggedIn`(比音乐平台严格);`uid = Number(DedeUserID.value) || 0`,并单独标记 `hasSessdata`。

返回结构:音乐 `{platform, name, loggedIn, cookieCount, keyCookieNames, encryptedSnapshotExists, lastSavedAt, encryptionAvailable}`;Bilibili 追加 `uid`、`hasSessdata`、`exportedCookieExists`。

## 5. Cookie 快照加密(唯一成文处)

### 5.1 持久化

`persistMusicCookieSnapshot(platform, dataDir)`([auth-manager.js:95-108](../../../src/electron/auth-manager.js#L95-L108)) / `persistBilibiliCookieSnapshot(dataDir)`([bilibili-auth.js:86-109](../../../src/electron/bilibili-auth.js#L86-L109)):

1. 从平台分区读取全部 Cookie,按 §3 域名清单过滤
2. 构建 payload `{platform?, savedAt: ISO时间, cookies:[{name, value, domain, path:'/', secure, httpOnly, expirationDate}]}`(`toSerializableCookie`,secure/httpOnly 语义化布尔)
3. **安全门**:`safeStorage.isEncryptionAvailable() === false` → **抛异常,绝不写明文快照**(分区内 Cookie 保留)
4. `safeStorage.encryptString(JSON.stringify(payload))` — Windows 上后端为 **DPAPI**(每用户/每机器绑定)
5. `encrypted.toString('base64')` 以 UTF-8 文本写入快照文件

| 平台 | 快照文件 | 出处 |
|---|---|---|
| QQ音乐 | `data/music-auth/qq.cookies.enc` | [auth-manager.js:41-43](../../../src/electron/auth-manager.js#L41-L43) |
| 网易云 | `data/music-auth/netease.cookies.enc` | 同上 |
| Bilibili | `data/bilibili-auth/cookies.enc` | [bilibili-auth.js:28-30](../../../src/electron/bilibili-auth.js#L28-L30) |

### 5.2 恢复

`restoreMusicCookieSnapshot`([auth-manager.js:110-124](../../../src/electron/auth-manager.js#L110-L124)) / `restoreBilibiliCookieSnapshot`([bilibili-auth.js:111-125](../../../src/electron/bilibili-auth.js#L111-L125)):快照文件不存在 → `null`;`safeStorage` 不可用 → `null`;解密/解析失败 → 吞噬异常返回 `null`(当作未登录)。成功则逐条 `cookies.set(toElectronCookieDetails(cookie))` 写回分区。

`toElectronCookieDetails`([auth-manager.js:80-93](../../../src/electron/auth-manager.js#L80-L93)):`url` 由 `protocol(secure?https:http)://domain(去前导点)+path` 组装,写入时保留 `domain` 前导点;`expirationDate` 仅 `Number.isFinite` 时设置 — **会话 Cookie(无过期时间)恢复后仍是会话 Cookie,重启后可能丢失**。

## 6. Bilibili 明文导出

`persistBilibiliCookieSnapshot` 在加密快照之外,当 `data/bilibili-auth/cookies.txt` 已存在**或**环境变量 `BILIBILI_PLAINTEXT_COOKIE_EXPORT === '1'` 时,写入明文 Cookie header 字符串(`name=value; ...`)([bilibili-auth.js:99-106](../../../src/electron/bilibili-auth.js#L99-L106))。**设计如此**:供外部脚本(如 capture-gifts.js)读取完整 `SESSDATA`/`bili_jct`;登出时一并删除([bilibili-auth.js:185-186](../../../src/electron/bilibili-auth.js#L185-L186))。

## 7. 登出

`logoutMusicAccount(platform, dataDir)`([auth-manager.js:163-169](../../../src/electron/auth-manager.js#L163-L169)) / `logoutBilibiliAccount(dataDir)`([bilibili-auth.js:179-188](../../../src/electron/bilibili-auth.js#L179-L188)):

1. 平台分区 `clearStorageData({storages:['cookies','localstorage','indexdb','websql']})`
2. 删除 `.enc` 快照文件
3. Bilibili 额外删除 `cookies.txt`
4. 返回最新 auth state

## 8. 会话恢复时序

`startDesktopApp` 中,快照恢复**先于服务器启动**(保证 provider 首次 API 调用就带 Cookie,见 [main.md](main.md) §2):

```
restoreMusicCookieSnapshots()    # Object.keys(MUSIC_LOGIN_CONFIG) → qq → netease 顺序  [main.js:637-642]
  └─ restoreBilibiliCookieSnapshot()                                                       [main.js:613-615]
      └─ desktopRuntime.start(serverOptions) → 内嵌 HTTP 服务启动                          [main.js:120-139]
```

顺序事实:qq 先于 netease;音乐整体先于 Bilibili;全部先于服务器启动与主窗口创建(出处 [main.js:117-141](../../../src/electron/main.js#L117-L141))。

## 9. 登录完成检测与窗口时序

检测语义(窗口行为见 [windows.md](windows.md) §2-§3):

| 机制 | 说明 | 出处 |
|---|---|---|
| cookie change 主路径 | 每次 `cookies.on('changed')` 立即 `getAuthState()` 判定登录完成,并触发 800ms 防抖快照落盘 | [login-window.js:63-68](../../../src/electron/login-window.js#L63-L68) |
| 1.5s 轮询安全网 | `setInterval(checkLoginComplete, 1500)` 兜底(防止漏掉 cookie 事件) | [login-window.js:73](../../../src/electron/login-window.js#L73) |
| 自动关闭 | 检测到 `loggedIn` → 登录窗自动 `close()` | [login-window.js:52-61](../../../src/electron/login-window.js#L52-L61) |
| 最终快照 | 窗口 `closed` 时强制 persist 一次,随 promise resolve `{snapshot, state}` | [login-window.js:75-89](../../../src/electron/login-window.js#L75-L89) |

Bilibili 同构,另带 `loginCheckInFlight`/`loginCloseRequested` 防重入(见 [windows.md](windows.md) §3)。

## 10. Cookie → API 请求头

`getMusicCookieHeader(platform)`([auth-manager.js:155-161](../../../src/electron/auth-manager.js#L155-L161)) / `getBilibiliCookieHeader()`([bilibili-auth.js:165-171](../../../src/electron/bilibili-auth.js#L165-L171)):实时从平台分区读取允许域名内的全部 Cookie,过滤空 name/value 后拼接 `"name1=value1; name2=value2; ..."`。`getBilibiliUid()`([bilibili-auth.js:173-177](../../../src/electron/bilibili-auth.js#L173-L177)):返回 `DedeUserID` 数值。

消费方:

| 消费者 | 数据 | 文档 |
|---|---|---|
| 音乐 Provider 注册表(`createMusicProviderRegistry` 注入 `getAuthState/getCookieHeader`) | 每次 API 调用实时取 Cookie 头 | [../backend/music/services.md](../backend/music/services.md) |
| Bilibili 弹幕/API 客户端 | `refreshBilibiliAuthCache` 缓存 cookieHeader + uid,供 WS 握手与 API 请求 | [../backend/bilibili/protocol.md](../backend/bilibili/protocol.md) |

## 11. 服务器注入契约

Electron main 以适配器形式把 auth 能力注入 `desktopRuntime.start`(服务器端契约见 [../backend/server-core.md](../backend/server-core.md) §5):

```js
desktopRuntime.start({
  host: process.env.HOST || '127.0.0.1',
  startPort: 3000,
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
```

出处 [main.js:120-132](../../../src/electron/main.js#L120-L132)。独立 Web 模式无 safeStorage/Cookie 注入,降级认证(见 [server-core.md](../backend/server-core.md) §1)。

## 12. 安全要点

| 项目 | 说明 | 出处 |
|---|---|---|
| 快照加密 | safeStorage(Windows 上 DPAPI);`isEncryptionAvailable()===false` 时 persist 抛异常、restore 返回 null、auth state 报告 `encryptionAvailable:false` | [auth-manager.js:99-101](../../../src/electron/auth-manager.js#L99-L101)、[auth-manager.js:113](../../../src/electron/auth-manager.js#L113) |
| 登录窗 | sandbox:true、contextIsolation:true、无 preload、权限请求全拒 | [windows.md](windows.md) §2 |
| 导航限制 | 仅 allowedHosts 内导航,其余交系统浏览器 | §3 |
| 子域名通配 | 剥离前导点后 `endsWith('.host')` 接受所有子域名 | §3 |
| 会话 Cookie | 无 expirationDate 的 Cookie 恢复后仍是会话 Cookie,重启可能丢失 | §5.2 |
| 判定差异 | QQ/网易云:任一认证 Cookie 即已登录;Bilibili:三键全有 | §4 |
| 明文风险 | cookies.txt 存有完整 SESSDATA + bili_jct,设计如此 | §6 |
