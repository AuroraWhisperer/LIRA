# 历史计划归档

本目录保存已完成或被后续规格、实施与现状参考替代的计划。文内行为、命令、代码路径和测试结果属于当时基线；归档本身不证明所有旧复选框都通过验收。未结项及需补证的工作统一见 [当前计划](../README.md) 和 [台账](../open-items.md)。

2026-09-28 的迁移为原 specs/plans 和 docs/superpowers/plans 中的每份计划补充状态、归档理由及当前 owner。历史 `[ ]` 保留原样，避免制造完成证据。

## 文件索引

- [2026-10-08-concurrent-test-stability](2026-10-08-concurrent-test-stability.md)（界面就绪、认证探针退出与导入重试断言修复；排除 DSH 范围后并发 8 的 3960 项测试全部通过）

- [2026-10-08-woodland-style-package](2026-10-08-woodland-style-package.md)（林间花信 1.0.0 外置 ZIP、原生客户端/画布布局和参数保留、打包素材清理；真实 Electron 导入与实际 ASAR 检查通过，未重建 NSIS 安装器）

- [2026-10-08-simple-style-import](2026-10-08-simple-style-import.md)（统一文件入口、自动识别粘贴内容及默认折叠设置；定向导入、隔离 Electron 与架构检查通过，记录既有 gift-frame 断言差异）

- [2026-10-08-ux-bug-fixes](2026-10-08-ux-bug-fixes.md)（歌曲保存草稿、自动跳过不可播歌曲、电台补歌归属与歌单高亮；98 项定向回归、10 项文档检查、语法与差异检查通过）

- [2026-10-08-release-journal-retry](2026-10-08-release-journal-retry.md)（迁移日志占用恢复、Windows 原生查询提速、发布夹具同步与 Node 环境纠正；3,899 项测试及完整发布门禁通过）

- [2026-10-08-client-ux-decisions](2026-10-08-client-ux-decisions.md)（下一首与导入身份、重启点歌恢复、礼物组合筛选、小游戏确认与存档恢复；定向自动化和隔离 Electron 检查通过，其余四项仅讨论）

- [2026-10-08-client-ux-fixes](2026-10-08-client-ux-fixes.md)（桌面与网页明确的编辑、焦点、保存和失败恢复修复；定向自动化与隔离 Electron 检查通过，产品规则单列待讨论，临时数据清理受自动审批限制）

- [2026-10-08-shared-canvas-appearance](2026-10-08-shared-canvas-appearance.md)（客户端/画布公共参数双向同步、已发布输出实时外观、独立空图片槽；定向回归、隔离 Electron、语法、架构和文档检查通过）

- [2026-10-08-opening-canvas-settings](2026-10-08-opening-canvas-settings.md)（画布开播参数、头像和音乐上传与客户端共享；接口权限、隔离桌面流程、双向同步、语法、架构及文档检查通过）

- [2026-10-08-resource-style-settings](2026-10-08-resource-style-settings.md)（配套样式功能页参数、默认值保存与航海旗帜独立控制；聚焦回归、隔离 Electron、语法、架构及文档检查通过）

- [2026-10-08-opening-style-settings](2026-10-08-opening-style-settings.md)（开播统一选择、内置独立配置与包参数；聚焦回归、隔离 Electron、语法与架构检查通过，记录工作区无关文档失败）

- [2026-10-08-canvas-concurrent-add](2026-10-08-canvas-concurrent-add.md)（修复并发新增图层、实例定位、Windows 素材锁定与测试端口竞态；3,830 项测试及统一发布校验通过）

- [2026-10-07-scene-preset-actions](2026-10-07-scene-preset-actions.md)（预设删除、直播源保护与操作延迟修复；聚焦回归、隔离 Electron 和 quick 门禁通过）

- [2026-10-07-canvas-guard-styles](2026-10-07-canvas-guard-styles.md)（画布辉光/经典独立卡片、持久化风格及事件隔离；聚焦测试与隔离 Electron 通过，记录无关检查和临时目录清理限制）

- [2026-10-07-suite-lifecycle](2026-10-07-suite-lifecycle.md)（套装整体管理、同包版本替换及旧场景资源保留；后端、界面与隔离 Electron 验证通过）

- [2026-10-07-current-test-failures](2026-10-07-current-test-failures.md)（修复过期夹具、预览同步、打包资源和重复标题；五个分组合计 3803 项通过，记录 Windows 临时文件占用现象）

- [2026-10-07-background-color-audit](2026-10-07-background-color-audit.md)（Shoost 参数来源核对、MIT 版 CAT02/LGG、旧样式兼容及背景美术工作流；像素、ZIP 和隔离桌面验收通过）

- [2026-10-07-code-document-alignment](2026-10-07-code-document-alignment.md)（区分实现偏差与文档滞后；修复刷新失败的账号/生命周期隔离，更新五份技术参考；273 项相关测试及文档/语法/架构检查通过，记录跨仓锁定检出限制）

- [2026-10-07-background-filters](2026-10-07-background-filters.md)（背景白平衡、分区调色、辉光、周边模糊、暗角、色阶、颗粒与 ZIP 参数合同；沙箱像素、视频连续播放、桌面保存及原色恢复通过，记录无关检查失败）

