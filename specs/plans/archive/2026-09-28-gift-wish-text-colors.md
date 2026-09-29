# 礼物许愿文字状态色与自定义

**Status:** Completed

## 目标与边界

文字版许愿采用研究后选定的两种默认色，并按每条许愿保存「今天未收到」「今天已收到」自定义颜色。保留北京时间今日判定、图片标记、计数、卡片/徽章和 OBS 授权行为，不增加依赖或新配置系统。

## 依据与当前归属

[W3C 文字对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)要求普通文字 4.5:1、大字 3:1，并说明描边对可读性的影响；[Atlassian color roles](https://atlassian.design/foundations/color/)区分信息与成功等语义。本次具体色值由项目选择，并非规范指定：未收雾蓝 `#3b6ea8`、已收翠绿 `#21815c`，相对现有描边 `#fffcf6` 的计算对比度为 5.15:1 和 4.70:1。不据此宣称任意直播背景上均通过 WCAG；保留描边，实看深浅背景。

目前 `shared/gift-wish-card.js` / CSS 为管理页与 OBS 的渲染 owner，文字色写死为粉/绿。`admin/gifts/wishes.js` / `toolbox/gift-wishes.html` 拥有编辑预览，`wish-service.js` 验证并从 `gift-wish-store.js` 读写定义，`overlay-projection.js` 显式投影。

## 实施与兼容

- gift_db v16 幂等追加 `text_pending_color` / `text_received_color`，默认空字符串代表使用渲染器默认值；旧数据不丢失，新旧请求省略字段时保留原配置。
- 保存接口新增可选 `textPendingColor` / `textReceivedColor`，接受空字符串或六位十六进制颜色，规范为小写；快照及 OBS 投影附带配置。默认色由共享 renderer 导出，管理编辑器复用。
- 文字版显示两个原生取色器和「恢复默认颜色」按钮，沿用现有显式保存流程。现有效果预览可切换今日未收/已收，仅模拟颜色，不修改数量或真实收礼状态。
- 更新内置问号/指南和 API、存储、前端、礼物参考。统计和其他样式不变。

## 里程碑与验证

- [x] 存储/领域/投影：测试 v15 升级、重复迁移、保存/重建 store、旧编辑保留、省略默认、非法颜色和来源隔离。
- [x] 编辑与展示：测试默认值、自定义、恢复默认、保存重开、取消、状态预览切换及 OBS 今日颜色刷新；复用现有测试，不新增自动化设施。
- [x] 定向运行 `node --experimental-vm-modules --test --test-reporter=dot test/gifts/gift-wishes.test.js test/gifts/gift-wish-routes.test.js test/gifts/frontend-gift-wishes.test.js test/storage/database-maintenance.test.js test/overlays/overlay-projection.test.js test/admin/admin-page-composition.test.js test/admin/admin-style-ownership.test.js test/admin/frontend-usage-guide.test.js test/admin/contextual-help.test.js`；受影响 JS 语法检查。
- [x] 复用隔离 Electron fixture 检查两色、取色器、恢复默认、两状态预览、真实保存/OBS 一致性；检视深浅背景。只操作合成数据，结束关闭测试进程。
- [x] 审查本次差量、`git diff --check`、`git status --short`，同步计划结果后归档。

## 验证结果

2026-09-28：上述 85 项测试通过；7 份运行时 JS 语法检查通过。真实授权 `/admin` 和匿名 OBS 预览路由均返回 200。隔离 Electron 实测默认值、两个取色器、两状态预览、自定义保存重开、恢复默认及取消；用「未收到」预览状态保存后，实际已收到的条目仍使用已收颜色且数量保持。CUA 内置浏览器读取真实 OBS 页面，确认自定义色与恢复默认都自动同步。浅色预览与临时深色底板上两种默认文字均实看，截图对比保存在任务可视化目录 `gift-wish-default-colors.png`，未进入仓库。测试页面和 Electron 进程已关闭；沿用的合成数据目录未重试此前被拒绝的删除操作。

## 失败处理与完成条件

迁移只追加列，不回写原定义；可停用新增 UI 而保留列与数据。回退仅逐段撤回本次修改，不重置或覆盖工作区。默认色一致、自定义保存/重开/OBS 生效、今日状态与预览互不干扰、相关检查通过且文档一致后完成。
