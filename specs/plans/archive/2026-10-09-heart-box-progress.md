# 心动盲盒进度与紧凑榜单

Status: Completed

## 目标与边界

勾选「仅显示心动盲盒」后展开紧凑设置，在同一直播画面显示「今天 N 倍堡」「还有 N 个堡」和自动计算的「已开 X 个盲盒」。只识别心动盲盒开出的浪漫城堡；不改变礼物账本、盈亏计算、账号隔离或远程服务。

「还有 N 个堡」按手动输入显示，不自动扣减；倍数留空时隐藏，剩余数与已开盒数各有独立显示开关。显示配置沿用既有 settings 存储。统计当天有效心动盲盒的数量；未出堡取今日累计，出堡后从最后一个堡之后重新累计，不包含开出城堡的那盒。日期沿用现有本地盲盒统计日界。

## 现状与归属

- `blind-box-analysis.js` / `gift-query-store.js` 拥有按来源隔离的当日统计；盈亏未知行目前不参与盈亏汇总，进度应独立包含已确认的心动盲盒。
- `settings-defaults.js` / `settings-contract.js` 拥有默认值及服务端校验；`overlay-projection.js` 仅投影公开字段。
- `settings-blindbox.js`、礼物页与 `blindbox-broadcast.css` 拥有客户端编辑；`scene-extra-components.js` / `scene-shared-appearance.js` 拥有画布参数同步。
- `overlays/blindbox.js` / CSS 拥有直播渲染，画布预览使用同一渲染器与既有示例数据。

## 实施与验证

- [x] 扩展既有查询和统计，返回心动盲盒进度；测试来源、日期、礼物身份、数量、乱序与重复导入、出堡重置、未知盈亏。
- [x] 新增可空倍数/剩余数和显示开关，验证默认值、非法值、保存及画布往返；旧设置与旧 URL 继续可读。
- [x] 条件展开客户端设置，压缩榜单标题与盈亏到两行，将活动信息放在榜单顶部细分隔栏；配置与数据更新不会重建无变化的榜单。
- [x] 更新统计与存储契约、叠加层说明和使用指南/截图；在隔离 Electron 与浏览器源验证开关、保存、预览、零值、窄画面与顶部密度。
- [x] 运行直接影响的 gifts/settings/scenes/overlay 测试，`npm run verify:docs`、`npm run verify:architecture`、`npm run verify:contracts`、语法检查与 `git diff --check`；只按具体失败扩大验证。

## 兼容与失败处理

无新表或迁移，新增设置默认不显示新信息。固定浏览器源地址、显式旧 URL 参数、主题与排行参数继续有效。统计只新增公开数值，不暴露身份或原始记录；不依赖展示端记忆计数，重启后从账本恢复。保留工作区既有改动，不提交或执行破坏性回滚。

## 完成条件

客户端勾选与画布参数保持同步；榜单显示输入的倍数、剩余数和准确进度，可隐藏；顶部紧凑无重复内容；相关验证通过且文档同步，最终差异仅涉及本任务。

## 验证与保留原因

保留手动剩余堡数的产品解释，以及真实身份、事件顺序和展示同步的验收证据。当前事实由[礼物统计](../../../docs/reference/backend/bilibili/gift.md)、[设置存储](../../../docs/reference/backend/storage.md)和[盲盒叠加层](../../../docs/reference/frontend/overlays.md#5-盲盒叠加层blindbox)维护。

- 直接测试通过：`gift-analysis-service`、`frontend-blindbox-overlay`、`frontend-blindbox-admin`、`frontend-blindbox-mapping-refresh`、`settings-contract`、`shared-appearance`、`overlay-projection`、`scene-extra-components`、`blind-box-analysis-dates`、`runtime-event-publication`、`overlay-state-ordering`；最终 renderer 与使用指南检查共 25 项通过。
- 架构检查 26 项通过；文档检查 10 项通过；11 个受影响 JavaScript 模块通过语法检查；`git diff --check` 通过。未跑全量套件。
- 默认服务器工作区 HEAD 与客户端锁定版本不同，因此在仓库 `tmp/` 创建锁定提交 `01fb2b47d5e081f5dd559933991ade4819eb3428` 的 detached worktree；10 个契约夹具通过后已移除，不改变用户服务器检出或锁文件。
- 使用真实 Electron preload/授权流程的隔离实例及实际 `/blindbox` 浏览器源验证：12 盒 → 出浪漫城堡后 0 → 再开 7 盒后 7；剩余数保持 3。倍数清空隐藏、画布修改回传客户端和投屏、独立开关及剩余数 0 均生效。
- 展开设置时客户端两卡高度相同（约 376px）；360px 宽源的内容宽与滚动宽均为 344px。最终截图已同步使用指南及组件缩略图。静态设计检测器对透明 overlay 的底色推断不适用，实际深色画面前景 `#fff7fb`、背景 `#181823` 清晰可读。
- 测试全用合成数据，未连接真实直播间；隔离 Electron 与浏览器进程已关闭。仅该工具的临时数据和截图保留在被忽略的 `tmp/blindbox-layout-qa/`。
- README 与交互导览没有重复描述本次控件，不改动；使用指南已同步入口、操作、计数规则与截图。
