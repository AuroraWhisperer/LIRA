# 星轨飞语客户端飘窗

Status: Completed

## Goal

用户认可调研中的第 4 个方向：流星文字。把「星轨飞语」作为新的客户端飘窗样式，提供专属参数、清晰正文和完整的入场／持续微光设计，并在真实桌面保存和本地场景中验证。

## Non-goals

不覆盖现有 `comet`（鹤舞花枝间），不修改远程 LIRA Server 或固定服务器渲染快照，不改消息订阅、认证和礼物结算，不打包、提交或发布。

## Current behavior and ownership

- `public/js/overlays/danmaku-floating.js` 拥有匀速移动、尾迹宽度计入离场、密集等待及清理；继续复用。当前飘窗不显示 SC。
- `danmaku-message-renderer.js` 是客户端样式适配入口；安全文本／表情继续由固定的 `danmaku-renderer-core.js` 生成，新适配器只组合现有 DOM 与原创装饰。
- `public/js/shared/danmaku-style-options.js` 拥有参数契约，既有脚本生成 `src/shared/` 本机 Node 镜像；布局和公共效果能力的两份本机契约保持一致，不向另一个仓库复制。
- `danmaku-parameter-controls.js` 被客户端、独立预览和画布复用；样式入口在管理页片段、独立预览与 catalog。
- 技术参考：`docs/reference/frontend/overlays.md`；用户指南：`docs/guides/component-style-parameters.md` 与应用内弹幕指南。交互式引导已有正确入口，无需新增步骤。

## Visual decisions

透明画面、月白正文 `#f1f6ff`、冰蓝星芒 `#b9dfff`、淡蓝昵称 `#b5c9df`，身份昵称保留蓝／紫／金层次。正文使用既有中文无衬线，默认 28px；昵称 15px。签名是前端四角星和位于文字后方的细长光尾，字形不随装饰缩放、扭曲或闪烁。尾迹方向始终与向左移动一致。

入场先点亮星芒，再让昵称与正文短渐显；持续效果仅在星芒、尾迹和少量星尘上呼吸。减少动态效果时保留阅读与横向布局，关闭装饰循环和入场强调。

专属字段放在「星芒与光尾」组：

| 字段 | 控件与范围 | 默认 |
| --- | --- | --- |
| `startrailColor` | 星芒颜色，RGB／RGBA | `#b9dfff` |
| `startrailStarSize` | 星芒大小，12–40px | 24px |
| `startrailTailLength` | 光尾长度，0–360px | 180px |
| `startrailGlow` | 辉光强度，0–100 | 45 |
| `startrailDust` | 星尘开启／关闭 | 开启 |
| `startrailEntranceMs` | 入场时长，250–1200ms | 680ms |

字体／正文色、飘动速度、分散度和公共效果沿用现有控件；持续动画复用既有开关。无底板，不提供无效的背景透明度参数。所有新字段只接受本款。

## Milestones and verification

- [x] 接入样式、布局兼容和参数契约。使用既有样式参数、布局和公共效果测试，验证旧布局补齐与参数限界。
- [x] 完成原创 DOM／CSS 与入场生命周期，移动速度修改不跳位，光尾完整离场才清理。扩展既有 floating 生命周期用例，覆盖等待后才入场、快照不重播及销毁。
- [x] 完成桌面、独立预览和画布入口，生成真实渲染的样式缩略图。用隔离 Electron fixture 检查选择、六个专属字段、保存、重载、恢复默认和场景输出。
- [x] 实际播放审查默认／长句／表情／礼物／密集到达、光尾极值和减少动态效果，修复本轮发现的问题并确认；保存截图到 `tmp/startrail-danmaku-20261104/`。
- [x] 同步技术参考和使用说明，完成相关 JS 语法与固定渲染快照检查；文档门禁及最终差异检查记录在本节收尾结果。

## Compatibility and failure handling

新字段通过既有逐样式 `styleOptions` 保存；旧布局缺少本款时补全默认区域，其余样式和保存值保持不变。测试使用已有独立 Electron host 与临时数据库，不操作用户实例或真实直播数据。任务开始时已将拟改文件的工作区版本保存到 `tmp/startrail-danmaku-20261104/baseline/`，用于区分并行用户改动。回退只移除本任务增量。

## Done when

新样式能在客户端选择并保存，所有专属字段可调、受限、重载后恢复且作用于本地场景；文字与表情不丢失，运动和清理检查通过；经过实际播放审查与修正；相关说明和验证证据完整。真实直播软件／B 站实播未执行时如实注明，不作为新增的外部发布要求。

## Completion evidence

- 60 项聚焦测试通过：`danmaku-style-options`、`danmaku-layout`、`danmaku-message-renderer`、`danmaku-floating`。扩展既有参数／内容用例，只为等待入场与光尾寿命的具体回归新增行为用例；不为普通视觉曲线增加断言。
- 11 个相关 JS 文件语法通过；`sync-danmaku-source.cjs --check` 与 `sync-danmaku-style-options.cjs --check` 通过。固定 renderer 摘要保持 `edeafac2020a3abb3ac44a18007a31e97e87643682af4ce36b2a8b8dc76dbe5e`。
- 隔离 Electron 完成选择、六字段保存／重启恢复、恢复默认、其他款隐藏专属参数。画布验证颜色 `#e0c4ffd1`、星芒 12／40、光尾 0／360、辉光 0／100、星尘、250／1200ms 和持续动画开关；模拟写入失败保留草稿及已保存外观，重试后成功发布。
- 原画布 fixture 未接显示缓冲区，正式场景读取会返回 500；仅在根 `tmp/` 复用既有合成事件扩展，为其接入真实 display buffer 和场景通知，不改产品路由或测试 fixture。真实 `/scene` 输出恢复保存值，并收到合成弹幕、礼物和表情。六条同时到达的位置无重叠，长中英文／换行完整，正文无局部变形；560×320 区域下 44px 长文与两个表情完整适配。
- 两轮播放精修了字重、星芒辉光、光尾粗细和文字间距。复现修改入场时长会重新淡化旧文字，改为创建消息时锁定时长；实际浏览器复测旧文字保持 opacity 1、入场 finished，新消息采用新时长。减少动态效果关闭所有局部强调与循环。
- 技术参考、参数指南与应用内使用说明同步。交互导览已有正确入口，不新增重复步骤；既有样式库截图继续说明选择流程，新增本款提供实际 renderer 生成的透明缩略图。
- 文档门禁 10/10 通过。截图、QA 清单、测试日志及增量基线保留在 `tmp/startrail-danmaku-20261104/`；自有 Electron／Chromium 已关闭。删除隔离 `electron/` profile 与合成数据库的操作被自动审批以 `blocked by policy` 拒绝，保留在忽略的临时目录，不绕过限制。真实 B 站、OBS 和哔哩哔哩直播姬实播未执行；未提交、打包或发布。
