# 心动盲盒素材与奖励显隐

Status: Completed

## Goal

使用实际心动盲盒与浪漫城堡静态图片，按用户截图恢复粗轨道、圆形节点及奖励卡，并允许隐藏倍率与限开数量。

## Current Behavior / Ownership

`public/js/shared/heart-box-collection.js` 与对应 CSS 被管理页、独立源和画布共用。当前缺失礼物素材时显示通用 SVG，轨道过细；紧凑样式固定隐藏奖励。场景字段由 `shared/scene-extra-components.js` 声明，通用场景验证负责保存。

## Scope And Compatibility

只调整该组件的素材和展示参数。保持每周计数、四档奖励、授权与来源隔离。`showRewards` 是布尔展示参数，默认显示；旧配置通过既有默认值补齐，无数据库迁移。两种样式都服从显式开关。用户提供的截图是本次视觉依据。

## Resource Delivery

两张图片只供心动收集组件使用，取自既有礼物目录记录的 B 站素材，转为透明、单帧 WebP，随本地组件打包；不新增启动下载或远程运行时依赖。素材来源、摘要与转换方式记录在同目录清单。

## Milestones

- [x] 下载并核对实际礼物图片，生成本地静态 WebP；检查画面、尺寸与帧数。
- [x] 调整共享 renderer/CSS；`showRewards` 贯通场景配置、独立 URL 和管理页开关。验证关掉后奖励及提示里的倍率均隐藏，保留进度。
- [x] 扩展现有画布用例验证开关、保存和正式输出；验证旧配置读取，隔离 Electron 查看真实素材与参考结构。
- [x] 更新组件参考、页面参考、来源指南与内置指南截图；运行文档门禁、聚焦测试、语法及最终 diff/status 检查。

## Verification

`node --test test/scenes/scene-extra-components.test.js`；`node --test --test-name-pattern="heart-box collection" test/admin/canvas-gift-components.test.js`；`node --test test/gifts/heart-box-collection.test.js`；`npm run verify:docs`。隔离 Electron 验证管理预览、粉/深色进度、开关及源 URL；图片加载成功且四档使用同一城堡图。临时数据与截图仅放在 `tmp/heart-box-collection-qa/`。

## Failure Handling / Done When

失败时保留运行证据，只撤销本次拥有的改动，不覆盖其他会话变更。四项用户要求可在实际渲染中观察，聚焦检查通过，相关文档同步，最终 diff 无运行数据；关闭自有 QA 进程后完成。

## Results And Limits

- 实际 B 站心动盲盒与浪漫城堡图片匹配既有目录摘要，各转为 140×140 透明单帧 WebP，约 4.7KB / 7.6KB；四档共用同一城堡。来源清单沿用现有 `sources.json` 打包排除规则，图片随本地组件交付，无启动下载。
- 计数及场景配置 24 项通过；画布端到端用例通过，覆盖开关、两种样式、保存 false、正式输出及独立 URL。最终提示简化后再次运行该用例通过；不累计为新用例。
- 隔离 Electron 真实 Admin / preload 中素材加载正常；管理页关闭奖励后卡高从 267 降至 176，复制地址跟随参数。620px 紧凑源无横向溢出，显式开启恢复四档奖励。周五保留 37、周六新期为 0，页面异常为空。自有 Electron 与本地服务已关闭，合成数据及截图留于 git-ignore 的 tmp。
- 相关前端 5 文件语法及 `git diff --check` 通过。文档门禁 9/10：本计划漏状态已修正，剩余失败为预先存在、其他会话正在维护的 `2026-11-06-standalone-component-sources.md` 缺当前状态；未修改该计划。其余链接、路由、规格等门禁通过。
- 技术参考、页面参考、来源指南和内置指南及截图同步；后端规则与 API 字段不变，后端参考无需改写；README / 导览入口及操作顺序不变，无需额外编辑。保留同工作区其他任务的全部改动；未提交、打包或发布，也未使用真实礼物数据或实际直播间。
