# 辅助窗口：音乐登录窗、B 站登录窗、全屏取色

> 涉及文件：[src/electron/login-window.js](../../../src/electron/login-window.js)、[src/electron/music-login-window.js](../../../src/electron/music-login-window.js)、[src/electron/bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)、[src/electron/doubao-session.js](../../../src/electron/doubao-session.js)、[src/electron/screen-color-picker.js](../../../src/electron/screen-color-picker.js)

主窗口规格见 [main.md](main.md)；登录分区、登录地址、Cookie 快照与登录检测逻辑见 [auth.md](auth.md)（本文档只说明辅助窗口本身的行为）；全部 IPC 通道见 [preload.md](preload.md) §2。

## 1. 音乐平台登录窗（`music-login-window.js`）

`loginMusicAccount(mainWindow, platform, dataDir, {signal, writeLog})`（[music-login-window.js](../../../src/electron/music-login-window.js)）将平台配置与认证操作交给共享的 [login-window.js](../../../src/electron/login-window.js)。平台参数来自 `music-auth-manager.js` 的 `MUSIC_LOGIN_CONFIG`（分区、登录 URL 与允许域名见 [auth.md](auth.md) §1–§3）：

| 项目 | 配置与行为 | 出处 |
| --- | --- | --- |
| 窗口形态 | `1000×720`，父窗口为主窗口，`modal: false` | [login-window.js](../../../src/electron/login-window.js) |
| `webPreferences` | 指定平台的持久化分区（隔离登录态），`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`，**无预加载脚本** | 同上 |
| 权限 | `setPermissionRequestHandler` 一律拒绝 | 同上 |
| 初始 URL | 对应平台登录 URL（见 [auth.md](auth.md) §2） | 同上 |

**导航白名单**：[login-window.js](../../../src/electron/login-window.js) 的 `setWindowOpenHandler`、`will-navigate` 与主框架 `will-redirect` 共用 `isAllowedLoginNavigation(url, config.allowedHosts)`，仅允许对应音乐平台的 HTTPS 域名及其子域。允许的弹窗目标在当前窗口调用 `loadURL` 打开；显式外部链接仅在通过 `isAllowedExternal` 校验时交由系统浏览器打开。主框架越界重定向一律阻止，不自动打开系统浏览器；子框架重定向不套用顶层页面规则。`setWindowOpenHandler` 始终返回 `{action:'deny'}`，不新建 Electron 窗口。

**关闭与登录检测联动**：窗口监听 Cookie 变更并按 1.5s 轮询兜底，检测到登录成功后自动 `close()`；窗口 `closed` 时清理定时器与监听器、执行最终强制落盘并返回 `{platform, snapshot, state}`（防抖落盘、轮询与防重入细则见 [auth.md](auth.md) §9）。

主框架加载失败的 `music-login-load-failure` 日志包含 `platform`、`errorCode` 与 `errorDescription`；其他错误日志保留原始 Error 对象交给桌面日志脱敏，子框架失败不关闭登录窗口。

## 2. B 站登录窗（`bilibili-login-window.js`）

`openBilibiliLoginWindow(options)`（[bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)）接收 `BrowserWindow`、`shell` 和 `auth` 适配器，同样通过 `login-window.js` 管理窗口：

| 项目 | 配置与行为 | 出处 |
| --- | --- | --- |
| 初始 URL | `https://live.bilibili.com/`（见 [auth.md](auth.md) §2） | [bilibili-auth.js](../../../src/electron/bilibili-auth.js) |
| 持久化分区 | Bilibili 持久化登录分区（见 [auth.md](auth.md) §1） | 同上 |
| 默认静音 | 入口传入 `muted: true`，共享窗口调用 `webContents.setAudioMuted(true)`，防止直播首页自动播放带声音的直播流；静音跨页内导航持续生效 | [bilibili-login-window.js](../../../src/electron/bilibili-login-window.js)、[login-window.js](../../../src/electron/login-window.js) |
| 权限 | 拒绝所有权限请求 | [login-window.js](../../../src/electron/login-window.js) |
| 导航 | 与音乐登录窗共用 HTTPS 域名规则；显式外链按外部策略打开，主框架越界重定向仅阻止（域名清单见 [auth.md](auth.md) §3） | 同上 |

入口保留 B 站专用的认证与诊断：

