# 独立组件浏览器源检查

日期：2026-11-06。当前基线：`7900fe4f` 加未提交工作树，package 版本 6.0.2。用户实际使用 6.0.0，另从 tag `v6.0.0`（`93167fbd`）提取隔离源码复测。

## 结论与范围

已复现并修复两类旧内核兼容性缺陷：加班机高度计算失效导致完全透明；投票/评分导入不支持的正则语法导致整页脚本停止。另修复盲盒长榜单因相同高度单位问题而超出视口。四份生产文件有变更，页面地址、接口和鉴权行为不变。

修复后，当前代码的 17 个固定入口在当前 Chromium 及实际 Chromium **106.0.5249.0** 中均显示相应合成内容；6.0.0 的 15 个固定入口应用同样四份修复后也在 Chromium 106 中通过。歌曲信息与心动盲盒是后续入口，不算作 6.0.0 的覆盖项。另核对文本框、背景、林间花信和航海旗帜的单图层来源。

检查使用现有 HTTP/WS/SSE 服务、真实浏览器页面及隔离的场景/素材存储，没有依赖 Electron preload。没有修改用户数据库、直播间状态或运行中的客户端。测试覆盖组件类型的输出路径，不代表逐款播放了所有内置外观及任意第三方素材。

用户确认另一台电脑同时运行 LIRA 和直播姬，因此不是将另一台电脑的 localhost 地址当作网络地址使用。本机未发现直播姬安装或进程，没有进行直播姬或 OBS 的实机验收，也不知道用户直播姬的内核版本。上述缺陷能解释新版 Electron 画布预览正常、旧浏览器来源空白的情况，但不能断言就是另一台电脑全部现象的根因。实际机器验收保留在[活动计划](../../specs/plans/2026-11-06-standalone-component-sources.md)。修复仅在源码工作树，尚未打包、发布或安装到用户电脑。

## 已复现的缺陷

| 来源 | 修复前证据 | 修复与复测 |
| --- | --- | --- |
| 加班机 `/overtime` | 原 6.0.0 在 Chromium 106 返回 HTTP 200，DOM 有 `00:02:00`，无页面异常，但 `.overtime-machine` 高度为 0 | `overtime.css` 保留 `vh` 基线，将 `dvh` 声明放入 `@supports`；同内核独立页恢复 720px 高度，场景内 iframe 的 300px 图层也正常显示 |
| 投票/评分 `/interactions` | 接口正常，但模块导入报 `Invalid regular expression flags`，页面空白 | `interaction-rules.js` 将 `v` 正则改为校验调用时构造；`interaction-appearance.js` 直接读取已在写入时校验的标题/提示，旧内核不再运行写入校验。投票、评分与 `观众投票 👩‍💻❤️` 标题正常显示，无页面异常 |
| 盲盒 `/blindbox` | 不支持 `dvh` 时，带 `var()` 的 `calc()` 使最大高度无效，长榜单越过浏览器源底边 | `blindbox.css` 同样使用 `@supports`；640×360 视口内保持高度限制，超出内容可滚动 |

CSS 中不支持的单位位于 `var()` / 含变量的 `calc()` 内时，会在计算值阶段失效；后写一条 `dvh` 并不能自动回退到之前的 `vh`。加班机同时使用 size containment，最终塌缩为 0。回归用未知视口单位模拟这种能力缺失，修复前分别触发加班机和盲盒断言失败，修复后通过；另用真实 Chromium 106 交叉验证。

原 6.0.0 的加班机整套场景输出在同一旧内核中也曾透明，不能把本次证据说成「旧内核画布来源正常、固定来源失败」。已证明的是桌面预览与旧浏览器能力存在差异，以及固定地址和画布图层的配置/数据来源不同。

严格的写入规则保持不变：桌面与 Node 仍校验字素长度、RGI emoji 和不可见字符。读取已保存的文字时做 trim/NFC，使用纯文本 DOM 渲染；未放宽后端设置校验。

## 地址与透明状态

- 功能页固定地址读取默认配置与实际业务状态，不会自动选择画布当前图层或播放示例数据。
- 独立图层通过 `/scene?id=…&item=…#token=…` 输出，位置归零，沿用已应用的样式和尺寸；共享默认图层仍复用原固定地址。
- 要显示画布中选定的一份组件：选中图层，点击「保存并应用」，再「复制组件地址」，在直播软件中填写完整地址及提示的宽高。
- 没有当前歌曲、活动、对应礼物记录，功能未启用或没有新的礼物触发时，部分正式来源保持透明。配置预览有示例不等于正式来源有实际内容。
- 文本框、背景和航海旗帜使用单图层来源。林间花信须先导入素材；现有 `src/server/gift-frame-resource.js` 已兼容固定来源所用的旧视频路径。隔离环境初次缺包的空白在安装真实素材后消失，不能归因于缺少兼容映射。

