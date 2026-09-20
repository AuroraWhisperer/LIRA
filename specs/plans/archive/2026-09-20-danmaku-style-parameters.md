# 弹幕姬按样式调参实施计划

状态：已完成（2026-09-20），未提交、未部署。

## Goal

将用户黑名单和敏感词屏蔽放在直播链接与样式选择之间；原屏蔽位置改为当前样式的参数区。调整可预览、显式应用、回读，并同步到服务器 OBS 页面。

## Current behavior and ownership

- 客户端 `public/pages/admin/toolbox/danmaku.html` / `public/js/admin/danmaku-overlay-settings.js` 管理草稿，Electron `src/electron/ipc/license-ipc.js` 校验并透传认证请求。
- 服务器 `D:/Work/lira-server/src/modules/streamer/overlay-settings.js` 拥有租户 `danmakuOverlay` 配置，现有 `style` 和 `fullscreenDurationSeconds` 经同一 SSE 发布；`public/overlay/app.js` 消费正式配置。
- 本地 `public/js/overlays/danmaku.js` 提供离线静态预览，两个仓库已有独立发布的共享 renderer 与样式。
- 礼物由现有 final 事件投影；图片地址从已有礼物展示资料提取，受信 CDN 地址直接交浏览器读取。

## Decisions and compatibility

- 增量增加可选 `styleOptions`，按九种样式存储稀疏参数；旧请求省略该字段时保留已有参数，旧记录使用原样式默认值。
- 全部样式可选字体和正文字号，字号范围随布局限制不同；有底色的七种样式支持背景不透明度，蝴蝶结与透明文字不显示该项。蝴蝶结与流光气泡没有礼物插画位，其余样式可选 `theme` / `gift`。
- 字体仅预设系统字体；默认正文 30px、背景强度 100%、原样式插画。字体与字号不缩放头像；背景不透明度不降低正文或头像的不透明度。
- 全屏停留时间继续使用原有 2–30 秒配置，移入参数区。
- 新 `giftImageUrl` 是可选公开展示字段，只允许 HTTPS B 站 CDN、无凭据、no-referrer；图片不存在或加载失败使用样式插画。预览使用内置合成礼物示例，不产生外部请求。
- 保留认证、租户选择、密钥链接、礼物结算和已有 Electron 通道。已有未提交的 ranked 样式、gift-banner、测试、需求文档和图片文件改动不回滚。
- 不改变其他工具 UI、数据库 schema、礼物检测规则或发布部署流程；不提交、不创建分支。

## Milestones and verification

- [x] 增加参数契约并接通服务器配置、认证 IPC、初始 SSE 和在线更新。验证旧配置、范围拒绝、原子失败、租户隔离与旧客户端保存。
- [x] 调整客户端布局，维护各样式草稿，预览携带全部参数。验证样式切换记忆、错误保留草稿、迟到响应、账户切换和屏蔽顺序。
- [x] 两端渲染接入字体、字号、底色和礼物图片回退。验证真实页面模块、纯离线预览和受信图片投影。
- [x] 同步 requirement / acceptance / OpenAPI / fixture / 归属文档，执行定向测试、契约和架构检查，做一次合成页面检查。

运行客户端 `node --experimental-vm-modules --test`，限定 `server-danmaku-settings`、`danmaku-overlay-ipc`、`danmaku-local-preview`、`danmaku-overlay-renderer`、`danmaku-snapshot-stability`、`danmaku-style-ownership`、`frontend-danmaku-overlay-filters` 和新增参数测试；执行 `npm run check`、`npm run verify:architecture`、`npm run verify:docs`。

服务器使用 `node --require ./test/support/test-mode.cjs --test`，限定 overlay settings/service/routes、public SSE、gift、preview、static、protocol 及 architecture/documentation governance 测试。所有测试使用合成数据或临时数据库。

最后检查两个仓库的任务 diff、`git diff --check`、`git status --short`。只修正本次范围内缺陷。

## Verification results and discoveries

- 客户端定向 47 项测试通过；最终参数能力与字体调整后，受影响子集 27 项再次通过。`npm run check` 检查 921 个文件通过，`npm run verify:architecture` 22 项与 `npm run verify:docs` 5 项通过。
- 服务器配置、路由、SSE、礼物投影、图片、预览、静态资源、协议与治理检查已执行；旧协议字段断言随新契约更新后，最终受影响子集 31 项通过。
- 服务器 `npx playwright test e2e/overlay-style-options.spec.js` 通过：真实资源覆盖七种背景、文字字体/字号、图片直读和失败回退、大字号礼物布局。使用合成请求和临时数据，不访问 B 站。
- 管理页在隔离 Electron 43 测试壳内检查布局及参数交互，桥接数据为模拟值；本地预览检查使用内置素材。此证据不代表已验证用户实际授权会话或 B 站网络连通性。
- 检查中修复两端 feed 未转交礼物图解析器、样式选择器误匹配正文、透明文字大字号挤压礼物名。流光气泡无插画位，因此不提供礼物图片选项。
- 当前 Electron 与浏览器测试会话已正常关闭。清理早前残留 Electron 进程和 `C:/Users/Tom/AppData/Local/Temp/lira-danmaku-parameters-20260920` 测试目录的命令被系统策略拒绝（`blocked by policy`），这些残留保留；未操作用户正在运行的应用。
- 两端使用同一参数契约，分别部署的浏览器与 Node 模块由定向测试验证一致；生效需要一起更新客户端和服务器。

## Failure handling and done when

保存失败保留草稿，未应用编辑不改变直播画面；缺少新能力的旧服务器明确提示需要更新。若需回退，只反向移除本任务的 hunk，保留先前修改。完成条件：布局顺序正确，各样式参数可单独保存、预览与正式页面一致，CDN 图片失败回退，相关检查通过或明确记录环境限制。
