# 幽灵便笺配色参数

Status: Completed

## Goal

在客户端与画布复用的弹幕参数面板中，提供跟随主题或自定义的外框底色、消息底色、正文色、事件底色和装饰强调色；三个背景层分别调不透明度。

## Current Behavior / Ownership

`danmaku-style-options.js` 的浏览器 / Node 镜像拥有参数合同；目前 `spooky` 只有主题、外框及通用文字参数。客户端 `danmaku-parameter-view.js` 绑定源面板，画布克隆同一面板；独立预览由 `danmaku-preview-appearance.js` 绑定。`spooky.css` 拥有分层填充。现有样式合同、客户端、独立预览与真实 feed 浏览器测试可扩展。

## Compatibility / Non-goals

继续按样式共享配置，既有保存路径、布局、动画与其他样式不变。已有 `textColor` 仍表示明确自定义。未设置的颜色跟随主题，不存储整套解析后的配色。不改公共渲染核心，不重做原美术，不增加昵称或每个贴纸的独立设置。

## Proposed Changes

- 仅 `spooky` 新增四个可选颜色字段及三个 0–100 整数不透明度字段；复用 `textColor`。
- 主面板与画布显示相同控件；独立预览同步。颜色模式只是编辑行为，不增加持久化 mode 字段。
- 调整背景填充的 alpha，保留文字、贴纸和外框线条；强调色联动纸片、书签、蛛网和边线。
- 恢复主题配色只清除颜色及背景 alpha 的覆盖，保留当前主题、外框、字体和布局。

## Milestones / Verification

1. 合同和分层填充 → 样式参数测试、共享 feed 中的配色/alpha 实测。
2. 两处面板及独立预览 → 参数保存、主题切换、局部恢复测试；隔离 Electron 客户端及画布实际操作。
3. 文档与收尾 → 更新参数指南、overlay reference、内置指南；`npm run verify:docs`、相关语法检查、`git diff --check` 与任务基线对照。

具体测试使用 `node --experimental-vm-modules --test` 的样式参数、客户端、独立预览用例；颜色浏览器用例通过 `--test-name-pattern` 聚焦运行。

## Rollback / Done When

失败时先检查 `tmp/spooky-color-settings/baseline/` 与当前文件的任务差异，仅撤回本次修改，保留既有未提交工作。完成条件为颜色默认、覆盖、透明度、切换主题、局部恢复、保存重载及两处同步均有证据，文档一致，任务差异已审阅；不构建安装包或部署服务器。

## Progress

- 已确认画布复用客户端参数面板，无需另建设置实现。
- 合同、分层填充、源面板 / 画布克隆 / 独立预览及局部恢复已实现，51 项合同与参数面板检查通过。
- 真实 CSS 检查发现跟随主题正文被通用文字色覆盖，已在样式 owner 修复；默认 / 自定义和 0 / 40 / 75% 填充 alpha 的浏览器检查通过，父节点、正文与贴纸保持不透明，消息节点及播放状态保留。
- 最终相关检查：样式合同、独立预览、面板编辑、管理端标记、保存控制器和画布注册共 72/72；`--test-name-pattern="spooky" test/danmaku/danmaku-feed-motion.test.js` 共 4/4（含上下密集入场）；文档门禁 10/10。
- 两个全新隔离 Electron 实例及画布完成实际选色、保存 / 重载、跟随色下 alpha=0、画布保存回客户端及局部恢复；恢复结果只剩当前主题与字号，布局相同。最终四组控件在客户端和画布均完成截图检查，页面错误为空。
- 参数指南、overlay reference 与内置使用指南已同步。公共渲染核心 SHA-256 仍为 `edeafac2020a3abb3ac44a18007a31e97e87643682af4ce36b2a8b8dc76dbe5e`。
- 证据在 `tmp/spooky-color-settings/`，测试进程、浏览器及服务全部关闭。自动审批策略拒绝删除本次两份 profile（`blocked by policy`），保留该目录，未换工具重试删除。未改用户运行数据，未构建安装包、提交或部署；远程服务器须同步支持扩展参数。
