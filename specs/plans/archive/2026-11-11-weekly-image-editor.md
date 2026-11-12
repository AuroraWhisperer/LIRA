# 周表图片直接编辑与大屏工作区

Status: Completed

日期：2026-11-11

## 目标与边界

周表预览支持点选图片、直接移动、等比缩放和旋转；每个上传槽位独立保存变换及亮度、对比度、饱和度、阴影、柔光。大屏编辑占满桌面标题栏以下区域，提供退出按钮与 Esc，沿用本机自动保存。保持 1920×1080 成品与预览/导出一致。不增加自由文字排版、图片抠图、服务端存储或新依赖。

## 当前行为与归属

`public/js/admin/weekly-schedule/editor.js` 管理状态、300ms 自动保存和重建预览；`editor-fields.js` 在上传列表后展示立绘/Logo/Q版及背景参数，不能直接操作画布。`model.js` 归一化本机模板，`renderer.js` 与 `weekly-schedule-art.css` 同时供预览和导出消费。`storage.js` 顺序写入 IndexedDB。主进程 `src/electron/weekly-schedule-export-controller.js` 校验完整模板后运行固定内部导出页。

## 兼容与实施

- [x] 保留原有 portrait/logo/chibi 变换与 background 焦点含义；新增 qrcode/rank1/rank2/rank3/customIcon 变换，背景像素位移另用 offsetX/offsetY。缺省效果保持原图，旧模板无需升级数据库。主进程对可选新增字段做有界校验。扩展既有模型和导出校验测试，证明复制隔离、旧数据兼容及非法参数拒绝。
- [x] `renderer.js` 标记图片命中区域并统一应用图像设置；新增 `image-interaction.js` 拥有选择框、指针捕获和坐标换算，用 `onSelect(key)` / `onChange(key, values)` 回调交回编辑器。指针移动只更新原图片节点，避免重建导致拖动中断；释放后走现有保存队列。背景拖动使用像素位移，重复图标共用所属上传素材的参数。
- [x] `editor-fields.js` 在素材分类顶部展示当前图片调整区，上传项提供编辑入口；缩放、旋转等保留共享滑块/数值输入，效果折叠展示。`editor.js` 拥有大屏展开/退出、自动保存和清理，HTML/CSS复用现有工作区，保留桌面标题栏。视图放大不改变图片实际参数。
- [x] 扩展已有隔离 Electron 核心流程，检验拖动坐标、缩放/旋转、独立参数、自动保存重载及真实PNG效果；在同一隔离夹具进行视觉检查，验证大屏画布、标题栏与退出入口可用、图片移出后可恢复及删除后选择状态正确。既有模板复制/切换/重载流程继续通过。

## 验证及同步

执行 `node --test test/admin/weekly-schedule-model.test.js test/admin/weekly-schedule-storage.test.js test/desktop/weekly-schedule-export.test.js`，以及 `node --test test/desktop/weekly-schedule-electron.test.js`。新增源码运行针对性语法检查；因可选导出字段与新增ESM模块，运行 `npm run verify:architecture`。同步 `docs/reference/frontend/app.md`、`docs/reference/desktop/main.md`、`docs/reference/engineering/test.md` 和应用内 `usage-guide-toolbox-work.html`；现有交互导览无周表细节，无需添加重复说明。运行 `npm run verify:docs`、`git diff --check` 并核对相对任务前快照的局部差异。

## 风险与完成条件

不同版式的图片层级、带旋转的父元素及缩小后的预览会影响命中与拖动坐标；使用实际画布缩放与父变换换算，运行时检查。保存失败沿用重试提示，不误报保存成功。任务完成须满足直接编辑、扩大/退出、保存重载、导出一致性和旧模板兼容，并确认未混入既有无关修改。回退仅撤销本任务局部变更。

## 完成证据

2026-11-11：周表模型、存储、导出和真实 Electron 合计29项通过；架构29项、文档10项及受影响模块语法检查通过。之后修复移除图片使焦点返回body时Esc无法退出的问题，直接编辑流程定向回归通过；主进程去掉重复翻转校验后导出12项再次通过。首次桌面检查的SVG替换用例因上传区域新增折叠而等待隐藏input超时，已改为先展开上传区域，未放宽素材安全断言。

隔离桌面正常画布838×471，大屏画布1146×645（内容区1500×913），保留48px标题栏，退出按钮可见；实际检查拖动/缩放、背景像素位移且焦点不变、移出后恢复、图片移除、按钮和Esc退出。测试使用合成素材，没有访问用户账号或数据；测试实例已关闭。设计检测仅提示既有成品画布的装饰样式，按任务范围保留。技术参考、测试说明和应用内指南同步；既有导览不含周表细节。未提交、打包或发布。

临时文件清理被执行策略拒绝（工具仅返回 `blocked by policy`），未更换工具绕过；`tmp/weekly-image-qa-2U1sXJ/`、`tmp/weekly-image-editor-baseline/` 和 `tmp/weekly-image-design-check.json` 留存，测试进程已关闭。