- [2026-10-07-nautical-guard-thanks](2026-10-07-nautical-guard-thanks.md)（航海旗帜三档动画、实时头像昵称、正式 ZIP 与客户端导入；隔离 Electron 保存应用及事件测试通过，本地安装包已生成，记录既有测试失败与临时目录清理限制）

- [2026-10-07-client-modularity-refactor](2026-10-07-client-modularity-refactor.md)（画布轮询与快照复用、选择器/粉丝编辑/IPC/互动状态职责拆分、退役入口清理；相关回归与架构门禁通过，记录全量原有失败及临时副本清理限制）

- [2026-10-07-component-style-parameters](2026-10-07-component-style-parameters.md)（9 款时钟及 16 款弹幕逐样式效果、导入能力边界、进房开关；桌面/浏览器和协议验收，记录无关检查限制；未部署）

- [2026-10-07-starlight-danmaku](2026-10-07-starlight-danmaku.md)（星语固定弹幕；普通消息、礼物与 SC，桌面/服务端渲染及契约验证通过，未部署）

- [2026-10-07-starveil-danmaku](2026-10-07-starveil-danmaku.md)（星幕浮语六色随机胶囊，62 项 Node 测试、4 项浏览器用例及隔离桌面保存回读验证）

- [2026-10-06-third-party-component-import](2026-10-06-third-party-component-import.md)（HTML/CSS 配套资源、浏览器地址统一导入；36 项新增测试与独立 Electron 验证，记录现有无关门禁失败）

- [2026-10-06-background-parameters](2026-10-06-background-parameters.md)（背景外观与视频参数、ZIP 默认快照、独立实例及桌面保存验证；记录两项无关门禁失败）

- [2026-10-06-comet-danmaku](2026-10-06-comet-danmaku.md)（彩色彗尾飘窗、完整离场、两端契约及桌面保存回读验证）

- [2026-10-06-random-danmaku-position](2026-10-06-random-danmaku-position.md)（区域随机中心倾向、离散程度、数学分布及两端保存/预览验证）

- [2026-10-06-floating-danmaku](2026-10-06-floating-danmaku.md)（飘窗弹幕、速率参数、全画布默认及两端配置与桌面保存验证）

- [2026-10-06-guard-thanks-settings](2026-10-06-guard-thanks-settings.md)（辉光/经典独立设置、紧凑布局、共用更多样式与旧配置兼容验证）

- [2026-10-06-preview-reuse](2026-10-06-preview-reuse.md)（已连接画布复用、组件定位确认、未保存草稿与关闭重开回归）

- [2026-10-06-external-moonlit-suite](2026-10-06-external-moonlit-suite.md)（月渡花汀外置 ZIP、默认入口与打包排除、隔离导入及渲染验证）

- [2026-10-06-component-styles](2026-10-06-component-styles.md)（本机素材、标准套装导入、七类组件适配与隔离验收）

- [2026-10-06-canvas-presets](2026-10-06-canvas-presets.md)（拖拽图层排序、多预设保留及单直播源显式应用）

- [2026-10-05-gift-sprint-canvas](2026-10-05-gift-sprint-canvas.md)（月底冲刺收进礼物许愿、画布组件与真实进度投影）

- [2026-10-05-moonlit-background-motion](2026-10-05-moonlit-background-motion.md)（浅色背景环境动效、静态/动态选项与实际视频预览）
- [2026-10-05-moonlit-background](2026-10-05-moonlit-background.md)（浅银蓝静态壁纸、套装与背景分类、画布置底和输出）
- [2026-10-05-component-suites](2026-10-05-component-suites.md)（画布月渡花汀套装入口与独立开播样式）
- [2026-10-05-danmaku-moonlit](2026-10-05-danmaku-moonlit.md)（弹幕染色、三档上任与礼物/SC 花枝卷轴；桌面与服务器同步）
- [2026-10-05-clock-moon-palettes](2026-10-05-clock-moon-palettes.md)（时钟深浅配色、固定选择与自动交替）
- [2026-10-05-gift-wish-moonlit](2026-10-05-gift-wish-moonlit.md)（月渡花汀礼物心愿装饰与动态进度）
- [2026-10-05-opening-moonlit-fan-revision](2026-10-05-opening-moonlit-fan-revision.md)（中等背景密度、15 秒往复动画）
- [2026-10-05-opening-moonlit-fan](2026-10-05-opening-moonlit-fan.md)
- [2026-10-05-remove-satin-ribbon](2026-10-05-remove-satin-ribbon.md)（删除完成）
- [2026-10-04-gift-frame-satin-ribbon](2026-10-04-gift-frame-satin-ribbon.md)（用户撤销样式）

- [2026-10-05-text-box-appearance](2026-10-05-text-box-appearance.md)
- [2026-10-05-scene-live-updates](2026-10-05-scene-live-updates.md)
- [2026-10-05-text-box](2026-10-05-text-box.md)
- [2026-10-05-canvas-browser-source](2026-10-05-canvas-browser-source.md)
- [2026-10-05-canvas-overflow](2026-10-05-canvas-overflow.md)
- [2026-10-04-verification-reuse](2026-10-04-verification-reuse.md)
- [2026-10-04-release-efficiency](2026-10-04-release-efficiency.md)
- [2026-10-04-architecture-audit-fixes](2026-10-04-architecture-audit-fixes.md)

