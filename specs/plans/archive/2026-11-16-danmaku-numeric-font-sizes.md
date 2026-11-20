# 弹幕字号具体数值

Status: Complete

## 目标与范围

所有字号滑条显示本款、本用途的具体 px 数值。原文字表格内对确实不同的字号提供有标签的滑条，不新增折叠分区；不改字体、配色、布局或其他效果。

## 现状与责任

浏览器实测各款真实消息后发现，原可选字号用空值表示 CSS 默认，且金额、昵称、标题等组内存在不同字号。`shared/danmaku-text-options.js` 拥有文字节点和新字号默认/细分定义；`danmaku-style-options.js` 及生成的本机镜像拥有字段合同；`danmaku-appearance-draft.js` 负责兼容编辑；共享参数控件供桌面、画布及独立预览使用；`overlays/danmaku-text-application.js` 负责真实渲染。

## 兼容与实施

- 保留现有字段及已存数值。细分字段缺失时继承显式旧组字号；新编辑只改选中的用途，保存需要保持的同组值。
- 默认值按实测字号保留一位小数，字号接受两位小数，沿用本机存储与保存通道。只扩展实际存在的文字用途；不迁移数据、增加订阅或网络请求。
- 删除滑条“原样式”档位；恢复默认回到本款数值。现有整体缩放换算继续适用。

## 验证与完成条件

- [x] 47 款、269 个含正文的字号控件均有合法数值；真实浏览器逐项确认非正文字号、细分编辑独立性和恢复行为。
- [x] 字段合同 20 项、面板及本地预览 26 项、真实排版 8 项、隔离桌面与画布保存 3 项通过。补验缩放下的小数字号往返不丢精度。
- [x] 更新 `docs/reference/frontend/overlays.md` 和工具箱使用说明；Node 镜像同步。桌面及画布截图位于 `tmp/parameter-layout-qa-final/numeric-font-*.png`。

## 验证记录与限制

复用了 `danmaku-style-options`、`danmaku-panel-edit-state`、`danmaku-local-preview`、`danmaku-typography-browser`、`danmaku-canvas-electron` 和 `danmaku-notebook-electron` 的既有验证路径。原测试的简化 document 没有 head/createElement，数值默认字号总会创建样式表后暴露该夹具缺项，现复用已有 Fake DOM；排版测试对拥有独立字号的事件字样验证正文调节时大小不变。未放宽其他排版与缩放检查。

默认字号由原 CSS 实测值取一位小数，差异不超过 0.05 px；已存字号数值继续有效。没有增加网络请求或修改权限边界。源码与隔离运行验证完成，未打包或替换用户运行中的客户端。

测试临时数据及截图位于根目录 `tmp/`；保留现有无关工作树改动，不提交或发布。
