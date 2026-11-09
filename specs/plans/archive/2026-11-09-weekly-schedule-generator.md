# 周表生成器 Implementation Plan

Status: Completed

2026-11-09。用户已授权在百宝箱新增完整周表工具、并行处理及完成后审计，不创建分支、提交或发布。

**Goal:** 在「百宝箱 → 主播工具 → 周表生成器」编辑与本机保存多份主播周表，切换六种完整排版，并导出真实 1920×1080 PNG。

**Architecture:** 原生 ESM 模型拥有日程与模板规范，IndexedDB 保存模板及用户上传图片；编辑器和固定内部导出页共用同一成品 DOM/CSS。Electron 主进程通过既有主窗口 IPC registrar 校验调用来源，拥有固定沙箱导出窗口、原生文件对话框和文件写入。

**Tech Stack:** 现有 Electron 43 / Node.js 24 / Vanilla JavaScript ESM / CSS / IndexedDB / node:test / Playwright；无新增运行依赖。

## Global Constraints

- 以本会话核对记录 `output/weekly-schedule-video-feasibility-2026-11-09.md` 和用户确认的多排版为要求；记录是独立交付材料，不加入产品运行时。
- 保留所有无关用户改动、原有导航及月历工作台数据；新工具按需加载，重复进入不重复注册事件或桌面监听。
- 所有排版保留同一份内容，左右对调改变布局，文字不镜像。预览与导出必须使用同一画布。
- 不新增远程服务、自动 B 站榜单采集、二维码生成或账号/直播间权限；前三名是可编辑展示内容。
- 图片只来自用户上传；原始 SVG 图标上传后转 PNG。拒绝任意文件/HTTP URL，不把上传 SVG 作为 HTML 插入。
- 运行及验证中间材料放仓库 `tmp/weekly-schedule-implementation-2026-11-09/`；验证不得读取或覆盖用户数据，不控制用户正在运行的应用。

## Current Behavior And Ownership

现有百宝箱由 `src/server/admin-page.js` 组合片段，`toolbox-navigation.js` 与 `toolbox-lifecycle.js` 管理导航及按需初始化。`streamer-planner.js` 是月历/待办工具，其存储不适合存完整立绘模板，不改变该工具或数据。现有 `gift-export-controller.js` 提供沙箱 capturePage 和像素校验模式，礼物快照及批量任务保持其原业务责任。

| Owner | 本次责任 | 消费者 / 契约 / 验证 |
| --- | --- | --- |
| `public/js/admin/weekly-schedule/model.js` | 字段、日期、六排版/八配色/十一图标、复制模板、清周 | 编辑器/renderer；`test/admin/weekly-schedule-model.test.js` |
| `weekly-schedule/storage.js` / `assets.js` | IndexedDB 版本1、事务完成后保存状态、串行写快照、素材验证/转换 | 编辑器；存储聚焦测试及隔离 Electron 保存重载 |
| `weekly-schedule/renderer.js` 与 `public/css/admin/toolbox/weekly-schedule-art.css` | 单一1920×1080画布、六种布局、模块重排、素材变换及装饰 | 编辑器与固定内部导出页；实际PNG/截图检查 |
| `weekly-schedule/editor.js` / `editor-fields.js`、百宝箱 HTML/CSS | 字段编辑、模板操作、上传、保存状态、实时预览、导出入口 | 原有 `app.js` lazy loader；Admin组合及交互检查 |
| `src/electron/weekly-schedule-export-controller.js` / `ipc/weekly-schedule-ipc.js` | 主窗口授权、原生保存、沙箱窗口及取消/关停 | 新窄桥 `weeklySchedule.exportPng(template)`；桌面聚焦测试 |
| `public/pages/weekly-schedule-export.html` / `weekly-schedule/export-page.js` | 固定内部渲染页面，只接收数据，不接收任意HTML/URL | 既有管理鉴权保护；不加入普通 overlay principal |

当前字体选择复用 `registerFontSelect` 和软件/系统字体库。缺少的站酷小薇由周表成品 CSS 消费并随客户端本地打包，来源/许可记录在字体目录；不新增启动远程下载、CDN包或字体管理服务。