操作与各类显示条件见[组件使用指南](../guides/component-sources.md#直接使用独立组件)。

## 检查矩阵

以下固定入口均返回 HTTP 200；有数据条件下观察到对应内容。路径省略本机 origin，使用时应从界面复制完整地址。

| 组件 | 固定入口 | 内容证据 |
| --- | --- | --- |
| 弹幕姬 | `/danmaku?source=component` | 合成实时消息；保存外观及刷新后继续接收 |
| 时钟 | `/clock` | 时钟文字与样式；保存样式后更新 |
| 点歌板 | `/queue` | 当前队列；快照更新后曲名变化 |
| 加班机 | `/overtime` | 真实业务投影的倒计时；剩余时间更新 |
| 展示板 | `/songlist` | 合成歌单曲目 |
| 歌曲信息 | `/now-playing` | 当前曲名；无歌曲隐藏，刷新恢复当前曲目 |
| 直播歌词 | `/lyrics` | 当前歌词内容 |
| 直播小游戏 | `/games` | 当前数字炸弹局面 |
| 转盘 | `/wheel` | 当前选项 |
| 投票 / 评分 | `/interactions` | 当前投票选项；切换评分后显示最终均分；移除会话后清空 |
| 盲盒盈亏榜 | `/blindbox` | 合成观众与盈亏榜 |
| 滚动礼物 | `/gift-feed` | 合成送礼记录 |
| 礼物许愿 | `/gift-wishes` | 已保存许愿及进度 |
| 心动盲盒 | `/heart-box-collection` | 本期合成进度 |
| 月底冲刺 | `/gift-sprint` | 当前冲刺剩余数量 |
| 开播动画 | `/opening` | 启用后的标题与画面 |
| 全屏礼物 / 大航海感谢 | `/gift-effects` | 合成上舰事件；导入林间花信后视频实际播放 |

单图层补验：文本框显示自定义文字、背景显示已导入图片、林间花信视频实际播放、航海旗帜解码动画并显示合成昵称；每个输出只包含一份图层 iframe。复制、保存更新、尺寸和权限隔离由相关现有用例共同验证。

截图保留在仓库 `tmp/standalone-component-audit-ZhpGbS/`，其中 `component-contact-sheet.png` 汇总现代浏览器的 21 张独立截图；`single-gift-frame.png` 来自实际单图层播放，与固定地址的 `gift-frame.png` 分开取证。`v600-overtime-old-chromium-before.png` / `v600-overtime-old-chromium-after.png` 记录加班机修复前后；`interactions-old-chromium-after.png` 记录旧内核投票及 emoji 标题。截图及合成数据不进入版本库。

## 实施与验证

扩展 `test/overlays/component-source.test.js`，补上原先仅有时钟、队列、加班机和弹幕之外的固定来源集成覆盖，以及无动态视口单位时的可见高度回归。复用两份现有 fixture，将领域服务传给独立 HTTP 路由，并允许发送指定 WS 事件。测试中的服务上下文缺失是夹具限制，不是生产路径缺陷。

发现旧内核问题前，以下聚焦检查在现代浏览器 **94/94 通过，无跳过**，涵盖独立加载、刷新、业务空状态、复制地址、尺寸、素材和鉴权。这是调查基线，不代表最终修复的全部验收；未运行无关全量套件：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 `
  test/overlays/component-source.test.js `
  test/overlays/component-output-size.test.js `
  test/overlays/overlay-http-access.test.js `
  test/overlays/overlay-projection.test.js `
  test/transport/websocket-access-policy.test.js `
  test/scenes/woodland-style-package.test.js `
  test/gifts/guard-nautical-player.test.js `
  test/admin/component-preview-output.test.js `
  test/admin/canvas-browser-source.test.js `
  test/admin/canvas-text-box-picker.test.js `
  test/admin/canvas-gift-components.test.js `
  test/overlays/opening-independent-settings.test.js `
  test/lyrics/desktop-lyric-settings-runtime.test.js `
  test/games/games-overlay.test.js `
  test/games/interactions-overlay.test.js `
  test/games/wheel-overlay.test.js
```

最终四份生产修复后，直接受影响的检查 **40/40 通过，无跳过**；其中既有 Unicode 与设置测试仍验证合法 emoji、非法不可见字符及原子保存，未弱化预期：

```powershell
node --experimental-vm-modules --test --test-concurrency=4 `
  test/overlays/component-source.test.js `
  test/overlays/component-output-size.test.js `
  test/games/interactions-overlay.test.js `
  test/games/interaction-appearance.test.js `
  test/games/interactions.test.js `
  test/settings/settings-contract.test.js
```

实际 Chromium 106 另两轮各 **3/3 通过**：当前工作树的 17 个固定入口，以及隔离 6.0.0 应用四份修复后的 15 个入口。均包含投票转评分、emoji 标题及视口高度用例。

```powershell
node --require ./tmp/standalone-component-v600/use-chromium-106.cjs --experimental-vm-modules --test test/overlays/component-source.test.js
node --require ./tmp/standalone-component-v600/use-chromium-106.cjs --experimental-vm-modules --test tmp/standalone-component-v600/test/overlays/component-source.test.js
```

旧浏览器为 Google Chromium snapshot 1036745，运行时报告版本 `106.0.5249.0`；临时目录虽命名为 `chromium-107`，不能据此声称测试了 107。6.0.0 隔离用例由当前集成用例移除该版本尚未有的两条入口及对应歌曲信息生命周期检查，其余实际页面与服务端来自该 tag。

技术参考同步了高度单位兜底和互动文字的读写职责；组件使用指南、浏览器源提示和画布内置指南说明两种来源及实时数据条件。入口和操作本身没有变化，现有截图及交互导览无需更新。文档检查 10/10、页面组合检查 6/6、两份生产 JS 及三份测试文件语法检查通过。未提交、打包或发布。

本次持有的测试浏览器及 HTTP 夹具已关闭。清理本次 `tmp/standalone-component-audit-ZhpGbS/data` 的命令被执行策略拒绝，合成数据保留在该临时目录，未改用其他方式删除。6.0.0 源码快照、旧 Chromium 和测试截图也仅存于 `tmp/`。