- **登录检测**：优先调用注入的 `getBilibiliSessionState()`（兼容仅提供 `getBilibiliAuthState()` 的适配器）；详细时序与 `closed` 时清理旧 `cookies.txt` 规则见 [auth.md](auth.md) §6、§9。
- **诊断摘要**：通过 `onEvent` 记录打开、加载失败与关闭结果；关闭记录只包含认证摘要、是否自动关闭及快照是否保存，不输出 Cookie。

## 3. 生命周期与 IPC 语义

音乐与 B 站窗口均固定调用方提供的标题，阻止页面修改原生标题；共享的 `loginCheckInFlight` 与 `loginCloseRequested` 防止重复检测和重复自动关闭。初次 `loadURL` 失败时清理监听、销毁窗口并等待关闭后的写入收尾，再将异常抛回调用方（主动取消则返回关闭结果）。音乐入口由 `desktop-auth-controller` 注入桌面 `writeLog`，保存、状态读取和导航异常沿用统一脱敏，不直接输出原始异常到控制台。

抽奖专用登录复用 `openBilibiliLoginWindow`，通过可选 `title` 设置「登录抽奖专用账号」，并通过 `signal` 在退出、授权变化或软件关闭时销毁窗口；`onWindowReady` 仅供抽奖认证模块保存窗口句柄并在重复点击时聚焦窗口。默认标题和直播登录行为不变，分区与登录 URL 见 [auth.md](auth.md) §14。取消监听会与原有定时器、Cookie 监听一并清理，抽奖认证模块等待窗口关闭后的写入排空，且不向渲染进程返回原始快照。

两类登录辅助窗口均由主窗口的 IPC 驱动创建和销毁（通道清单与载荷见 [preload.md](preload.md) §2）；窗口生命周期事件（`create` / `open` / `close`）经 `main.js` 的 `writeLog` 记入 `desktop.log`（见 [main.md](main.md) §8）。

- 登录窗生命周期绑定 `music:login` / `bilibili:login`：处理器 `await` 窗口 `closed` 后向渲染进程返回登录结果（登录态判定与快照返回见 [auth.md](auth.md) §4、§9）。直播歌词已改为 `/lyrics` 浏览器源，不再创建 Electron 辅助窗口。

## 4. 豆包账号与验证窗口

[doubao-session.js](../../../src/electron/doubao-session.js) 管理一个 `1100×820` 的豆包官网窗口，父窗口为 LIRA 主窗口，标题为「LIRA · 豆包账号登录与验证」。窗口无预加载脚本、禁用 Node 集成，启用上下文隔离（`contextIsolation`）与沙箱（`sandbox`），拒绝权限请求、下载及弹窗。顶层导航和重定向仅允许精确官方源；分区与入口见 [auth.md](auth.md#17-豆包个人账号)。

点击扫码或验证按钮时显示并聚焦该窗口，未登录时最多等待 15 秒查找官网「登录」按钮并打开登录面板；扫码确认和验证码由用户完成。普通关窗只隐藏窗口，保留网页运行时供后续文字请求使用；显式退出、请求取消/超时或应用 `dispose` 时销毁窗口。该窗口不加载 LIRA 管理页，也没有管理凭据或任意脚本 IPC。下次需要时重新创建，登录态仍由豆包会话模块统一管理。

## 5. 全屏取色窗口

[screen-color-picker.js](../../../src/electron/screen-color-picker.js) 在用户点击取色时通过 `desktopCapturer` 获取所有显示器的一次快照，以 `display_id` 匹配显示器，再按各自 `bounds` 创建无边框置顶窗口。覆盖窗口外区域及多显示器，截图不落盘。点击坐标按截图实际像素尺寸换算，适配显示缩放和负坐标显示器。画面在取色期间保持静止，放大镜显示鼠标所指像素与 HEX 值；单击确认，按 Esc 或右键取消。不透明度由原颜色组件保留。

固定本地 HTML 和独立沙箱预加载脚本运行在内存分区 `lira-screen-color-picker` 中，启用上下文隔离、禁用 Node 集成、禁止外部导航与新窗口，且页面 CSP 不允许脚本或网络资源。同一时刻只允许一次取色操作，截图缺失时整体失败，准备超时 15 秒失败。取色成功、取消、主窗口销毁或主 frame 导航、显示器配置变化、取色窗口关闭/崩溃以及主进程释放注册器时，均会销毁全部临时窗口，并释放图像引用、定时器以及主窗口和显示器变更监听。成功或用户取消后恢复原主窗口焦点。