## Interfaces And Compatibility

- `renderWeeklySchedule(container, template, { documentRef = container.ownerDocument } = {})` 返回固定尺寸画布 DOM；所有用户文字通过 `textContent` 渲染。
- `createWeeklyScheduleStorage({ indexedDB = globalThis.indexedDB } = {})` 提供 `load()`、`save(state)`、`close()`；state 为 `{version:1,activeId,templates}`。先成功读取再允许写入，损坏/未知版本不静默覆盖。
- `createWeeklyScheduleTemplate(options)`、`normalizeWeeklyScheduleTemplate(input)`、`cloneWeeklyScheduleTemplate(template, {id,name})`、`clearWeeklyScheduleWeek(template)`、`getWeekDates(monday)` 由模型统一拥有。复制包含素材；清周移除主题/备注/休息与活动，保留开播时间、素材及其它外观。
- `weeklySchedule.exportPng(template)` 通过 `weekly-schedule:export-png` 返回 `{ok:true,saved:true,filePath}`、`{ok:true,cancelled:true}` 或 `{ok:false,error}`。不暴露任意读写路径、Cookie或token。
- `/weekly-schedule-export` 为固定内部页面，使用管理鉴权，不新增 overlay 能力；沙箱 session 不挂主窗口的凭据注入，只在首次固定页请求附带鉴权 header。
- 上传单图最多12MiB，最大边8192、总像素32Mi；导出原始图片字节合计最多48MiB（按Base64解码后的文件字节计）。真实限制在界面和参考中同步，不能只依赖文件扩展名。

## Milestones And Verification

- [x] **数据与模板可恢复。** 实现七天主题/备注/双时段/休息/活动标签，周一日期推导，模板新增/选择/改名/删除/重置/自动保存，上传及移除所有素材。验证：`node --experimental-vm-modules --test test/admin/weekly-schedule-model.test.js test/admin/weekly-schedule-storage.test.js`；隔离桌面保存后重载内容和图片。
- [x] **六种版式内容完整。** 活页手账、星夜来信、复古放送单、横向七日表、杂志封面、国风卷轴；八配色与自选主色/撞色，十一内置图标/上传/主题变色，字体、标题、主播名、星期格式、立绘/Logo/Q版变换、背景、日期/左右布局/署名与装饰；留言/前三名/二维码/福利四模块独立切换后重排。验证：每种样式实际画面，长文本、双时段、关闭模块和对调后的可读性。
- [x] **桌面导出闭环。** 同画布等待图片/字体、capturePage并核验1920×1080；原生保存确认、取消、失败及并发/销毁清理。验证：`node --experimental-vm-modules --test test/desktop/weekly-schedule-export.test.js`，并回归 `test/gifts/gift-export-controller.test.js` 及相邻IPC来源测试；隔离Electron真实导出PNG检查尺寸与素材。
- [x] **导航、说明与审计完成。** 原有百宝箱分组新增入口和按需加载；更新 `docs/reference/frontend/app.md`、`pages.md`、桌面main/preload参考、应用内主播工具说明。检查交互式引导/README影响，不增加无关步骤。验证受影响Admin组合、生命周期、使用文档测试，`npm run verify:docs`、`npm run check`、`npm run verify:architecture`、最终 `git diff --check` / `git status --short`；独立代理审计新增功能及复用边界，修复发现后复核。工作区其他任务导致的检查限制见执行记录，不扩大修改范围。

只运行上述直接受影响的测试和跨边界门禁；不因新功能自动跑整个发布全套。测试分组若新增真实Electron用例，按现有执行器规则登记。

## Failure Handling And Rollback

自动保存只在事务完成后显示成功；读库失败阻止写入，失败可重试且不清空现有模板。素材异步读取绑定发起时模板，删除/切换后的过期结果不能写进另一模板。导出由单一任务拥有窗口，导航/销毁/应用关闭释放；取消不生成输出，写盘失败保持已有文件完整。