- [2026-10-04-status-toast-completion](2026-10-04-status-toast-completion.md)
- [2026-10-04-shared-ui-fixes](2026-10-04-shared-ui-fixes.md)
- [2026-10-04-preview-session-renewal](2026-10-04-preview-session-renewal.md)
- [2026-10-04-canvas-opening](2026-10-04-canvas-opening.md)
- [2026-10-03-client-review-recovery-fixes](2026-10-03-client-review-recovery-fixes.md)
- [2026-10-03-client-theme-modularity](2026-10-03-client-theme-modularity.md)
- [2026-10-03-client-test-suite-review](2026-10-03-client-test-suite-review.md)
- [2026-10-03-client-test-scope](2026-10-03-client-test-scope.md)
- [2026-10-03-canvas-gift-components](2026-10-03-canvas-gift-components.md)
- [2026-10-03-test-assertion-resilience](2026-10-03-test-assertion-resilience.md)
- [2026-10-03-woodland-effect-one](2026-10-03-woodland-effect-one.md)
- [2026-10-03-gift-sprint-text](2026-10-03-gift-sprint-text.md)
- [2026-10-03-client-round-two-fixes](2026-10-03-client-round-two-fixes.md)
- [2026-10-02-compact-canvas-address](2026-10-02-compact-canvas-address.md)
- [2026-10-02-preview-links-lifecycle](2026-10-02-preview-links-lifecycle.md)
- [2026-10-02-release-5.0.14-validation](2026-10-02-release-5.0.14-validation.md)
- [2026-10-01-canvas-component-library](2026-10-01-canvas-component-library.md)
- [2026-10-01-canvas-component-boundaries](2026-10-01-canvas-component-boundaries.md)
- [2026-10-01-canvas-audit-fixes](2026-10-01-canvas-audit-fixes.md)

- [2026-10-01-preview-editable-refresh](2026-10-01-preview-editable-refresh.md)
- [2026-10-01-preview-draft-recovery](2026-10-01-preview-draft-recovery.md)
- [2026-10-01-component-output-size](2026-10-01-component-output-size.md)
- [2026-10-01-preview-connection-recovery](2026-10-01-preview-connection-recovery.md)
- [2026-10-01-release-5.0.13-validation](2026-10-01-release-5.0.13-validation.md)
- [2026-10-01-planner-reminders](2026-10-01-planner-reminders.md)
- [2026-10-01-performance-displays](2026-10-01-performance-displays.md)
- [2026-09-30-release-5.0.12-validation](2026-09-30-release-5.0.12-validation.md)
- [2026-09-30-component-source-directory](2026-09-30-component-source-directory.md)
- [2026-09-30-canvas-library-output](2026-09-30-canvas-library-output.md)
- [2026-09-30-shared-preview-canvas](2026-09-30-shared-preview-canvas.md)
- [2026-09-30-component-preview-layout](2026-09-30-component-preview-layout.md)
- [2026-09-30-browser-component-preview](2026-09-30-browser-component-preview.md)
- [2026-09-30-release-5.0.11-validation](2026-09-30-release-5.0.11-validation.md)
- [2026-09-30-component-preview](2026-09-30-component-preview.md)
- [2026-09-30-component-workspace](2026-09-30-component-workspace.md)

- [2026-09-29-release-5.0.10-validation](2026-09-29-release-5.0.10-validation.md)
- [2026-09-29-orbit-flip-clock](2026-09-29-orbit-flip-clock.md)
- [2026-09-29-release-5.0.9-validation](2026-09-29-release-5.0.9-validation.md)
- [2026-09-29-frontend-modularity](2026-09-29-frontend-modularity.md)
- [2026-09-29-superchat-overlay](2026-09-29-superchat-overlay.md)

- [2026-09-29-independent-live-monitoring](2026-09-29-independent-live-monitoring.md)
- [2026-09-29-song-request-blacklist](2026-09-29-song-request-blacklist.md)
- [2026-09-28-gift-wish-text-colors](2026-09-28-gift-wish-text-colors.md)
- [2026-09-28-danmaku-canvas](2026-09-28-danmaku-canvas.md)
- [2026-09-28-gift-wish-image-token](2026-09-28-gift-wish-image-token.md)
- [2026-09-28-gift-sse-commit](2026-09-28-gift-sse-commit.md)
- [2026-09-28-gift-wish-text-images](2026-09-28-gift-wish-text-images.md)
- [2026-09-28-danmaku-scroll-direction](2026-09-28-danmaku-scroll-direction.md)
- [2026-09-28-transport-reduction](2026-09-28-transport-reduction.md)

- [2026-09-28-opening-animation-refinement](2026-09-28-opening-animation-refinement.md)
- [2026-09-28-documentation-consolidation](2026-09-28-documentation-consolidation.md)

