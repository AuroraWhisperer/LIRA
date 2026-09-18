# 登录与会话:Cookie 分区、加密快照与注入契约

> 涉及文件:[src/electron/auth-manager.js](../../../src/electron/auth-manager.js)、[src/electron/bilibili-auth.js](../../../src/electron/bilibili-auth.js)、[src/electron/login-window.js](../../../src/electron/login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)、[src/electron/main.js](../../../src/electron/main.js)(恢复时序与注入)

本文档是登录会话的**唯一事实源**:分区模型、登录 URL、Cookie 域名与关键 Cookie、快照加密格式、恢复时序、服务器注入契约只在此成表。窗口行为(尺寸/导航/权限)见 [windows.md](windows.md),IPC 通道见 [preload.md](preload.md) §2。

## 1. 分区模型(唯一成表处)

本节及下文原有音乐/直播登录保持兼容；抽奖专用账号的独立分区和持久化合同见 §14，不复用直播登录。

每个平台使用独立 **persist 持久化分区**,Cookie 互不干扰;分区目录落在 Chromium userData 下的 `Partitions/`，与业务 `dataDir` 分离；旧分区在 ready 前整体迁移，认证快照继续保留原业务路径(数据目录树见 [../backend/storage.md](../backend/storage.md) §2):

| 平台       | 分区                    | 出处                                                              |
| ---------- | ----------------------- | ----------------------------------------------------------------- |
| QQ音乐     | `persist:music-qq`      | [auth-manager.js:12](../../../src/electron/auth-manager.js#L12)   |
| 网易云音乐 | `persist:music-netease` | [auth-manager.js:21](../../../src/electron/auth-manager.js#L21)   |
| Bilibili   | `persist:bilibili`      | [bilibili-auth.js:12](../../../src/electron/bilibili-auth.js#L12) |

> 历史文档曾写 `persist:qqmusic-login` / `persist:bilibili-login`,已纠正。

## 2. 登录 URL(唯一成表处)

| 平台       | 登录 URL                     | 出处                                                              |
| ---------- | ---------------------------- | ----------------------------------------------------------------- |
| QQ音乐     | `https://y.qq.com/`          | [auth-manager.js:13](../../../src/electron/auth-manager.js#L13)   |
| 网易云音乐 | `https://music.163.com/`     | [auth-manager.js:22](../../../src/electron/auth-manager.js#L22)   |
| Bilibili   | `https://live.bilibili.com/` | [bilibili-auth.js:13](../../../src/electron/bilibili-auth.js#L13) |

> 历史文档曾把 Bilibili 登录 URL 误写为 passport 子域下的 `/login` 页面,已纠正。`passport` 子域仍在**允许导航域名**清单内(§3),登录窗口内的实际跳转不受影响。

## 3. 平台配置与 Cookie 过滤

音乐登录和认证 owner 先通过 `normalizeMusicPlatform` 的 own-property 配置枚举校验，仅接受 qq/netease（忽略首尾空格和大小写）。`constructor`、`__proto__` 等继承属性在 BrowserWindow 创建、session 获取和快照路径操作前被拒绝；不允许回落默认 session。

平台配置(来源 [auth-manager.js:9-27](../../../src/electron/auth-manager.js#L9-L27)、[bilibili-auth.js:10-22](../../../src/electron/bilibili-auth.js#L10-L22)),**唯一成表处**:

| 平台     | 允许 Cookie 域名                                                           | 关键 Cookie(keyCookies)                                                                                     | 认证 Cookie(authCookies)            |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| QQ音乐   | `.qq.com`、`.y.qq.com`、`y.qq.com`                                         | `uin`、`qqmusic_uin`、`qqmusic_key`、`qm_keyst`、`p_skey`、`skey`、`wxuin`、`p_uin`、`pt2gguin`、`superuin` | `qqmusic_key`、`qm_keyst`(任一非空) |
| 网易云   | `.163.com`、`.music.163.com`、`music.163.com`                              | `MUSIC_U`、`__csrf`                                                                                         | 缺省 → 回退 keyCookies              |
| Bilibili | `.bilibili.com`、`bilibili.com`、`.live.bilibili.com`、`live.bilibili.com` | `DedeUserID`、`SESSDATA`、`bili_jct`                                                                        | 三者缺一不可(§4)                    |

Cookie 域名匹配(`isAllowedMusicCookie`/`isAllowedBilibiliCookie`):`domain === allowed` 或 `domain === hostAllowed`(剥离前导点)或 `domain.endsWith('.' + hostAllowed)` — 子域名通配([auth-manager.js:45-53](../../../src/electron/auth-manager.js#L45-L53)、[bilibili-auth.js:36-44](../../../src/electron/bilibili-auth.js#L36-L44))。

**允许导航域名**(登录窗内跳转/外链判定,见 [windows.md](windows.md) §2-§3):

| 平台     | allowedHosts                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QQ音乐   | `y.qq.com`、`i.y.qq.com`、`graph.qq.com`、`ssl.ptlogin2.qq.com`、`xui.ptlogin2.qq.com`、`ui.ptlogin2.qq.com`、`ptlogin2.qq.com`、`qq.com`                                                                                                                                                                 |
| 网易云   | `music.163.com`、`interface.music.163.com`、`interface3.music.163.com`、`passport.163.com`、`reg.163.com`、`163.com`                                                                                                                                                                                      |
| Bilibili | `bilibili.com`、`www.bilibili.com`、`live.bilibili.com`,以及 passport、`api.bilibili.com`、`api.live.bilibili.com`、`space.bilibili.com`、`message.bilibili.com`、`member.bilibili.com`、`account.bilibili.com` 子域(完整清单见 [bilibili-auth.js:14-19](../../../src/electron/bilibili-auth.js#L14-L19)) |

匹配方式 `host === allowed || host.endsWith('.' + allowed)`,仅接受 `https:`/`http:`([auth-manager.js:55-64](../../../src/electron/auth-manager.js#L55-L64)、[bilibili-auth.js:46-55](../../../src/electron/bilibili-auth.js#L46-L55))。

## 4. 登录态判断

- **音乐平台** `getMusicAuthState(platform, dataDir)`([auth-manager.js:128-154](../../../src/electron/auth-manager.js#L128-L154)):`loggedIn = authCookies 中任一 Cookie 值非空`(QQ 仅 `qqmusic_key`、`qm_keyst` 之一;`p_skey`/`skey` 虽保留在 `keyCookies` 中供 QQ Provider 的 GTK/Web 回退使用,但不单独完成 QQ 音乐登录;网易云回退到 keyCookies,即 `MUSIC_U` 或 `__csrf` 之一)。
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

| 平台     | 快照文件                              | 出处                                                                     |
| -------- | ------------------------------------- | ------------------------------------------------------------------------ |
| QQ音乐   | `data/music-auth/qq.cookies.enc`      | [auth-manager.js:41-43](../../../src/electron/auth-manager.js#L41-L43)   |
| 网易云   | `data/music-auth/netease.cookies.enc` | 同上                                                                     |
| Bilibili | `data/bilibili-auth/cookies.enc`      | [bilibili-auth.js:28-30](../../../src/electron/bilibili-auth.js#L28-L30) |

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

| 机制                 | 说明                                                                                      | 出处                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| cookie change 主路径 | 每次 `cookies.on('changed')` 立即 `getAuthState()` 判定登录完成,并触发 800ms 防抖快照落盘 | [login-window.js:63-68](../../../src/electron/login-window.js#L63-L68) |
| 1.5s 轮询安全网      | `setInterval(checkLoginComplete, 1500)` 兜底(防止漏掉 cookie 事件)                        | [login-window.js:73](../../../src/electron/login-window.js#L73)        |
| 自动关闭             | 检测到 `loggedIn` → 登录窗自动 `close()`                                                  | [login-window.js:52-61](../../../src/electron/login-window.js#L52-L61) |
| 最终快照             | 窗口 `closed` 时强制 persist 一次,随 promise resolve `{snapshot, state}`                  | [login-window.js:75-89](../../../src/electron/login-window.js#L75-L89) |

Bilibili 同构,另带 `loginCheckInFlight`/`loginCloseRequested` 防重入(见 [windows.md](windows.md) §3)。

## 10. Cookie → API 请求头

头像 CDN 代理 `BilibiliApiClient.fetchAvatarImage` 不携带 Bilibili Cookie，保留 HTTPS/hdslb 域名、Referer 和图片响应检查；其他需要认证的 Bilibili API 请求头保持不变。

`getMusicCookieHeader(platform)`([auth-manager.js:155-161](../../../src/electron/auth-manager.js#L155-L161)) / `getBilibiliCookieHeader()`([bilibili-auth.js:165-171](../../../src/electron/bilibili-auth.js#L165-L171)):实时从平台分区读取允许域名内的全部 Cookie,过滤空 name/value 后拼接 `"name1=value1; name2=value2; ..."`。`getBilibiliUid()`([bilibili-auth.js:173-177](../../../src/electron/bilibili-auth.js#L173-L177)):返回 `DedeUserID` 数值。

`getBilibiliAccountProfile(dataDir)` 先复用上述登录态判定，再用当前 UID 和 Cookie 调用 Bilibili 用户卡片接口；只向 renderer 返回 `{uid, name, avatarUrl}`，其中头像地址仍经过 `hdslb.com` HTTPS 白名单归一化，不返回 Cookie。资料查询独立于登录态 IPC，接口失败不会阻塞登录窗口完成或改变登录判定。

消费方:

| 消费者                                                                                  | 数据                                                                     | 文档                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 音乐 Provider 注册表(`createMusicProviderRegistry` 注入 `getAuthState/getCookieHeader`) | 每次 API 调用实时取 Cookie 头                                            | [../backend/music/services.md](../backend/music/services.md)       |
| Bilibili 弹幕/API 客户端                                                                | `refreshBilibiliAuthCache` 缓存 cookieHeader + uid,供 WS 握手与 API 请求 | [../backend/bilibili/protocol.md](../backend/bilibili/protocol.md) |

## 11. 服务器注入契约

Electron main 以适配器形式把 auth 能力注入 `desktopRuntime.start`(服务器端契约见 [../backend/server-core.md](../backend/server-core.md) §5):

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
  },
});
```

出处 [main.js:120-132](../../../src/electron/main.js#L120-L132)。独立 Web 模式无 safeStorage/Cookie 注入,降级认证(见 [server-core.md](../backend/server-core.md) §1)。

## 12. 安全要点

| 项目        | 说明                                                                                                                                              | 出处                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 快照加密    | safeStorage(Windows 上 DPAPI);`isEncryptionAvailable()===false` 时 persist 抛异常、restore 返回 null、auth state 报告 `encryptionAvailable:false` | [auth-manager.js:99-101](../../../src/electron/auth-manager.js#L99-L101)、[auth-manager.js:113](../../../src/electron/auth-manager.js#L113) |
| 登录窗      | sandbox:true、contextIsolation:true、无 preload、权限请求全拒                                                                                     | [windows.md](windows.md) §2                                                                                                                 |
| 导航限制    | 仅 allowedHosts 内导航,其余交系统浏览器                                                                                                           | §3                                                                                                                                          |
| 子域名通配  | 剥离前导点后 `endsWith('.host')` 接受所有子域名                                                                                                   | §3                                                                                                                                          |
| 会话 Cookie | 无 expirationDate 的 Cookie 恢复后仍是会话 Cookie,重启可能丢失                                                                                    | §5.2                                                                                                                                        |
| 判定差异    | QQ: `qqmusic_key`/`qm_keyst` 任一非空;网易云:任一认证 Cookie;Bilibili:三键全有                                                                    | §4                                                                                                                                          |
| 明文风险    | cookies.txt 存有完整 SESSDATA + bili_jct,设计如此                                                                                                 | §6                                                                                                                                          |

## 13. 云端 Bilibili 凭据同步边界

远端网页登录成功后的 Cookie 只通过 DeviceBearer 的 `GET /api/device/bilibili-credentials` 返回给 `licenseManager.getBilibiliCredentialsInternal()`；该方法使用不做响应清洗的 `withAuthorizedSecret`，但只由 [cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js) 在 Electron main process 内调用，不注册 IPC，也不进入 preload、renderer、本地 HTTP、URL 或日志。Streamer 网页只能获得登录状态、UID、revision 和二维码状态。

云端导入调用 `replaceBilibiliCookieHeader(dataDir, cookieHeader)`：先拒绝空值、超过 12000 字符、CR/LF/NUL、非法 Cookie 名或缺少 `DedeUserID` / `SESSDATA` / `bili_jct` 的 header；再清空 `persist:bilibili` 的 Cookie/localStorage/indexDB/webSQL，把解析出的 Cookie 写到 `.bilibili.com`，最后立即调用 `persistBilibiliCookieSnapshot` 生成 `safeStorage` 加密快照。云端解绑调用既有 `logoutBilibiliAccount`，清除分区、加密快照和兼容明文导出文件。

本地扫码登录完成或本地退出后，main process 将 Bilibili scope 标记 dirty：已登录时读取分区 Cookie header 上传，退出时调用 Device `DELETE`。上传失败保留 dirty 并重试；云端应用不会再次触发本地登录/退出 IPC，因此不会产生同步回声。凭据 wire contract 见 [../backend/api.md](../backend/api.md) §0.3，轮询与生命周期见 [main.md](main.md) §2.2。

## 14. 动态抽奖专用账号

[dynamic-lottery-auth.js](../../../src/electron/dynamic-lottery-auth.js) 是抽奖认证所有者；[dynamic-lottery-auth-store.js](../../../src/electron/dynamic-lottery-auth-store.js) 只管理其 Chromium Cookie 与加密快照。入口在桌面“百宝箱 → 动态抽奖”，由主进程现有授权管理器提供可信 `streamerId` 与 authorization epoch，不接受 renderer 指定账号作用域。

| 项目 | 合同 |
| --- | --- |
| 分区 | `persist:bilibili-dynamic-lottery-<sha256(streamerId)>`，不读取 `persist:bilibili` |
| 登录 URL | `https://passport.bilibili.com/login`，HTTPS Bilibili 域内导航；受限登录窗口无 preload、启用 sandbox/context isolation |
| 快照 | `dataDir/dynamic-lottery-auth/<hash>/cookies.enc`；`safeStorage` 加密二进制，临时加密文件原子替换，不创建明文导出 |
| 恢复 | 当前可信主体首次使用时按需恢复；完整 Chromium 登录优先，快照主体必须一致，过滤域名/过期/无效 Cookie；失败在本功能报告，不影响其他启动 |
| 展示状态 | API origin 下三项有效 Cookie 均非空、UID 是十进制字符串；只供登录展示，不是动态作者或在线有效性证明 |
| 内部读取 | `getIdentity()` 只返回可信 LIRA scope；`getContext()` 绑定本专用分区与既有 `createLotterySession`。桌面组合根将这两个读取回调注入内嵌抽奖 runtime，不能调用直播 Cookie getter，也不向 preload 导出这两个端口 |
| 退出/切换 | 等待取消的登录窗口与在途写入，再只清除当前作用域分区/快照；授权变化丢弃旧结果，退出与重新登录使旧 sessionEpoch 失效；不删抽奖历史 |
| 退出软件 | 注销 IPC、取消窗口、排空认证操作，与已有同步控制器一并排空后，继续原有播放快照/后端停机流程 |
| 网络与同步 | 状态读取不请求 B站；作者/关注验证仍由 provider 的受控调度执行。专用凭据不注入直播或云同步，也不暴露给 renderer |

IPC/返回字段只在 [preload.md](preload.md) 登记。百宝箱已接入用户主动采集、随机排序和按需关注核验/递补；登录成功仍不构成作者身份或真实接口可用性证明。操作开始、每个出站请求及提交前检查会话；预算等待期间定期重新检查，账号变化使旧工作暂停。新流程本轮按用户要求未测试，限制与后续验收见[实施计划](../../../specs/plans/2026-09-14-bilibili-dynamic-lottery.md)。

## 15. DeviceBearer 请求的主体与生命周期

设备激活使用 `device-key-store.prepareActivation()` 复用有效旧密钥，或准备加密候选。指纹检查通过后、远端调用前，将候选用 safeStorage 加密后原子写入 `device-key.pending.bin`，保留原 `device-key.bin`。只有远端绑定成功、响应含 deviceId 且激活生命周期仍有效才提升主密钥；身份保存成功后清除候选。指纹失败、远端失败、响应缺少 deviceId 或任务失效均不覆盖原主文件。

响应丢失时保留并复用候选，不重新生成可能覆盖服务端已绑定私钥的新密钥。已有 deviceId 的启动流程先使用候选完成 challenge/verify；仅明确的 HTTP 401 `SIGNATURE_INVALID` 才回退原密钥。恢复成功后先提升主密钥、保存身份，再发布 AUTHORIZED 和启动会话维护；提升/身份写入失败及 dispose 保留候选。首次激活若尚未取得 deviceId，现有服务端协议无法仅凭候选自动找回该身份；本轮只保证候选保留，不宣称跨系统事务或无条件自动恢复。

远端 HTTP 响应按流累计字节，普通请求 1 MiB、礼物历史/补拉 512 KiB、歌曲 8 MiB、SSE 错误体 64 KiB；超限取消 reader 并释放锁。完整礼物目录保留既有无固定体积/行数上限策略。仅提供 `text()` 的注入响应保留测试兼容回退，仍只能事后检查；生产 fetch 使用流式读取。本机构建摘要的信任语义不变。

[license-manager.js](../../../src/electron/license/license-manager.js) 在通用 `withAuthorizedToken` 入口捕获可信 `streamerId`、`deviceId`、`licenseId` 与内部生命周期代际；等待授权、首次远端调用、成功提交、失败处理和重试都必须仍属于该上下文。`bootstrap`、`activate` 开始以及会话清理/阻断、`dispose` 使旧代际失效，因此 A → B → A 即使恢复到相同主体和 token，也不会接受第一轮 A 的响应或重发其写入。

同一生命周期内的正常 token 续期保持请求有效，已失效 token 的调用仍可共享一次重新验证，并只向同主体重试一次。公开的 authorization epoch 仍在每次成功认证时更新，供既有消费者使用，不承担这个允许续期的请求代际职责。迟到成功以既有 `LICENSE_NOT_AUTHORIZED` 拒绝；迟到错误可返回原调用方，但不再清空或阻断新会话。`getProfile` 在通用层校验及敏感字段清洗后同步提交，避免后续异步恢复旧资料。

内部凭据读取和 SSE 的完成/失败同样经过该约束；流的取消与事件消费仍由云同步、礼物控制器现有的 `AbortSignal` 和主体检查负责。旧续期、心跳的完成或 `finally` 不得替换新生命周期的共享任务引用或维护计时器。回归场景见 [license-manager-identity.test.js](../../../test/license-manager-identity.test.js)，使用合成身份、可控 Promise 与隔离的 manager，不访问真实服务。
