# 登录与会话：Cookie 分区、加密快照与注入契约

> 涉及文件：[src/electron/music-auth-manager.js](../../../src/electron/music-auth-manager.js)、[src/electron/bilibili-auth.js](../../../src/electron/bilibili-auth.js)、[src/electron/music-login-window.js](../../../src/electron/music-login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)、[src/electron/main.js](../../../src/electron/main.js)（恢复时序与注入）

本文档是登录会话的**单一事实来源**，集中维护分区模型、登录地址、Cookie 域名与关键 Cookie、快照加密格式、恢复时序和服务端注入契约。辅助窗口行为（尺寸/导航/权限）见 [windows.md](windows.md)，IPC 通道见 [preload.md](preload.md) §2。

## 1. 分区模型

本节及下文的音乐和直播登录规则保持兼容；动态抽奖专用账号使用独立分区和持久化规则（见 §14），不复用直播登录。

各平台使用独立的持久化分区（`persist:`），Cookie 互不干扰。分区目录位于 Chromium `userData` 下的 `Partitions/`，与业务数据目录 `dataDir` 分离；旧版分区会在应用 `ready` 前整体迁移，加密认证快照仍保留在原业务目录中（目录结构见 [../backend/storage.md](../backend/storage.md) §2）：

| 平台 | 分区 | 出处 |
| --- | --- | --- |
| QQ 音乐 | `persist:music-qq` | [music-auth-manager.js:12](../../../src/electron/music-auth-manager.js#L12) |
| 网易云音乐 | `persist:music-netease` | [music-auth-manager.js:21](../../../src/electron/music-auth-manager.js#L21) |
| Bilibili | `persist:bilibili` | [bilibili-auth.js:12](../../../src/electron/bilibili-auth.js#L12) |

> 历史文档曾写 `persist:qqmusic-login` / `persist:bilibili-login`，已纠正。

## 2. 登录 URL

| 平台 | 登录 URL | 出处 |
| --- | --- | --- |
| QQ 音乐 | `https://y.qq.com/` | [music-auth-manager.js:13](../../../src/electron/music-auth-manager.js#L13) |
| 网易云音乐 | `https://music.163.com/` | [music-auth-manager.js:22](../../../src/electron/music-auth-manager.js#L22) |
| Bilibili | `https://live.bilibili.com/` | [bilibili-auth.js:13](../../../src/electron/bilibili-auth.js#L13) |

> 历史文档曾把 Bilibili 登录 URL 误写为 passport 子域下的 `/login` 页面，已纠正。`passport` 子域仍在**允许导航域名**清单内（§3），登录窗口内的实际跳转不受影响。

## 3. 平台配置与 Cookie 过滤

音乐登录与认证模块会先调用 `normalizeMusicPlatform` 校验平台标识（只查配置对象的自有属性），仅接受 `qq` 或 `netease`（忽略首尾空格和大小写）。在创建 `BrowserWindow`、获取 `session` 或读写快照前，就会拒绝 `constructor`、`__proto__` 等原型链属性，且绝不回退到默认 `session`。

平台配置（来源 [music-auth-manager.js:9-27](../../../src/electron/music-auth-manager.js#L9-L27)、[bilibili-auth.js:10-22](../../../src/electron/bilibili-auth.js#L10-L22)）：

| 平台 | 允许 Cookie 域名 | 关键 Cookie（`keyCookies`） | 认证 Cookie（`authCookies`） |
| --- | --- | --- | --- |
| QQ 音乐 | `.qq.com`、`.y.qq.com`、`y.qq.com` | `uin`、`qqmusic_uin`、`qqmusic_key`、`qm_keyst`、`p_skey`、`skey`、`wxuin`、`p_uin`、`pt2gguin`、`superuin` | `qqmusic_key`、`qm_keyst`（任一非空） |
| 网易云 | `.163.com`、`.music.163.com`、`music.163.com` | `MUSIC_U`、`__csrf` | `MUSIC_U`（非空） |
| Bilibili | `.bilibili.com`、`bilibili.com`、`.live.bilibili.com`、`live.bilibili.com` | `DedeUserID`、`SESSDATA`、`bili_jct` | 三者缺一不可（§4） |

Cookie 域名匹配（`isAllowedMusicCookie` / `isAllowedBilibiliCookie`）：`domain === allowed`、`domain === hostAllowed`（剥离前导点）或 `domain.endsWith('.' + hostAllowed)`，支持子域名通配（[music-auth-manager.js:45-53](../../../src/electron/music-auth-manager.js#L45-L53)、[bilibili-auth.js:36-44](../../../src/electron/bilibili-auth.js#L36-L44)）。

**允许导航域名**（登录窗内跳转与外链判定，见 [windows.md](windows.md) §1–§2）：

| 平台 | `allowedHosts` |
| --- | --- |
| QQ 音乐 | `y.qq.com`、`i.y.qq.com`、`graph.qq.com`、`ssl.ptlogin2.qq.com`、`xui.ptlogin2.qq.com`、`ui.ptlogin2.qq.com`、`ptlogin2.qq.com`、`qq.com` |
| 网易云 | `music.163.com`、`interface.music.163.com`、`interface3.music.163.com`、`passport.163.com`、`reg.163.com`、`163.com` |
| Bilibili | `bilibili.com`、`www.bilibili.com`、`live.bilibili.com`，以及 `passport`、`api.bilibili.com`、`api.live.bilibili.com`、`space.bilibili.com`、`message.bilibili.com`、`member.bilibili.com`、`account.bilibili.com` 子域（完整清单见 [bilibili-auth.js:14-19](../../../src/electron/bilibili-auth.js#L14-L19)） |

匹配方式为 `host === allowed || host.endsWith('.' + allowed)`，仅接受 `https:`；音乐与 B 站登录窗口共用 [external-url-policy.js](../../../src/electron/external-url-policy.js) 的 `isAllowedLoginNavigation` 域名及协议校验。

## 4. 登录态判断

- **音乐平台** `getMusicAuthState(platform, dataDir)`（[music-auth-manager.js](../../../src/electron/music-auth-manager.js)）：`loggedIn = authCookies 中任一 Cookie 值非空`（QQ 仅看 `qqmusic_key`、`qm_keyst` 之一；`p_skey` / `skey` 虽保留在 `keyCookies` 中供 QQ Provider 的 GTK/Web 回退使用，但不单独判定登录成功；网易云仅看 `MUSIC_U`，辅助 Cookie `__csrf` 保留用于请求，但不单独完成登录）。
- **Bilibili** `getBilibiliAuthState(dataDir)`（[bilibili-auth.js:127-163](../../../src/electron/bilibili-auth.js#L127-L163)）：**`DedeUserID`、`SESSDATA`、`bili_jct` 三者全部存在**才判定为 `loggedIn`（比音乐平台严格）；`uid = Number(DedeUserID.value) || 0`，并单独标记 `hasSessdata`。

返回结构只包含登录态与快照元数据（不含 Cookie 值），完整 IPC 返回 DTO 字段见 [preload.md](preload.md) §2.2。

内部 `getMusicSessionState(platform)` 与 `getBilibiliSessionState()` 每次读取当前 Electron 分区中允许的 Cookie 并应用上述登录判断，只返回会话状态字段，不读取或解密 Cookie 快照。完整 `getMusicAuthState` / `getBilibiliAuthState` 复用该判断后，再补充 `encryptedSnapshotExists`、`lastSavedAt` 和 `encryptionAvailable`。

## 5. Cookie 快照加密

### 5.1 持久化

`persistMusicCookieSnapshot(platform, dataDir)`（[music-auth-manager.js:95-108](../../../src/electron/music-auth-manager.js#L95-L108)） / `persistBilibiliCookieSnapshot(dataDir)`（[bilibili-auth.js:86-109](../../../src/electron/bilibili-auth.js#L86-L109)）：

1. 从平台分区读取全部 Cookie，按 §3 域名清单过滤
2. 通过 `toSerializableCookie` 构造快照对象 `{platform?, savedAt: ISO时间, cookies:[{name, value, domain, path:'/', secure, httpOnly, expirationDate}]}`，并将 `secure`、`httpOnly` 转为布尔值
3. **加密校验**：若 `safeStorage.isEncryptionAvailable() === false`，直接抛出异常，绝不降级写入明文快照（分区内现有 Cookie 保持不动）
4. 调用 `safeStorage.encryptString(JSON.stringify(payload))` 加密（Windows 底层为 **DPAPI**，按当前用户和本机绑定）
5. 将密文转为 Base64（UTF-8 文本），经 [atomic-file.js](../../../src/electron/atomic-file.js) 在同目录独占新建临时文件（权限 `0600`），写入完成后再原子重命名替换旧快照；写入或替换失败时保留原快照并清理临时文件

| 平台 | 快照文件 | 出处 |
| --- | --- | --- |
| QQ 音乐 | `data/music-auth/qq.cookies.enc` | [music-auth-manager.js:41-43](../../../src/electron/music-auth-manager.js#L41-L43) |
| 网易云 | `data/music-auth/netease.cookies.enc` | 同上 |
| Bilibili | `data/bilibili-auth/cookies.enc` | [bilibili-auth.js:28-30](../../../src/electron/bilibili-auth.js#L28-L30) |

### 5.2 恢复

`restoreMusicCookieSnapshot`（[music-auth-manager.js:110-124](../../../src/electron/music-auth-manager.js#L110-L124)） / `restoreBilibiliCookieSnapshot`（[bilibili-auth.js:111-125](../../../src/electron/bilibili-auth.js#L111-L125)）：快照文件不存在或 `safeStorage` 不可用时返回 `null`；解密或解析失败时忽略异常并返回 `null`（按未登录处理）。成功则逐条通过 `cookies.set(toElectronCookieDetails(cookie))` 写回分区。

`toElectronCookieDetails`（[music-auth-manager.js:80-93](../../../src/electron/music-auth-manager.js#L80-L93)）：`url` 由 `protocol(secure ? https : http)://domain(去前导点)+path` 组装，写入时保留 `domain` 前导点；`expirationDate` 仅在 `Number.isFinite` 时设置 — **会话 Cookie（无过期时间）恢复后仍是会话 Cookie，重启后可能丢失**。

## 6. Bilibili 明文导出

完整 Cookie 仅保存在 Electron 持久化分区和 `safeStorage` 加密快照中，不再导出明文。在保存加密快照、启动恢复及退出登出时，会自动删除历史遗留的 `data/bilibili-auth/cookies.txt`，且不读取或迁移其中内容。加密不可用时直接报错，不降级生成明文文件。测试见 [Cookie 存储回归](../../../test/bilibili/bilibili-cookie-storage.test.js)。

## 7. 登出

`logoutMusicAccount(platform, dataDir)`（[music-auth-manager.js:163-169](../../../src/electron/music-auth-manager.js#L163-L169)） / `logoutBilibiliAccount(dataDir)`（[bilibili-auth.js:179-188](../../../src/electron/bilibili-auth.js#L179-L188)）：

1. 清理平台分区存储：`clearStorageData({storages:['cookies','localstorage','indexdb','websql']})`
2. 删除 `.enc` 快照文件
3. Bilibili 额外删除 `cookies.txt`
4. 返回最新认证状态

音乐浏览器缓存清理由 `clearMusicBrowserCache` 负责：依次清除各音乐分区的 HTTP 缓存（`session.clearCache()`）和 CacheStorage（`clearStorageData({storages:['cachestorage']})`），完成后将该平台加入返回的 `cleared` 列表。该操作不会影响登录 Cookie 与加密快照，管理页的「清空歌库及使用记录」通过 `musicAPI.clearCache()` 触发。

### 7.1 登录、退出与替换竞争

[desktop-auth-controller.js](../../../src/electron/desktop-auth-controller.js) 按既有平台分区管理操作顺序：

- 退出、重新登录、云端替换会取消旧登录窗口；先等待窗口关闭及已开始的 Cookie 保存，再清除或替换凭据。
- 恢复、导入、退出按请求顺序串行执行，后一次替换保留完整新账号；交互登录不占住写入队列等待用户，避免阻塞退出。
- 旧登录完成时由代次检查返回 `{cancelled:true,snapshot:null,state:{loggedIn:false}}`，不将云端替换误判为本地登录成功。
- 窗口关闭会等待已触发的 800ms 保存任务；导航失败也等待关闭任务结束。主进程退出先取消并等待这些任务，再关闭后端。

验证见 [真实 Electron 时序测试](../../../test/desktop/desktop-auth-race-electron.test.js) 及 [退出装配测试](../../../test/desktop/electron-shutdown.test.js)。

内部方法 `getBilibiliSessionRevision()` 仅向后端认证适配器只读提供 B 站账号操作代次（由主进程注入为 `getSessionRevision`）。每次账号操作开始时递增代次，使此前已入队的 AI 任务失效；新任务则绑定最新代次和当前 UID。该接口仅供主进程与内嵌后端内部使用，不暴露给渲染进程或 IPC。验证见 [desktop-auth-diagnostics.test.js](../../../test/desktop/desktop-auth-diagnostics.test.js) 和 [AI 会话回归](../../../test/ai/ai-assistant-session.test.js)。

随机点歌通过私有 `getRequestIdentity` / `getIdentityRevision` 注入回调复核真实登录身份：`desktop-auth-controller` 在恢复、导入、退出完成及当前登录窗口的状态读取中记录 UID 与登录状态变化，同账号 Cookie 替换和仅打开登录窗口不推进身份代次。`getBilibiliRequestIdentity()` 等当前非交互写入完成后通过 `getBilibiliSessionState()` 读取当前身份，不读取快照元数据；读取期间账号操作或身份变化则重新读取，避免把 Cookie 替换时的临时空分区误判为退出。窗口内状态读取不等待写队列，旧窗口取消后的读取不再更新身份。随机点歌在异步读取后、入队前检查该代次及独立的房间变化代次，见 [随机点歌 API](../backend/api.md#8-播放队列域queue)。

## 8. 会话恢复时序

`startDesktopApp` 中，快照恢复**先于服务器启动**（保证音乐与弹幕 Provider 首次 API 调用就带 Cookie，见 [main.md](main.md) §2）：

```text
restoreMusicCookieSnapshots()    # Object.keys(MUSIC_LOGIN_CONFIG) → qq → netease 顺序  [main.js:637-642]
  └─ restoreBilibiliCookieSnapshot()                                                    [main.js:613-615]
      └─ desktopRuntime.start(serverOptions) → 内嵌 HTTP 服务启动                        [main.js:120-139]
```

顺序约定：`qq` 先于 `netease`；音乐整体先于 Bilibili；全部先于服务器启动与主窗口创建（出处 [main.js:117-141](../../../src/electron/main.js#L117-L141)）。

## 9. 登录完成检测与窗口时序

检测语义（窗口形态与权限边界见 [windows.md](windows.md) §1–§2）：

| 机制 | 说明 | 出处 |
| --- | --- | --- |
| Cookie 变更主路径 | `cookies.on('changed')` 在没有进行中认证读取时立即读取当前会话状态；重叠事件合并，并触发 800ms 防抖快照落盘 | [music-login-window.js](../../../src/electron/music-login-window.js) |
| 1.5s 轮询兜底 | `setInterval(checkLoginComplete, 1500)` 兜底（防止漏掉 Cookie 事件） | [music-login-window.js:73](../../../src/electron/music-login-window.js#L73) |
| 自动关闭 | 检测到 `loggedIn` 后登录窗自动调用 `close()` | [music-login-window.js:52-61](../../../src/electron/music-login-window.js#L52-L61) |
| 最终快照 | 窗口 `closed` 时强制落盘一次，再读取含快照元数据的完整认证状态，随 Promise 返回 `{snapshot, state}` | [music-login-window.js](../../../src/electron/music-login-window.js) |

音乐与 Bilibili 均由 `loginCheckInFlight` 保证同一窗口最多存在一个进行中的认证检查；读取失败后释放标记，由后续 Cookie 事件或 1.5s 轮询重试。音乐窗口仅记录固定失败诊断，不输出 Cookie 或异常详情。窗口销毁后不再开启检查；最终关闭快照与状态读取保持独立。Bilibili 另带 `loginCloseRequested` 防止重复自动关闭（见 [windows.md](windows.md) §2）。

完成检测分别调用 §4 的 `getMusicSessionState` / `getBilibiliSessionState`，不因检测重复读取或解密备份。Bilibili 通用窗口兼容仅提供 `getBilibiliAuthState` 的注入适配器；抽奖和到期同步的独立账号适配器只读取各自会话，不调用直播账号的完整状态读取。

## 10. Cookie → API 请求头

头像 CDN 代理 `BilibiliApiClient.fetchAvatarImage` 不携带 Bilibili Cookie，保留 HTTPS/`hdslb` 域名、`Referer` 和图片响应检查；其他需要认证的 Bilibili API 请求头保持不变。

`getMusicCookieHeader(platform)`（[music-auth-manager.js:155-161](../../../src/electron/music-auth-manager.js#L155-L161)） / `getBilibiliCookieHeader()`（[bilibili-auth.js:165-171](../../../src/electron/bilibili-auth.js#L165-L171)）：实时从平台分区读取允许域名内的全部 Cookie，过滤空名称或空值后拼接为 `"name1=value1; name2=value2; ..."`。`getBilibiliUid()`（[bilibili-auth.js:173-177](../../../src/electron/bilibili-auth.js#L173-L177)）返回 `DedeUserID` 数值。

`getBilibiliAccountProfile(dataDir)` 先复用上述登录态判定，再用当前 Cookie 调用 `nav` 接口读取登录账号的昵称和头像，并核对返回 UID 与当前 UID 一致；该查询失败时回退到原有用户卡片接口。正常只请求一次，回退时最多两次，各沿用资料查询的 8 秒超时。仅向渲染进程返回 `{uid, name, avatarUrl}`（头像地址经 `hdslb.com` HTTPS 白名单归一化），不返回 Cookie。资料查询独立于登录态 IPC，两条查询均失败时不会阻塞登录窗口完成或改变登录判定，页面继续显示当前 UID。

调用方：

| 调用方 | 数据 | 文档 |
| --- | --- | --- |
| 音乐 Provider 注册表（`createMusicProviderRegistry` 注入 `getAuthState` / `getCookieHeader`） | 每次 API 调用实时获取 Cookie 头 | [../backend/music/services.md](../backend/music/services.md) |
| Bilibili 弹幕/API 客户端 | `refreshBilibiliAuthCache` 缓存 `cookieHeader` + `uid`，供 WS 握手与 API 请求使用 | [../backend/bilibili/protocol.md](../backend/bilibili/protocol.md) |

## 11. 服务器注入契约

Electron 主进程以适配器形式把认证接口注入 `desktopRuntime.start`（服务器端契约见 [../backend/server-core.md](../backend/server-core.md) §5）：

```js
desktopRuntime.start({
  host: process.env.HOST || '127.0.0.1',
  startPort: 3000,
  musicAuth: {
    getAuthState: (platform) => authMgr.getMusicAuthState(platform, dataDir),
    getCookieHeader: (platform) => authMgr.getMusicCookieHeader(platform),
  },
  bilibiliAuth: {
    getAuthState: () => bilibiliAuth.getBilibiliAuthState(dataDir),
    getCookieHeader: () => bilibiliAuth.getBilibiliCookieHeader(),
    getUid: () => bilibiliAuth.getBilibiliUid(),
    getSessionRevision: () => desktopAuth.getBilibiliSessionRevision(),
    getRequestIdentity: () => desktopAuth.getBilibiliRequestIdentity(),
    getIdentityRevision: () => desktopAuth.getBilibiliIdentityRevision(),
  },
});
```

出处：[main.js:120-132](../../../src/electron/main.js#L120-L132)。独立 Node 调试模式无 `safeStorage` 与 Cookie 注入，采用降级认证（见 [server-core.md](../backend/server-core.md) §1）。

### 11.1 本地管理凭据与展示页隔离

[desktop-request-auth.js](../../../src/electron/desktop-request-auth.js) 从仅限主进程调用的 `runtime.getApiToken()` 获取本地管理 Bearer 令牌，并与媒体规则共用唯一的 `session.defaultSession.webRequest.onBeforeSendHeaders` 监听。凭据不进入 HTML、URL、preload 返回值或渲染进程存储；默认调试入口为 `npm run desktop`，匿名浏览器不获得管理权限。

自动附带认证头同时要求当前主窗口的 `webContentsId`、对象和 `session` 精确匹配，发起请求的 frame 必须存在、未被销毁且没有父级 frame，且 `processId` / `frameToken` 与当前 `mainFrame` 一致。已提交文档必须是精确服务源的 `/`、`/admin`、`/settings`、`/songs`，目标仅限同源 `/api/*` 和对应协议的 `/ws`；初始空文档、`about:blank` 和同源 `/license` 只允许引导上述管理 HTML 的 GET/HEAD。登录分区、隐藏导出窗口、子 frame 和旧文档不能借用管理凭据。Electron 会把部分 Worker 请求归到管理 `mainFrame`，frame 校验无法区分它们；因此管理 HTML 强制声明 `worker-src 'none'`，禁止 Dedicated/Blob/Shared/Service Worker 启动。

重定向每一跳都会重新校验，并按请求 ID 剥离先前附加的管理头；请求完成或失败后清除记录。窗口监听由该模块统一绑定和清理；应用进入关闭终结阶段后撤销自动附带认证头的能力，正常关闭仍先完成播放快照冲刷。已卸载文档的 beacon 不放宽认证，桌面退出继续使用既有 IPC 冲刷握手。

展示页 HTML 使用各自独立的专属访问令牌，并强制启用 `CSP: sandbox allow-scripts`，不保留同源身份。三个管理预览 iframe 同时声明该 sandbox；时钟配置与开场音量仅向绑定的 `contentWindow` 以 `postMessage(..., '*')` 发送展示值，子页面校验父窗口和页面 URL 对应的服务源。这样展示脚本无法通过 `parent.fetch` 或父 DOM 借用主框架权限；服务端按展示权限范围校验 `Origin: null` 请求，不会把不透明源（`Origin: null`）本身当作身份凭据。

验证：[desktop-request-auth.test.js](../../../test/desktop/desktop-request-auth.test.js) 与 [desktop-request-auth-electron.test.js](../../../test/desktop/desktop-request-auth-electron.test.js)。后者在 Windows Electron 环境使用临时配置目录和本地测试服务，覆盖管理引导/重载/许可恢复、HTTP/WS/beacon、重定向、不透明源 iframe、四类 Worker 被 CSP 阻止、真实时钟预览、开场音频及带头像和礼物图片的主进程导出截图；主窗口启用 `sandbox: true`，并验证真实 preload 的许可调用和事件订阅，不使用真实用户数据。

## 12. 安全边界总览

各平台登录与本地管理凭据遵循两项总体约束（分项规则见 §1–§6 及 [windows.md](windows.md)）：

- **凭据不出主进程与受控分区**：明文 Cookie 值、DeviceBearer 令牌与设备私钥不进入渲染进程存储、URL、IPC 返回值或日志。
- **默认拒绝（fail-closed）**：任一平台在加密不可用、来源不匹配或身份代次失效时直接拒绝操作，不降级生成明文凭据文件或放宽权限校验。

## 13. 云端 Bilibili 凭据同步边界

远端网页登录成功后的 Cookie 只通过 DeviceBearer 的 `GET /api/device/bilibili-credentials` 返回给 `licenseManager.getBilibiliCredentialsInternal()`；该方法使用不做响应清洗的 `withAuthorizedSecret`，但仅由 [cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js) 在 Electron 主进程内调用，不注册 IPC，也不进入 preload、渲染进程、本地 HTTP、URL 或日志。主播网页端只能获得登录状态、UID、修订号和二维码状态。

云端导入调用 `replaceBilibiliCookieHeader(dataDir, cookieHeader)`：先拒绝空值、超过 12000 字符、CR/LF/NUL、非法 Cookie 名或缺少 `DedeUserID` / `SESSDATA` / `bili_jct` 的请求头；再清空 `persist:bilibili` 的 Cookie / localStorage / IndexedDB / WebSQL，把解析出的 Cookie 写到 `.bilibili.com`，最后立即调用 `persistBilibiliCookieSnapshot` 生成 `safeStorage` 加密快照。云端解绑调用 `logoutBilibiliAccount`，清除分区、加密快照和遗留明文文件。

本地扫码登录和退出由 `cloud-sync-controller.loginBilibili` / `logoutBilibili` 在发起时绑定当前 LIRA 账号和同步生命周期；切换账号或失去授权时会立即取消旧登录窗口，待其落盘结束后再清理残留分区和快照，过期登录结果不会污染新账号的待同步标记（dirty）。登录成功后仍直接从分区读取 Cookie 头上传，不额外保存凭据副本。退出时会先按账号持久化退出意图，再清空本地登录态；若云端 `DELETE` 失败或客户端重启，会持续重试，且在云端确认前禁止重新导入旧云端 Cookie。同一账号后续主动登录成功会覆盖旧退出意图，其他账号不会受其影响（持久格式见 [存储契约](../backend/storage.md#8-云端-scope-的本地落盘)）。应用云端凭据不会触发本地 IPC，也不会引起反向同步。接口传输格式见 [../backend/api.md](../backend/api.md) §0.3，同步调度见 [main.md](main.md) §2.2。

云端读取捕获桌面会话代次，导入/解绑携带仅限主进程的 `isCurrent` 检查。`desktop-auth-controller.js` 在认证队列实际执行前复核会话、账号、同步生命周期及待同步状态；本地登录/退出进行中直接放弃云写入，不取消交互登录。用户操作入队即推进会话代次，旧 GET 或排队导入不能在退出完成后重新写 Cookie 或快照。主动本地操作仍串行执行并保留原结果，未失效的后续云同步可正常恢复。

交互认证收尾后立即为当前授权账号再对账，补上旧登录清理期间被认证队列跳过的云端恢复；该对账不会把旧操作标记为新账号待同步，也不必等待 10 分钟兜底轮询。

## 14. 动态抽奖专用账号

[dynamic-lottery-auth.js](../../../src/electron/dynamic-lottery-auth.js) 是抽奖认证模块；[dynamic-lottery-auth-store.js](../../../src/electron/dynamic-lottery-auth-store.js) 只管理其 Chromium Cookie 与加密快照。入口在桌面「百宝箱 → 动态抽奖」，由主进程授权管理器提供可信服务器源、原始 `streamerId` 与 `getAuthorizationGeneration()` 登录生命周期，不接受渲染进程指定账号作用域。服务器源复用 `normalizeRemoteRootOrigin`；本地命名空间为 `lottery-v2:` 加 `sha256(JSON.stringify([origin, 原始streamerId]))`，覆盖登录、活动、结果、回执及账号预算。抽奖私有 `getIdentity().streamerId` 沿用字段名但承载该命名空间，原账号编号另存 `accountId`，两者均不发送给渲染进程或 B 站。内部 `authorizationEpoch` 保存登录生命周期代次：正常令牌续期保留采集及网页会话，重新登录、激活/换账号、阻断清理和退出仍使旧操作失效。

| 项目 | 规则 |
| --- | --- |
| 分区 | `persist:bilibili-dynamic-lottery-lottery-v2-<hash>`，hash 使用上述服务器源/账号二元组；不读取 `persist:bilibili` 或旧单 ID 分区 |
| 登录 URL | `https://passport.bilibili.com/login`，HTTPS Bilibili 域内导航；受限登录窗口无 preload、启用沙箱与上下文隔离 |
| 快照 | `dataDir/dynamic-lottery-auth/lottery-v2-<hash>/cookies.enc`；`safeStorage` 加密 `{version:2,serverOrigin,streamerId:原始账号编号,cookies}`，临时加密文件原子替换，不创建明文导出 |
| 恢复 | 当前可信主体首次使用时按需恢复；完整 Chromium 登录优先，快照主体必须一致，过滤域名/过期/无效 Cookie；失败在本功能报告，不影响其他启动 |
| 展示状态 | API 源下三项有效 Cookie 均非空、UID 是十进制字符串；只供登录展示，不构成动态作者身份或在线有效性证明 |
| 内部读取 | `getIdentity()` 只返回可信 LIRA 作用域；`getContext()` 绑定本专用分区与 `createLotterySession`。桌面组合根将这两个读取回调注入内嵌抽奖运行时，不调用直播 Cookie getter，也不向 preload 导出 |
| 退出/切换 | 等待取消的登录窗口与在途写入，再只清除当前作用域分区和快照；授权变化丢弃旧结果，退出与重新登录使旧 `sessionEpoch` 失效；不删抽奖历史 |
| 退出软件 | 注销 IPC、取消窗口并排空认证操作（完整退出排空顺序见 [main.md](main.md#7-关闭序列与播放状态冲刷)） |
| 网络与同步 | 状态读取不请求 B 站；作者/关注验证仍由 Provider 的受控调度执行。专用凭据不注入直播或云同步，也不暴露给渲染进程 |

`getIdentity()` 的内部 `signal` 由抽奖认证模块维护；切换授权生命周期、专用账号重新登录/退出或释放时取消旧 `signal`，正常令牌续期保留它。领域采集、开奖和请求退避沿用该取消信号；运行时在接纳新操作前只排空已取消的旧任务，再核对命名空间、授权代次与 `signal`，避免旧退避阻塞新账号或在切走再切回时恢复旧操作。该接口不向渲染进程暴露，已消耗预算和限流规则保持不变。

旧单 ID 分区、v1 快照及没有服务器源的业务数据原样保留，不按当前服务器自动认领或删除。发现旧快照且新分区未登录时返回 `LOTTERY_AUTH_RELOGIN_REQUIRED`，IPC 按公开 warning 白名单透传该码，界面提示重新登录并说明旧数据尚未关联；未列入白名单的内部提示不传给渲染进程。仅重新登录不会把旧活动归入新作用域。同服务器源/账号的新快照可跨重启恢复，异服务器源即使账号编号相同也互相隔离。

IPC 与返回字段在 [preload.md](preload.md) §2.3 登记。百宝箱已接入用户主动采集、随机排序和按需关注核验/递补。操作开始、每个出站请求及提交前都会复核会话；预算等待期间定期复核，账号变化使旧工作暂停。当前限制与后续验收见 [实施计划](../../../specs/plans/2026-09-14-bilibili-dynamic-lottery.md)。

## 15. DeviceBearer 请求的主体与生命周期

设备激活使用 `device-key-store.prepareActivation()` 复用有效旧密钥，或准备加密候选密钥。指纹检查通过后、远端调用前，将候选密钥用 `safeStorage` 加密后原子写入 `device-key.pending.bin`，保留原 `device-key.bin`。只有远端绑定成功、响应含 `deviceId` 且激活生命周期仍有效时，才将候选提升为主密钥；身份保存成功后清除候选。指纹失败、远端失败、响应缺少 `deviceId` 或任务失效均不覆盖原主文件。

响应丢失时保留并复用候选密钥，不重新生成可能覆盖服务端已绑定私钥的新密钥。已有 `deviceId` 的启动流程先使用候选完成 challenge/verify；仅遇到明确的 HTTP 401 `SIGNATURE_INVALID` 才回退原密钥。恢复成功后先提升主密钥、保存身份，再发布 `AUTHORIZED` 并启动会话维护；提升或身份写入失败及 `dispose` 保留候选。首次激活若尚未拿到 `deviceId`，现有服务端协议无法仅凭候选密钥自动找回设备身份；当前仅保证本地保留候选密钥，不支持跨系统自动恢复。

远端 HTTP 响应按流累计字节（普通请求 1 MiB、礼物历史/补拉 512 KiB、歌曲 8 MiB、SSE 错误体 64 KiB），超限时取消 reader 并释放锁；完整礼物目录的独立容量上限见 [main.md §2.1](main.md#21-设备授权生命周期)。仅提供 `text()` 的注入响应保留测试兼容回退，生产 fetch 统一使用流式读取。

[license-manager.js](../../../src/electron/license/license-manager.js) 在通用 `withAuthorizedToken` 入口捕获可信 `streamerId`、`deviceId`、`licenseId` 与内部生命周期代次（`generation`）；等待授权、首次远端调用、成功提交、失败处理和重试都必须仍属于该上下文。`bootstrap`、`activate` 开始以及会话清理/阻断、`dispose` 均使旧代次失效，因此 A → B → A 即使恢复到相同主体和令牌，也不会接受第一轮 A 的响应或重发其写入。

**令牌续期与授权代次统一规则**：

- 主进程内部通过只读的 `getAuthorizationGeneration()` 区分登录生命周期：同一生命周期内的正常令牌续期保持在途请求与会话上下文有效，已失效令牌的调用仍可共享一次重新验证并向同主体重试一次；但重新登录、切换账号或服务器、撤销/阻断清理以及 `dispose` 会使旧代次失效（`getAuthorizationGeneration()` 仅限主进程使用，不暴露给 preload/IPC；公开的授权纪元 `authorization epoch` 仍在每次成功认证时更新，供既有调用方使用）。
- 迟到成功以 `LICENSE_NOT_AUTHORIZED` 拒绝；迟到错误可返回原调用方，但不再清空或阻断新会话。`getProfile` 在通用层校验及敏感字段清洗后同步提交，避免后续异步恢复旧资料。
- **适用模块与各自补充约束**：
  - **弹幕外观、画布预览与本机直播来源**：首次承接与旧地址读取共享同一主体、授权代次下尚未完成的 `getOverlaySettings()` 请求（完成或失败即释放，不缓存结果；带 `AbortSignal` 的事件订阅读取独立执行；写入不合并）。`getSceneOwner` / `getComponentPreviewOwner` 额外校验当前授权、服务器源与 `streamerId`，正常令牌续期不撤销来源、正在编辑的连接或重建云弹幕订阅（预览中继见 [预览 API](../backend/api.md#浏览器组件预览)）。
  - **每日机器人**：正常令牌续期保留页面草稿与待重试回执；动作和错误契约见 [preload.md](preload.md#4-每日机器人-action)。
  - **粉丝档案**：按该登录生命周期与账号作用域绑定页面 `contextId`、事实同步、大航海名单及资料补查；A → B → A 不会恢复旧页面写入资格。大航海导入另行复核发起时的房间，房间变化时不提交旧名单。

携带 `AbortSignal` 的内部业务读取在授权等待、请求执行和重认证等待期间均可取消当前调用；取消不会终止其他调用方共用的续期，也不转为会话撤销。完成、失败和取消都会移除等待监听。

内部凭据读取和 SSE 的完成/失败同样遵循上述约束；流的取消与事件处理仍由云同步、礼物控制器现有的 `AbortSignal` 和主体检查负责。旧续期、心跳的完成或 `finally` 不得替换新生命周期的共享任务引用或维护定时器。回归场景见 [license-manager-identity.test.js](../../../test/license/license-manager-identity.test.js)（使用合成身份、可控 Promise 与隔离管理器，不访问真实服务）。

## 16. 可选的大航海到期账号

`guard-expiry-auth.js` 选择 `shared` 时让服务器内部复用原 B 站直播凭据；选择 `separate` 时每次新建非持久化的内存分区 `guard-expiry-<uuid>`，使用 passport 登录页和受限登录窗。只读取能发送给 `api.live.bilibili.com` 的 Cookie，由主进程上传至当前授权租户的专用接口；服务器验证房主后独立加密存储。临时会话结束即清理，无本地 Cookie 快照或主账号恢复。切回 `shared` 会清除云端独立凭据，独立退出不影响原直播账号。

操作绑定发起时的 `streamerId` 与授权代次（`generation`）；授权变更、来源切换、退出和应用关闭会取消未完成登录。状态仅返回安全元数据，主窗口 IPC 不接受凭据。服务器未支持时显示明确提示。需求与验收见 [到期同步规格](../../../specs/guard-expiry-sync.md)。

## 17. 豆包个人账号

[豆包会话模块](../../../src/electron/doubao-session.js)独立于音乐、B 站及 LIRA 服务器授权。系统 `safeStorage` 可用时使用持久化分区 `persist:lira-doubao`；不可用时使用内存分区 `lira-doubao`，不写任何登录快照。入口固定为 `https://www.doubao.com/chat/`，用手机豆包扫码；电脑端只使用 Electron 自带 Chromium。

登录状态来自官方源下非空的 `sessionid` 或 `sessionid_ss` Cookie；这只表示本地会话存在，实际服务是否接受由文字连接测试确认。Cookie 值仅留在隔离的官方页面和主进程中，管理页只获得四个布尔字段：`available`、`loggedIn`、`needsVerification`、`encryptionAvailable`。会话身份散列仅用于内部代次比较，不对外公开。

豆包域及其子域的 Cookie 经 `toSerializableCookie` 序列化为 `{version:1,cookies}`，用 `safeStorage` 加密后写入 `dataDir/doubao-auth/cookies.enc`。Cookie 变化后 600ms 防抖、临时文件原子替换，不导出明文。初始化仅在当前分区缺少登录 Cookie 时恢复快照，过滤过期 Cookie；无法解密时不降级为明文。官网退出导致登录 Cookie 消失时删除旧快照，避免重新恢复已退出的会话。

显式退出先递增代次并取消全部排队与在途请求，再关闭本窗口、排空账号工作、清理本分区存储和本快照（不影响其他平台账号）。登录变化、验证状态变化、退出及 `dispose` 均使旧请求失效，`whenIdle()` 排空该模块的工作；启动初始化和退出排空顺序见 [main.md](main.md#7-关闭序列与播放状态冲刷)。HTTP 操作沿用现有管理授权（见 [API](../backend/api.md#13-ai-域ai)），文字协议和人工验证后的恢复规则见 [AI](../backend/ai.md#44-豆包个人账号实验性)。

该模块在内存中按房间/观众/人格/本地会话作用域保留已确认的 `conversation` / `section` 标识与过期时间，连接测试使用独立作用域；不写入 Cookie 快照，也不向管理页公开。身份变化、退出及 `dispose` 清除全部标识；验证码状态变化只取消旧请求，保留有效标识供恢复后复用。首建、过期和上下文切换均由该模块的串行队列管理，未知结果继续全局阻塞；完整规则与实验性验收限制见上述 AI 契约。
