# 周表编辑与参数完善

Status: Completed

## Goal

完善现有周表生成器的编辑效率、可选参数和视觉表达；新增选择应实际影响预览、保存和导出的同一张图。旧模板的布局、素材位置与新增参数默认值保持兼容，文字对比度有意改善。

## Current Behavior

已在隔离 Electron 读取实际页面：六种排版通过名称下拉框选择，左栏长表单使排期和素材入口靠下；图片只能用滑杆调整 20–250% 大小和半个画布范围的位置。背景图固定裁切且不透明，日程字号不能自行调整。导出前同步检查尚未加载完成的字体，且在保存等待后才读取可变模板，存在快照与点击时内容不一致的路径。

## Ownership and Compatibility

- `public/js/admin/weekly-schedule/` 拥有模型、编辑、保存和渲染；同一 renderer 用于预览与 PNG。
- `src/electron/weekly-schedule-export-controller.js` 拥有 IPC 输入验证和受限导出窗口。
- IndexedDB v1 新增可选外观字段，缺省值保持既有布局；不迁移数据库、不改 URL/IPC 名称或安全边界。
- 保留六套布局的 Q 版/Logo 空间规则、字体回退、图片限制、自动存储队列及用户其他改动。
- 不新增服务、运行依赖、CDN 下载、提交、发布或操作用户运行中的应用。

## Changes and Verification

- [x] 编辑面板分为外观、排期、素材、模块；六种排版用几何示意卡，图标显示实际 SVG，扩充到十二配色与七种花纹。沿用共享 select/color/range 控件与主题 token。
- [x] 图像范围扩大到大小 10–400%、x ±1920、y ±1080，并增加旋转 ±180°、不透明度 0–100% 和 Logo/Q 版翻转；数字输入与滑杆同步，单项素材可恢复默认调整。
- [x] 背景增加填充/完整显示、焦点位置 0–100%、不透明度与 0–24px 模糊；标题字号 50–150%，主题/备注/时间字号 70–160%，花纹浓度 0–100%。参数在模型归一化、渲染、旧记录回填和导出验证中一致。
- [x] 增加前后周、本周和将周一时间应用整周的操作，折叠日程显示内容摘要；调整参数时保留当前分类/展开状态。
- [x] 导出使用点击时的独立快照，最终溢出检查由已等待字体和图片的隔离 renderer 执行；前端显示当前预览溢出提示。对真实复现的 `capturePage: UnknownVizError`，仅在下一 `requestAnimationFrame` 后重试截图一次；其他错误或第二次失败正常退出，保留取消、超时和原文件保护。
- [x] 更新模型边界/旧记录兼容、IPC 新字段验证，以及真实 Electron 数字输入、保存重载、切周、批量时间、导出快照与 PNG 回归；验证截图一次恢复及持续失败最多两次。
- [x] 综合桌面视觉检查覆盖六种排版、常用内容、扩大参数和窄窗口；运行 Impeccable context 和 detector 各一次。六条提示均为既有成品主题装饰，按保留原视觉风格的要求保留。
- [x] 同步 `docs/reference/frontend/app.md`、`docs/reference/desktop/main.md`、`docs/reference/engineering/test.md` 和百宝箱使用指南；入口和介绍未变化的 README/导览保持不动。

## Commands and Evidence

已执行 `node --test test/admin/weekly-schedule-model.test.js test/admin/weekly-schedule-storage.test.js test/desktop/weekly-schedule-export.test.js test/desktop/weekly-schedule-electron.test.js`，28/28 通过；8 个受影响 JS 文件语法检查通过；`npm run verify:docs` 10/10 通过。输入字段验证、点击快照及有界截图重试复用现有导出安全边界，未扩大权限。

QA 对照：分类键盘/鼠标切换→当前内容与焦点；精确输入/越界/空值→范围同步及旧值保留；新增图像与背景参数→重载及 PNG 实际像素；长文字→溢出提示与拒绝不完整导出；导出期间继续编辑→图片保留点击快照。桌面截图、PNG 和基线保存在 `tmp/weekly-schedule-refinement-2026-11-09/`。

- 六种布局均导出成功且无溢出；1000×821 窄窗口无横向溢出，导出按钮可见。
- 500 字留言触发提示并拒绝不完整导出，恢复短文后提示消失。
- 真实 Electron 初始窗口宽度 960px 和 1920px 两种情况均通过 PNG 四角最新标记像素检查。
- 背景 PNG 在 `(960, 50)` 的 BGRA 像素验证：底色 `[226,224,221,255]`，cover/100% `[95,39,180,255]`，cover/25% `[192,177,210,255]`，与预期混合 `[193,178,211,255]` 各通道差不超过 3；contain/100% 的该边缘像素回到底色。记录在 `visual/background-pixels.json`。
- 视觉、溢出与导出证据在 `visual/verification.json`；detector 原始结果在 `impeccable-detect.json`。六条既有装饰提示涉及票据/杂志边线、福利便签边和方格背景，没有新增编辑器命中。
- 六版式效果图保存在仓库根目录 `output/weekly-schedule-refined-layouts-2026-11-09.png`。

## Failure Handling and Done When

仅对本任务差异作定向修复；基线已保存，其他会话改动保留。旧模板可加载，布局、素材位置与新增参数默认值兼容，文字对比度有意改善；所有新参数可操作、保存和导出。验证及文档同步完成，本轮增量已对照基线审阅，独立 Electron 测试实例已关闭并确认 PID 28796 退出。未提交、打包或发布。
