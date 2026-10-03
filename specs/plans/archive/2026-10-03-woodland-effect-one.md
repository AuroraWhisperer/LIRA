# 特效 1 · 林间花信接入

Status: Completed

完成日期：2026-10-03。用户确认的 v4 已接入客户端，全部里程碑完成；本记录归档。

## Goal / Current behavior

将用户确认的 v4 透明森林动画替换旧静态边框，命名为“特效 1 · 林间花信”。旧实现由静态 WebP、分散挂饰、分段 WAAPI 与一次性粒子组成；旧队列最多等待 3 条并按金额替换，已不符合本次按序完整播放要求。

## Ownership / Compatibility

- `public/js/overlays/gift-effects-frame.js` 负责特效 1 的视频与动态文字；`gift-effects.js` 负责事件接入；独立队列模块负责串行、去重和释放。
- `public/js/admin/gift-frame.js` 与 `public/pages/admin/toolbox/gift.html` 负责特效 1 的设置。沿用 `giftFrameEnabled`、`giftFrameThresholdRmb` 的持久化值，这两个键只属于特效 1。后续特效独立定义自己的参数，不引入空白占位或通用参数编辑器。
- `src/bilibili/gift/frame-config.js` 保持最终礼物金额判定和稳定事件 ID；`themeId: woodland-bloom` 保持事件身份。预览不再要求金额，旧金额若提供仍校验；废弃 motion 不再影响播放。
- 移除旧主题/动效默认值与界面；数据库历史键保留但不读取、不投影、不再允许新写入。无迁移、无真实数据变更。
- 不改变 `/gift-effects`、认证、官方礼物特效、大航海感谢与其它并行工作。只为公开 `.webm` 静态资源支持 Range，以便视频可靠重播。

## Changes / milestones

1. 接入 1920×1080 / 30fps / 4s 透明视频，文字与画布等比缩放，0.6s 入场 + 3s 完整展示 + 0.4s 退场。先保留已确认原始导出质量；检查体积优化是否保持透明安全区。
2. 自定义特效 FIFO 队列：1 条播放 + 最多 50 条等待（按用户后续明确要求），满时忽略新条目；已排队项不因等待时间丢弃；重复事件去重。当前不打断，结束/失败后清理并推进；关闭页面释放资源。异常加载或停滞有超时，正常播放不被加载耗时截断。
3. 更新特效 1 卡片、参数、默认值/投影、接口与实施参考。预览使用昵称、礼物名、数量。
4. 聚焦测试和隔离运行时验证，通过后归档本计划。

## Verification / Done when

- `node --experimental-vm-modules --test`：frame config/admin/draft/controller/queue、gift-effects overlay、guard thanks、overlay projection、runtime publication 相关测试。
- HTTP 实测 WebM 完整/范围/HEAD/越界响应；实际浏览器播放验证透明、时长、等比缩放、长文字、连续队列、失败清理、重复播放。
- 隔离 Electron 管理页验证特效 1 命名、保留参数、保存和预览请求；不用真实数据库。
- 更新对应 API/WS/storage/frontend 文档及原设计修订。审查任务相对基线 diff、`git diff --check`、`git status --short`；保留全部无关修改。

## Non-goals / Failure handling

不实现未来特效、不发布安装包、不重启用户桌面。失败时清空当前视频和文字，继续待播队列；仅回退本任务修改，不执行广泛 Git 回滚。临时素材、QA 与原始分层交付保留在 `tmp/woodland-bloom-preview/`。

## Results

- 素材使用用户确认的原始透明导出（64,134,643 字节）。尝试有损压缩时发现 Alpha 安全区产生少量非零像素，因此未采用压缩版本。实际 production WebM 解码 120 帧，中央安全区、首帧、末帧的非透明像素均为 0，与确认版像素一致。原分层交付仍在 tmp。
- 新播放器按媒体时间绘制两行 DOM 文字；统一 16:9 坐标，960×540 和 1000×1000 视口验证通过。长昵称/礼物名不会越出铭牌，8 位数量完整保留。结束截图全画布 Alpha 为 0。
- 50 条等待队列的满队列、FIFO、重复 ID、失败推进、取消由自动化验证；浏览器实际播放 3 条同时/中途追加事件，每条 4 秒，没有重复或重叠。累计 600 个视频帧的 QA 采样为 2 个 dropped frames，不宣称零掉帧。独立模拟 404 后，下一条恢复正常播放。
- 隔离 Electron 使用真实 preload、桌面请求认证与当前设置/预览路由，验证特效 1 显示、开关启停、阈值保存、预览文案/数量、关闭实时开关仍可手动预览、打开预览地址。测试只操作内存状态；验证进程已关闭。更新了使用说明和对应面板截图。
- 自动化：`node --experimental-vm-modules --test` 的 frame config/admin/draft/controller/queue、gift-effects overlay、static-video、governance-docs 共 34 项；guard-thanks、frontend guard-thanks、overlay projection/HTTP access、runtime publication、gift-display-settings 共 39 项；module-boundaries、esm-module-boundaries、modularity-size、frontend-usage-guide 共 37 项，全部通过。最后加载计时修订单独重跑 controller 3 项通过。
- 触及 JavaScript 语法检查和 `git diff --check` 通过；已审阅相对任务开始时快照的差异与工作区状态，保留并行工作。没有写入客户端真实数据、提交或发布。
- 证据：`tmp/woodland-effect-integration/` 下的 `media-verification.json`、`runtime-results.json`、`failure-recovery.json`、`admin-toggle.json`、截图和测试日志。客户端需重新启动加载后端改动；OBS/直播姬仍使用原 `/gift-effects` 地址，刷新浏览器源加载新版资源。本次未启动真实 OBS/直播姬或生成安装包。