- [2026-08-16-ai-assisted-development-governance](2026-08-16-ai-assisted-development-governance.md)
- [2026-08-16-modularity-low-coupling-refactor](2026-08-16-modularity-low-coupling-refactor.md)
- [2026-08-17-desktop-lyric-local-font-library](2026-08-17-desktop-lyric-local-font-library.md)
- [2026-08-17-existing-code-governance-remediation](2026-08-17-existing-code-governance-remediation.md)
- [2026-08-17-model-provider-capabilities](2026-08-17-model-provider-capabilities.md)
- [2026-08-17-model-provider-presets](2026-08-17-model-provider-presets.md)
- [2026-08-17-p0-data-safety-correctness](2026-08-17-p0-data-safety-correctness.md)
- [2026-08-17-third-party-openai-api-compatibility](2026-08-17-third-party-openai-api-compatibility.md)
- [2026-08-18-admin-initialization-regression](2026-08-18-admin-initialization-regression.md)
- [2026-08-18-bilibili-room-identity](2026-08-18-bilibili-room-identity.md)
- [2026-08-18-desktop-lyric-render-budget-and-visible-lines](2026-08-18-desktop-lyric-render-budget-and-visible-lines.md)
- [2026-08-18-electron-local-overlay-open](2026-08-18-electron-local-overlay-open.md)
- [2026-08-18-first-run-onboarding](2026-08-18-first-run-onboarding.md)
- [2026-08-18-games-single-overlay-session](2026-08-18-games-single-overlay-session.md)
- [2026-08-18-live-games](2026-08-18-live-games.md)
- [2026-08-18-overtime-screen-fixes](2026-08-18-overtime-screen-fixes.md)
- [2026-08-18-usage-guide-main-flow-layout](2026-08-18-usage-guide-main-flow-layout.md)
- [2026-08-18-wesing-lyric-artist-match](2026-08-18-wesing-lyric-artist-match.md)
- [2026-08-19-contextual-dropdown-options](2026-08-19-contextual-dropdown-options.md)
- [2026-08-19-desktop-hardware-summary](2026-08-19-desktop-hardware-summary.md)
- [2026-08-19-game-winner-avatar](2026-08-19-game-winner-avatar.md)
- [2026-08-19-interactive-tour-copy](2026-08-19-interactive-tour-copy.md)
- [2026-08-19-interactive-tour-positioning](2026-08-19-interactive-tour-positioning.md)
- [2026-08-19-websocket-cleanup-race](2026-08-19-websocket-cleanup-race.md)
- [2026-08-19-wheel-game](2026-08-19-wheel-game.md)
- [2026-08-20-danmaku-draw-guess](2026-08-20-danmaku-draw-guess.md)
- [2026-08-20-draw-guess-configurable-rounds](2026-08-20-draw-guess-configurable-rounds.md)
- [2026-08-20-games-overlay-followups](2026-08-20-games-overlay-followups.md)
- [2026-08-20-hardcoded-contract-drift](2026-08-20-hardcoded-contract-drift.md)
- [2026-08-20-illustrated-queue-layering](2026-08-20-illustrated-queue-layering.md)
- [2026-08-20-illustrated-queue-responsive-scaling](2026-08-20-illustrated-queue-responsive-scaling.md)
- [2026-08-20-qq-encrypted-playback](2026-08-20-qq-encrypted-playback.md)
- [2026-08-20-qq-paid-playback-quality](2026-08-20-qq-paid-playback-quality.md)
- [2026-08-20-remove-claude-coauthor-history](2026-08-20-remove-claude-coauthor-history.md)
- [2026-08-20-song-board-style-3-layout-tuning](2026-08-20-song-board-style-3-layout-tuning.md)
- [2026-08-20-song-board-style-6-layout-tuning](2026-08-20-song-board-style-6-layout-tuning.md)
- [2026-08-20-song-board-style-6](2026-08-20-song-board-style-6.md)
- [2026-08-20-song-board-style-card-and-illustrated-options](2026-08-20-song-board-style-card-and-illustrated-options.md)
- [2026-08-20-song-board-styles-4-5](2026-08-20-song-board-styles-4-5.md)
- [2026-08-20-song-request-board-style-3](2026-08-20-song-request-board-style-3.md)
- [2026-08-21-bilibili-user-info-service](2026-08-21-bilibili-user-info-service.md)
- [2026-08-21-danmaku-bubble-feed](2026-08-21-danmaku-bubble-feed.md)
- [2026-08-21-desktop-lyric-auto-local-fonts](2026-08-21-desktop-lyric-auto-local-fonts.md)
- [2026-08-21-draw-guess-danmaku-identity](2026-08-21-draw-guess-danmaku-identity.md)
- [2026-08-21-game-winner-avatar-unification](2026-08-21-game-winner-avatar-unification.md)
- [2026-08-21-games-viewer-startup-race](2026-08-21-games-viewer-startup-race.md)
- [2026-08-21-gift-frame-overlay](2026-08-21-gift-frame-overlay.md)
- [2026-08-21-opening-overlay-refinement](2026-08-21-opening-overlay-refinement.md)
- [2026-08-21-opening-overlay](2026-08-21-opening-overlay.md)
- [2026-08-21-qq-music-login-state](2026-08-21-qq-music-login-state.md)
- [2026-08-21-song-board-local-font-library](2026-08-21-song-board-local-font-library.md)
- [2026-08-21-startup-performance-hardening](2026-08-21-startup-performance-hardening.md)
- [2026-08-21-streamer-workbench](2026-08-21-streamer-workbench.md)
- [2026-08-22-danmaku-tool-sections](2026-08-22-danmaku-tool-sections.md)
- [2026-08-22-desktop-lyric-low-power](2026-08-22-desktop-lyric-low-power.md)
- [2026-08-22-draw-guess-drawing-controls](2026-08-22-draw-guess-drawing-controls.md)
- [2026-08-22-img-asset-reorganization](2026-08-22-img-asset-reorganization.md)
- [2026-08-22-opening-animation-controls](2026-08-22-opening-animation-controls.md)
- [2026-08-22-opening-master-toggle](2026-08-22-opening-master-toggle.md)
- [2026-08-22-overtime-text-display](2026-08-22-overtime-text-display.md)
- [2026-08-22-select-menu-overflow-audit](2026-08-22-select-menu-overflow-audit.md)
- [2026-08-22-static-webp-packaging](2026-08-22-static-webp-packaging.md)
- [2026-08-23-all-song-board-proportional-scaling](2026-08-23-all-song-board-proportional-scaling.md)
- [2026-08-23-button-color-hierarchy](2026-08-23-button-color-hierarchy.md)
- [2026-08-23-clear-all-failure-recovery](2026-08-23-clear-all-failure-recovery.md)
- [2026-08-23-contextual-help-tooltips](2026-08-23-contextual-help-tooltips.md)
- [2026-08-23-cute-clock-card](2026-08-23-cute-clock-card.md)
- [2026-08-23-danmaku-identity-variants](2026-08-23-danmaku-identity-variants.md)
- [2026-08-23-danmaku-overlay-emotes](2026-08-23-danmaku-overlay-emotes.md)
- [2026-08-23-danmaku-style-switching](2026-08-23-danmaku-style-switching.md)
- [2026-08-23-draw-guess-categories-and-tools](2026-08-23-draw-guess-categories-and-tools.md)
- [2026-08-23-guard-gift-accounting-hardening](2026-08-23-guard-gift-accounting-hardening.md)
- [2026-08-23-opening-animation-motion-polish](2026-08-23-opening-animation-motion-polish.md)
- [2026-08-23-opening-track-motion](2026-08-23-opening-track-motion.md)
- [2026-08-23-overlay-runtime-pressure-fixes](2026-08-23-overlay-runtime-pressure-fixes.md)
- [2026-08-23-parameter-range-variants](2026-08-23-parameter-range-variants.md)
- [2026-08-23-queue-style-settings-isolation](2026-08-23-queue-style-settings-isolation.md)
- [2026-08-23-song-board-horizontal-scroll](2026-08-23-song-board-horizontal-scroll.md)
- [2026-08-24-current-backpack-gifts](2026-08-24-current-backpack-gifts.md)
- [2026-08-24-danmaku-overlay-style-4](2026-08-24-danmaku-overlay-style-4.md)
- [2026-08-24-packaged-main-navigation-track](2026-08-24-packaged-main-navigation-track.md)
- [2026-08-24-song-clip-column](2026-08-24-song-clip-column.md)
- [2026-08-24-song-request-price-column](2026-08-24-song-request-price-column.md)
- [2026-08-24-streamer-workbench-on-air-cues](2026-08-24-streamer-workbench-on-air-cues.md)
- [2026-08-24-toolbox-navigation-groups](2026-08-24-toolbox-navigation-groups.md)
- [2026-08-24-toolbox-sidebar-persistence](2026-08-24-toolbox-sidebar-persistence.md)
- [2026-08-25-opening-animation-startup-disabled](2026-08-25-opening-animation-startup-disabled.md)
- [2026-08-28-restore-legacy-gift-deduplication](2026-08-28-restore-legacy-gift-deduplication.md)
- [2026-08-29-bilibili-v2-gift-dedup](2026-08-29-bilibili-v2-gift-dedup.md)
- [2026-08-29-license-p0-hardening](2026-08-29-license-p0-hardening.md)
- [2026-08-29-remote-gift-catalog-sync](2026-08-29-remote-gift-catalog-sync.md)
- [2026-08-30-cloud-authoritative-streamer-sync](2026-08-30-cloud-authoritative-streamer-sync.md)
- [2026-08-30-danmaku-fullscreen-random](2026-08-30-danmaku-fullscreen-random.md)
- [2026-08-30-device-public-key-normalization](2026-08-30-device-public-key-normalization.md)
- [2026-08-30-overtime-room-and-server-gifts](2026-08-30-overtime-room-and-server-gifts.md)
- [2026-08-30-server-authoritative-gift-detection](2026-08-30-server-authoritative-gift-detection.md)
- [2026-08-31-runtime-correctness-remediation](2026-08-31-runtime-correctness-remediation.md)
- [2026-09-05-blind-box-catalog-update](2026-09-05-blind-box-catalog-update.md)
- [2026-09-05-call-chain-regressions](2026-09-05-call-chain-regressions.md)
- [2026-09-05-gift-catalog-background-updates](2026-09-05-gift-catalog-background-updates.md)
- [2026-09-05-local-gift-catalog-bootstrap](2026-09-05-local-gift-catalog-bootstrap.md)
- [2026-09-05-package-runtime-only](2026-09-05-package-runtime-only.md)
- [2026-09-05-packaged-media-slimming](2026-09-05-packaged-media-slimming.md)
- [2026-09-05-review-remediation](2026-09-05-review-remediation.md)
- [2026-09-05-server-backed-gift-artwork](2026-09-05-server-backed-gift-artwork.md)
- [2026-09-05-transparent-digital-clock](2026-09-05-transparent-digital-clock.md)
- [2026-09-05-workbench-calendar-notes](2026-09-05-workbench-calendar-notes.md)
- [2026-09-06-bilibili-login-gate](2026-09-06-bilibili-login-gate.md)
- [2026-09-07-cloud-song-sync-compatibility](2026-09-07-cloud-song-sync-compatibility.md)
- [2026-09-07-persistent-desktop-user-data](2026-09-07-persistent-desktop-user-data.md)
- [2026-09-08-gift-history-3x-sort-restore](2026-09-08-gift-history-3x-sort-restore.md)
- [2026-09-09-gift-sse-canonical-event-handoff](2026-09-09-gift-sse-canonical-event-handoff.md)
- [2026-09-09-gift-sync-silent-stream-recovery](2026-09-09-gift-sync-silent-stream-recovery.md)
- [2026-09-09-server-linked-gift-ledger-clear](2026-09-09-server-linked-gift-ledger-clear.md)
- [2026-09-10-project-review-fixes](2026-09-10-project-review-fixes.md)
- [2026-09-12-audit-follow-up](2026-09-12-audit-follow-up.md)
- [2026-09-12-blind-box-card-attribution](2026-09-12-blind-box-card-attribution.md)
- [2026-09-12-clear-all-writer-safety](2026-09-12-clear-all-writer-safety.md)
- [2026-09-12-gift-role-labels](2026-09-12-gift-role-labels.md)
- [2026-09-12-overtime-save-consistency](2026-09-12-overtime-save-consistency.md)
- [2026-09-12-playback-recovery](2026-09-12-playback-recovery.md)
- [2026-09-12-release-installer-build](2026-09-12-release-installer-build.md)
- [2026-09-12-remaining-audit-fixes](2026-09-12-remaining-audit-fixes.md)
- [2026-09-13-admin-device-authorization](2026-09-13-admin-device-authorization.md)
- [2026-09-13-admin-games-css-ownership](2026-09-13-admin-games-css-ownership.md)
- [2026-09-13-admin-overtime-css-ownership](2026-09-13-admin-overtime-css-ownership.md)
- [2026-09-13-admin-toast-css-ownership](2026-09-13-admin-toast-css-ownership.md)
- [2026-09-13-ai-assistant-service-test-ownership](2026-09-13-ai-assistant-service-test-ownership.md)
- [2026-09-13-ai-provider-adapters-test-ownership](2026-09-13-ai-provider-adapters-test-ownership.md)
- [2026-09-13-batch-b-modularity](2026-09-13-batch-b-modularity.md)
- [2026-09-13-batch-c-lifecycle-modularity](2026-09-13-batch-c-lifecycle-modularity.md)
- [2026-09-13-client-data-layout](2026-09-13-client-data-layout.md)
- [2026-09-13-client-server-only-gifts](2026-09-13-client-server-only-gifts.md)
- [2026-09-13-clock-overlay-css-ownership](2026-09-13-clock-overlay-css-ownership.md)
- [2026-09-13-cloud-room-account](2026-09-13-cloud-room-account.md)
- [2026-09-13-danmaku-admin-html-ownership](2026-09-13-danmaku-admin-html-ownership.md)
- [2026-09-13-danmaku-overlay-css-ownership](2026-09-13-danmaku-overlay-css-ownership.md)
- [2026-09-13-danmaku-overlay-test-ownership](2026-09-13-danmaku-overlay-test-ownership.md)
- [2026-09-13-desktop-lyric-css-ownership](2026-09-13-desktop-lyric-css-ownership.md)
- [2026-09-13-desktop-lyric-html-ownership](2026-09-13-desktop-lyric-html-ownership.md)
- [2026-09-13-desktop-lyric-renderer-ownership](2026-09-13-desktop-lyric-renderer-ownership.md)
- [2026-09-13-desktop-lyrics-test-ownership](2026-09-13-desktop-lyrics-test-ownership.md)
- [2026-09-13-frontend-admin-ai-test-ownership](2026-09-13-frontend-admin-ai-test-ownership.md)
- [2026-09-13-frontend-admin-shell-test-ownership](2026-09-13-frontend-admin-shell-test-ownership.md)
- [2026-09-13-frontend-gifts-test-ownership](2026-09-13-frontend-gifts-test-ownership.md)
- [2026-09-13-frontend-overtime-test-ownership](2026-09-13-frontend-overtime-test-ownership.md)
- [2026-09-13-frontend-queue-test-ownership](2026-09-13-frontend-queue-test-ownership.md)
- [2026-09-13-games-overlay-css-ownership](2026-09-13-games-overlay-css-ownership.md)
- [2026-09-13-gift-identity-overtime](2026-09-13-gift-identity-overtime.md)
- [2026-09-13-gift-query-service-test-ownership](2026-09-13-gift-query-service-test-ownership.md)
- [2026-09-13-install-local-data](2026-09-13-install-local-data.md)
- [2026-09-13-installer-error-reporting](2026-09-13-installer-error-reporting.md)
- [2026-09-13-license-manager-test-ownership](2026-09-13-license-manager-test-ownership.md)
- [2026-09-13-modularity-size-governance](2026-09-13-modularity-size-governance.md)
- [2026-09-13-official-blind-box-mappings](2026-09-13-official-blind-box-mappings.md)
- [2026-09-13-opening-overlay-test-ownership](2026-09-13-opening-overlay-test-ownership.md)
- [2026-09-13-overtime-service-test-ownership](2026-09-13-overtime-service-test-ownership.md)
- [2026-09-13-parallel-js-check](2026-09-13-parallel-js-check.md)
- [2026-09-13-playback-fullscreen-css-ownership](2026-09-13-playback-fullscreen-css-ownership.md)
- [2026-09-13-playback-player-css-ownership](2026-09-13-playback-player-css-ownership.md)
- [2026-09-13-processed-gift-import-test-ownership](2026-09-13-processed-gift-import-test-ownership.md)
- [2026-09-13-remote-catalog-cache-test-ownership](2026-09-13-remote-catalog-cache-test-ownership.md)
- [2026-09-13-remote-gift-controller-test-ownership](2026-09-13-remote-gift-controller-test-ownership.md)
- [2026-09-13-remote-license-sse-test-ownership](2026-09-13-remote-license-sse-test-ownership.md)
- [2026-09-13-remove-client-gift-detector](2026-09-13-remove-client-gift-detector.md)
- [2026-09-13-review-cleanup](2026-09-13-review-cleanup.md)
- [2026-09-13-song-import-update](2026-09-13-song-import-update.md)
- [2026-09-13-song-request-metadata](2026-09-13-song-request-metadata.md)
- [2026-09-13-toolbox-sidebar-test-ownership](2026-09-13-toolbox-sidebar-test-ownership.md)
- [2026-09-13-uninstall-data-choice](2026-09-13-uninstall-data-choice.md)
- [2026-09-13-wesing-capture-test-ownership](2026-09-13-wesing-capture-test-ownership.md)
- [2026-09-14-danmaku-gift-notices](2026-09-14-danmaku-gift-notices.md)
- [2026-09-14-installer-auto-close](2026-09-14-installer-auto-close.md)
- [2026-09-14-log-volume-phase-a1](2026-09-14-log-volume-phase-a1.md)
- [2026-09-14-toast-fixes](2026-09-14-toast-fixes.md)
- [2026-09-15-client-scrollbar-completion](2026-09-15-client-scrollbar-completion.md)
- [2026-09-15-gift-interaction-controls](2026-09-15-gift-interaction-controls.md)
- [2026-09-16-account-overlay-access](2026-09-16-account-overlay-access.md)
- [2026-09-16-blind-box-catalog-exclusions](2026-09-16-blind-box-catalog-exclusions.md)
- [2026-09-16-client-efficiency-boundaries](2026-09-16-client-efficiency-boundaries.md)
- [2026-09-16-client-response-boundaries](2026-09-16-client-response-boundaries.md)
- [2026-09-16-client-server-audit-fixes](2026-09-16-client-server-audit-fixes.md)
- [2026-09-16-cream-danmaku-style](2026-09-16-cream-danmaku-style.md)
- [2026-09-16-dynamic-lottery-ui](2026-09-16-dynamic-lottery-ui.md)
- [2026-09-16-gift-category](2026-09-16-gift-category.md)
- [2026-09-16-local-danmaku-preview](2026-09-16-local-danmaku-preview.md)
- [2026-09-16-pinned-server-contract-ci](2026-09-16-pinned-server-contract-ci.md)
- [2026-09-16-restore-identity-danmaku](2026-09-16-restore-identity-danmaku.md)
- [2026-09-16-server-danmaku-settings](2026-09-16-server-danmaku-settings.md)
- [2026-09-17-audit-confirmed-boundaries](2026-09-17-audit-confirmed-boundaries.md)
- [2026-09-17-classic-streamer-color](2026-09-17-classic-streamer-color.md)
- [2026-09-17-glow-danmaku-style](2026-09-17-glow-danmaku-style.md)
- [2026-09-17-pk-opponent-report](2026-09-17-pk-opponent-report.md)
- [2026-09-17-queue-random-request](2026-09-17-queue-random-request.md)
- [2026-09-17-song-request-diagnostics](2026-09-17-song-request-diagnostics.md)
- [2026-09-17-viewer-welcome](2026-09-17-viewer-welcome.md)
- [2026-09-18-current-review-remediation](2026-09-18-current-review-remediation.md)
- [2026-09-18-daily-bots-direct-start](2026-09-18-daily-bots-direct-start.md)
- [2026-09-18-fan-guard-roster](2026-09-18-fan-guard-roster.md)
- [2026-09-18-gift-history-amount-filter](2026-09-18-gift-history-amount-filter.md)
- [2026-09-18-live-gift-display-export](2026-09-18-live-gift-display-export.md)
- [2026-09-18-overlay-access-decision](2026-09-18-overlay-access-decision.md)
- [2026-09-18-overlay-access-isolation](2026-09-18-overlay-access-isolation.md)
- [2026-09-18-release-4.2.5-validation](2026-09-18-release-4.2.5-validation.md)
- [2026-09-18-release-4.2.6-validation](2026-09-18-release-4.2.6-validation.md)
- [2026-09-18-settings-room-profile](2026-09-18-settings-room-profile.md)
- [2026-09-18-viewer-welcome-attention](2026-09-18-viewer-welcome-attention.md)
- [2026-09-19-continuous-gift-feed](2026-09-19-continuous-gift-feed.md)
- [2026-09-19-danmaku-overlay-filters](2026-09-19-danmaku-overlay-filters.md)
- [2026-09-19-fan-guard-identity](2026-09-19-fan-guard-identity.md)
- [2026-09-19-fan-profile-session-renewal](2026-09-19-fan-profile-session-renewal.md)
- [2026-09-19-fan-profiles-refinement](2026-09-19-fan-profiles-refinement.md)
- [2026-09-19-gift-assistant-settings](2026-09-19-gift-assistant-settings.md)
- [2026-09-19-gift-banner-profile-and-width](2026-09-19-gift-banner-profile-and-width.md)
- [2026-09-19-gift-card-aggregation](2026-09-19-gift-card-aggregation.md)
- [2026-09-19-query-optimization](2026-09-19-query-optimization.md)
- [2026-09-19-release-4.2.7-validation](2026-09-19-release-4.2.7-validation.md)
- [2026-09-19-release-4.2.8-validation](2026-09-19-release-4.2.8-validation.md)
- [2026-09-19-release-4.2.9-validation](2026-09-19-release-4.2.9-validation.md)
- [2026-09-19-transparent-gift-total](2026-09-19-transparent-gift-total.md)
- [2026-09-20-danmaku-emote-kinds](2026-09-20-danmaku-emote-kinds.md)
- [2026-09-20-danmaku-local-fonts](2026-09-20-danmaku-local-fonts.md)
- [2026-09-20-danmaku-style-parameters](2026-09-20-danmaku-style-parameters.md)
- [2026-09-20-danmaku-text-color](2026-09-20-danmaku-text-color.md)
- [2026-09-20-fan-profile-daily-update](2026-09-20-fan-profile-daily-update.md)
- [2026-09-20-gift-avatar-recovery](2026-09-20-gift-avatar-recovery.md)
- [2026-09-21-fan-favorites-names](2026-09-21-fan-favorites-names.md)
- [2026-09-21-gift-feed-minimum-amount](2026-09-21-gift-feed-minimum-amount.md)
- [2026-09-21-interaction-appearance](2026-09-21-interaction-appearance.md)
- [2026-09-21-review-bug-fixes](2026-09-21-review-bug-fixes.md)
- [2026-09-21-test-suite-maintenance](2026-09-21-test-suite-maintenance.md)
- [2026-09-22-client-server-file-splitting](2026-09-22-client-server-file-splitting.md)
- [2026-09-26-blindbox-analysis-dates](2026-09-26-blindbox-analysis-dates.md)
- [2026-09-26-client-audit-closeout](2026-09-26-client-audit-closeout.md)
- [2026-09-26-fan-profile-archive-recovery](2026-09-26-fan-profile-archive-recovery.md)
- [2026-09-26-release-5.0.5-validation](2026-09-26-release-5.0.5-validation.md)
- [2026-09-26-release-5.0.6-validation](2026-09-26-release-5.0.6-validation.md)
- [2026-09-27-release-5.0.7-validation](2026-09-27-release-5.0.7-validation.md)
- [2026-09-28-dead-code-cleanup](2026-09-28-dead-code-cleanup.md)
- [2026-09-28-format-and-split](2026-09-28-format-and-split.md)
- [2026-09-28-release-5.0.8-validation](2026-09-28-release-5.0.8-validation.md)
- [2026-09-28-repository-naming](2026-09-28-repository-naming.md)
- [2026-09-28-test-directory-layout](2026-09-28-test-directory-layout.md)
- [2026-09-28-test-suite-recovery](2026-09-28-test-suite-recovery.md)
- [clock-stable-url](clock-stable-url.md)
- [gift-effect-code-commands](gift-effect-code-commands.md)
- [gift-effect-danmaku](gift-effect-danmaku.md)
- [gift-wish-display-styles](gift-wish-display-styles.md)
- [gift-wishes](gift-wishes.md)

- [2026-10-07-sketch-danmaku](2026-10-07-sketch-danmaku.md)（绿萌简笔画、主题换色、两端样式与隔离浏览器验证；记录并行 styleParameters 文档检查失败）
