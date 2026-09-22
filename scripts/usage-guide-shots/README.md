# 使用文档截图管线（usage-guide-shots）

按 `docs/客户端使用文档补充方案.md` 第六章的清单，在隔离环境中生成截图。本文档当前内嵌的图片与状态说明见方案附录 D、E。

## 用法

```bash
# 首次创建隔离示例数据（已有数据时跳过）
node scripts/usage-guide-shots/seed-data.cjs

# 客户端截图：独立 Electron 窗口、真实 preload、随机空闲端口
node scripts/usage-guide-shots/supplement.cjs
node scripts/usage-guide-shots/supplement.cjs --only=A1,B1

# 网页端补图：样式、完整 OBS 地址、展开的歌单外观
node scripts/usage-guide-shots/web-supplement.cjs --only=S6,S6b,F3b

# PNG → WebP（≤200 KB 目标自检）
node scripts/usage-guide-shots/to-webp.cjs
```

`supplement.cjs` 使用 `electron-fixture.cjs`，不启动生产 `main.js`，也不要求关闭用户正在运行的 LIRA。不要同时运行两个使用同一示例数据库的截图进程。

早期浏览器样张工具仍可按以下方式使用，但客户端截图以 Electron 路径为准：

```bash
node scripts/usage-guide-shots/capture.cjs --port=0

# 只截指定镜头 / 指定组
node scripts/usage-guide-shots/capture.cjs --only=A1,B1 --port=0
node scripts/usage-guide-shots/capture.cjs --group=B --port=0

# 重建示例数据后再截
node scripts/usage-guide-shots/capture.cjs --reseed --port=0

# 查看镜头清单（含暂缓项与原因）
node scripts/usage-guide-shots/capture.cjs --list

```

## 产出

```
screenshots/usage-guide/
  data/          隔离示例数据（SQLite，合成数据，不含真实账号）
  png/<组>/      原始截图
  webp/<组>/     发布候选图
```

以上目录均在 `.gitignore`。选用的 WebP 另存到 `docs/images/usage-guide/<组>/`，随方案保留；正式手册的既有素材仍在 `public/img/usage-guide/`。不要把数据库或 Electron 配置复制到文档目录。

## 本轮截图环境

- 2026-09-22 按审阅报告重截 16 张、补充 36 张，共 52 张修订图片；方案现在保留 124 张候选图，另复用 10 张既有素材。
- `supplement.cjs`：客户端各镜头的导航、裁切、标题与编号；输出 `supplement-results.json`，记录实际像素尺寸。长面板按滚动位置拆图，带 `mustShow` 的镜头检查关键控件是否完整处于窗口和滚动容器内；仍需目视核对文字与页面定位。
- `electron-fixture.cjs`：真实 Electron/preload 与本机运行时；授权、更新、云端设置等响应使用合成数据，外部渲染请求被拦截。
- `web-fixture.cjs`：导出 `start(serverRoot?)`，返回 `{ server, baseUrl }`。默认读取相邻 `lira-server/public/` 的实际前端，用内存数据提供 GET 接口；不启动服务器应用、不读取其配置或真实数据。网页端图片通过 Playwright 访问该临时服务拍摄。
- `web-supplement.cjs`：提供 S6 / S6b / F3b 的网页端镜头，以及 F7 / F8 的本机投屏镜头；输出 `web-supplement-results.json`。CLI 只运行网页端镜头，本机投屏按下方示例复用隔离 Electron 的地址。
- 浏览器源：在 Electron 示例运行时提供的本机地址打开 `/queue`、`/songlist`、`/blindbox`、`/gift-wishes`；`/danmaku?preview=1&style=signal` 为产品内置静态预览。

F7 / F8 需要已就绪的隔离 Electron 实例 `electronApp`，以及本次任务创建的 Chromium 页面 `page`。在使用项目作用域 `createRequire` 初始化的 Playwright REPL 中调用：

```js
const webShots = projectRequire('./scripts/usage-guide-shots/web-supplement.cjs');
const localBase = await electronApp.evaluate(() => global.usageShots.baseUrl);
for (const shot of webShots.SHOTS.filter((item) => item.local)) {
  await webShots.capture(page, localBase, shot);
}
```

这里的 `electronApp` 必须来自 `electron-fixture.cjs`，不要连接用户正在使用的客户端或复用其数据目录。`capture` 会先检查具体路由的 HTTP 状态，再导航、滚动并截图。

网页截图结束后关闭浏览器上下文，再对示例 HTTP 服务调用 `server.closeAllConnections()` 和 `server.close()`；Electron 使用 Playwright 的 `app.close()` 退出。所有本地页面先检查具体路由的 HTTP 状态。

这些图片展示界面位置，不验证远程服务、真实登录、发送弹幕或文件导出。B12b 是在隔离歌库执行导入后的计数反馈；F2b 的同步成功提示来自合成接口，C8 的音乐平台登录状态也为演示，不能证明真实账号或线上同步成功。D6 使用示例导出快照，因为拍摄时真实运行时的 `getGlobalSnapshot` 调用报错；歌词播放、开奖、AI 测试、真实登录与连接、备份恢复、OBS 添加源等剩余验收见方案 D.2。

## 早期工具的三条截图路径

| 镜头类型 | 路径 | 说明 |
| --- | --- | --- |
| `admin` | `createServerRuntime` + Chromium 注入 token 与桌面桥桩 | 点歌/播放/礼物/百宝箱管理页 |
| `overlay` | 同上服务，浏览器直开 | `/queue`、`/gift-wishes` 等 15 个免登录投屏页 |
| `license` | Chromium 开 `/license` + 授权桥桩 | 登录/注册窗口各状态（注册、登录、准备中、失败态） |

桌面桥桩（`window.songAssistantDesktop` 等）返回固定演示值，使页面呈现桌面外壳样式；
授权桥桩（`window.liraLicense`）按 manifest 里的状态驱动登录窗渲染。

## 加一个新镜头

客户端镜头优先在 `supplement.cjs` 的 `SHOTS` 中追加，按附近条目的 `feature` / `tab` / `clip` / `setup` 写法操作真实界面。

早期浏览器工具在 `manifest.js` 的 `SHOTS` 里加一项：`id`（对齐方案 6.3 编号）、`file`（kebab-case 文件名）、
`type`、`viewport`、`waitFor`（数据就绪选择器）、`setup`（切页/开弹窗）、
`annotations`（标注元素 + 序号）、`covers`（脱敏遮盖）。然后 `capture.cjs --only=<id>` 验证。

## 注意

- Electron 截图环境使用随机空闲端口，不操作用户正在运行的实例。旧工具需传 `--port=0` 避免与常用端口冲突。
- 示例数据全部合成（示例主播 / 房间号 123456 / 观众A·B·C·D），不读取本机真实 `data/`。
- 最新截图状态以方案附录 D 为准；旧 `manifest.js` 的 `skip` 仅表示早期工具的覆盖范围。