实施前相关原文件副本位于 `tmp/weekly-schedule-implementation-2026-11-09/baseline/`。如需撤销，只从该副本和本任务diff分离移除自己的修改；不执行reset、全文件checkout或批量删除，也不回滚并行用户改动。

## Done When

全部已核对功能可从新百宝箱入口操作，六种排版使用同内容且模块/素材不丢失，重载恢复本机模板，真实PNG为1920×1080。本任务聚焦测试、实际桌面操作、文档链接及相关架构检查通过；无关工作区门禁失败记录具体原因与归属。审计无未解决的本任务缺陷，文档语义与实现一致，最终diff保留他人改动，本任务修改仅覆盖所需内容。

## Execution Record

- 2026-11-09：完成现有入口、字体、月历存储及礼物导出调查；数据、画布、导出三个代理按互不覆盖的文件边界并行。主代理负责编辑器、集成、文档和完整验收。
- 实际桌面发现并修复：SVG 的 XMLNS 声明被误拒；Windows NativeImage 不支持 WebP 导致导出失败；模板字段重建后默认字体选项丢失；系统按屏幕尺寸限制初始隐藏窗口，导致 PNG 只保留左上区域。后者增加真实四角像素回归，先验证旧实现失败，再验证修复通过；导出现在恢复内容区并检查实际 viewport。
- 最终业务聚焦组：模型/存储、周表 IPC/导出、真实 Electron 三流程、原礼物导出及共享 RGB/RGBA 控件共44项通过；既有 IPC 来源回归8项通过。Admin组合、按需加载/启动、导航及打包检查通过；说明文档浏览器链接/搜索与字体打包共18项通过。测试分组完整性单项通过，新 Electron 文件已登记在 desktop 组。
- `npm run check`：1827个 JavaScript 文件通过；`npm run verify:architecture`：29项通过。全仓测试运行器自身的一项现有检查失败：正则扫描把 `run-tests.test.js` 内夹具字符串中的 `require('../helpers/failure.js')` 当作真实依赖，寻找仓库中不存在的文件；未改此无关测试，也未声称全套通过。该次组合检查其余54项通过，失败与新周表分组无关。
- 六版式完整 PNG 已由真实 Electron 重新导出，证据位于 `tmp/weekly-schedule-implementation-2026-11-09/interactive/art-*.png`。完成Q版与Logo默认落位修复；384种六版式×立绘有无×左右对调×16模块组合，Q版与文字/头像/二维码0碰撞、0越界、0溢出；Logo实际非透明区域48项0碰撞。主代理另从真实界面导出六种对调PNG及无立绘对调的手账/杂志，再次查看关键画面，pageerror为空。
- 原始小薇TTF在Pillow与Chromium、常规/加粗下均把U+56DE「回」绘为实心块。字体二进制与许可证保持原样；周表font-face通过unicode-range仅排除此字，让正常字体回退。实际六张PNG已验证文字恢复；字体README记录来源与处理。
- 英文/中文README、应用内使用说明及快捷索引已同步；交互式引导是全局页面概览，不含主播工具逐项操作，本次入口未改变其流程。未增加无关步骤或引导截图。
- `npm run verify:docs`的接口/所有文档链接/route/spec等9项通过，活动计划状态检查因其他并行任务的 `2026-11-09-client-functional-bugfixes.md`、`2026-11-09-advanced-lyric-experience.md` 使用校验器不识别的中文状态标签而失败；本计划使用受支持的Status标签。归档后复跑仍9/10，具体失败指向高级歌词计划；保持他人计划不变，保留实际限制。
- 主代理和子代理的测试实例均已关闭。根验收PID85108已不存在；清理专属profile/session/logs等临时目录被执行策略拒绝（blocked by policy），未改用其他工具绕过，资料保留在tmp。六版式合成预览独立保存在 `output/weekly-schedule-six-layouts-preview.png`，不加入产品默认素材。
- 已完成新增源码、共享控件与接线、许可证及本任务文档的差异审查；正常仓库配置下 `git diff --check` 通过，`git status --short` 已核对，未暂存、提交、创建分支、打包或发布。独立审计和真实桌面发现的问题均已修复并复核；保留上述其他工作区门禁与临时资料清理限制。
