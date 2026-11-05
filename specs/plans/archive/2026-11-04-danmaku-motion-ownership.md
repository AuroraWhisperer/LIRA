# 随机与飘窗弹幕动效归属

Status: Completed

按当前用户要求在本会话实施。

## 目标与验收

随机、飘窗分别提供清楚的通用运动参数；漫画、极光、星轨的专属入场由各款维护。用户能独立调整入场、退场或边缘显隐，不叠加两套入场，不重播已显示消息。现有默认效果、按款保存、账号本机外观与场景交付边界保持兼容。

不改变固定弹幕的视觉动效、远端旧在线源、消息订阅、数据库结构与素材；不发布或打包。

## 当前行为与归属

- `danmaku-feed.js` 拥有随机位置、计时与 400ms 到期渐隐；入场散落在款式 CSS，恢复快照也可能触发入场。
- `danmaku-floating.js` 拥有横移、避让、等待、完整尾部离场清理；极光与星轨各自重复维护相同的边缘遮罩。
- `danmaku-style-options.js` 是浏览器和生成 Node 镜像的字段合同；`danmaku-parameter-controls.js` 被桌面、画布、独立预览复用。
- `danmaku-message-renderer.js` 是本机样式适配入口。固定来源的 renderer core 保留兼容，新的本机入场适配放在此层。
- `danmaku.js` 向公共 feed 传递参数；`danmaku-appearance` 和场景共享外观负责持久化与交付。
- 合同 owner：`docs/reference/frontend/overlays.md`；模块清单：`pages.md`；用户说明：`docs/guides/component-style-parameters.md` 和应用内弹幕姬指南。

## 设计决定与兼容

1. 随机通用区包含停留、分布、退场方式/时长；六款普通随机样式复用渐显、上浮、直接显示及入场时长。漫画只提供自己的入场方式/时长，支持直接显示。
2. 保留旧 `entranceAnimation: fade/rise`，缺少时长时保持原渐显时长或 500ms 上浮。所有参数继续保存于 `styleOptions.<style>`，恢复默认只清空本款。
3. 随机 feed 在到达时锁定本条停留/退场参数，在线改参数只影响后续消息。到期清理仍准确；撤回、拥挤淘汰和销毁立即清理。新消息成功放置才开启入场；恢复快照直接呈现完整内容。
4. 飘窗通用区包含现有速度/分散及左右边缘显隐、柔化宽度。共享 CSS 拥有遮罩，极光/星轨默认双边柔化，另两款默认直接切断，保留完整光尾清理。
5. 极光/星轨在各自独立区提供原生入场或直接显示、入场时长。CSS 只处理内部图层，参数逐条锁定；装饰循环开关继续独立。减少动态效果省略装饰入场，飘窗保留阅读所需横移。
6. 沿用现有 ESM、CSS、WAAPI，无新依赖、框架或连接。有限入场仅在新增时播放，持续动画不带动文字。

## 实施与验证

- [x] 字段合同和面板分组：扩展现有校验矩阵及旧参数兼容分支，同步 Node 镜像；桌面/画布共用控件。
- [x] 公共生命周期：扩展现有随机到期测试，验证自定义退场、关闭退场、参数在线更新保留原到期点及销毁清理；沿用飘窗位置、等待和完整光尾测试。
- [x] 样式适配：六款普通随机复用本机入场 adapter；漫画/极光/星轨保留专属编排，快照和修改参数不重播；共享飘窗边缘 CSS。
- [x] 在既有隔离 Electron 夹具中验证真实参数操作、保存和重新打开、本地场景参数传播；使用 playwright-interactive 检查随机/飘窗的新增、密集消息、边缘和减少动态效果。临时数据及截图位于 `tmp/danmaku-motion-ownership/`。
- [x] 同步技术合同、用户说明、计划状态；运行直接相关 Node 测试、既有桌面路径、JS 检查、`npm run verify:docs`、相关架构门禁及 `git diff --check`。

重点异常场景：入场尚未结束时更新参数；随机到期中撤回/销毁；飘窗拥挤等待后入场；有拖尾时改速度或边缘显示。

## 失败处理与收尾

当前工作区包含大量用户已有修改。任务前文件快照保存在 `tmp/danmaku-motion-ownership/before/`，最终用任务增量检查保护原改动。失败仅修正本任务拥有的行，不执行整体回滚。完成需有参数保存和实际播放证据，不能只凭字段清单或测试通过宣称视觉正确。

## 验证记录

- 字段合同、随机过期、飘窗、快照稳定性和独立预览：`node --experimental-vm-modules --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-overlay-fullscreen.test.js test/danmaku/danmaku-floating.test.js test/danmaku/danmaku-snapshot-stability.test.js test/danmaku/danmaku-local-preview.test.js`，47/47 通过。初轮另含消息 renderer 的相关批次 57/57 通过。
- 参数面板、本机外观、共享场景、独立输出和 Electron 画布：`node --experimental-vm-modules --test test/danmaku/danmaku-panel-edit-state.test.js test/danmaku/danmaku-local-preview.test.js test/danmaku/danmaku-appearance.test.js test/scenes/shared-appearance.test.js test/overlays/component-source.test.js test/desktop/danmaku-canvas-electron.test.js`，43/43 通过。
- 系统减少动态效果切换时重播入场已在浏览器复现并修复；浮窗 owner 清除入场标记、保留横移并释放偏好监听。末轮浮窗、字段合同、独立预览 36/36 通过；实际播放复验无入场重播，星芒/星尘停止且横移仍运行。
- 固定来源 renderer 契约测试 2/2 通过；`sync-danmaku-style-options.cjs --check` 通过。`npm run check` 通过，`npm run verify:docs` 10/10 通过。
- `npm run verify:architecture` 27/28 通过；唯一失败是任务前已存在的 `public/js/admin/client-settings.js` 空 catch，未修改该无关文件。本任务新增模块和变更未引入架构门禁失败。
- 隔离 Electron：漫画的墨线/600ms 与退场/700ms、极光的边缘/44px 与入场/850ms 按款保存、重读与进程重启恢复；普通随机 rise/650ms 保存恢复。画布将极光改为 both/60px/1000ms 并保存，真实本地输出消费一致。随后在线修改为 none/500ms 时，旧消息保留 layered/1000ms，新消息采用新值；实际发布场景也接收同一配置。
- 浏览器播放覆盖全部 11 款的快照、原生入场及直接显示；九款有独立入场的动画实例、起点和时长在改参数后保持。六款共用 rise/750ms 正文完整。1920×1080 实际源尺寸下检查漫画密集消息、星轨移动和光尾，减少动态效果与参数开关均验证。
- 用户指南和随机参数截图已同步，两份 WebP 一致。交互式引导仍指向原入口，无需修改。Impeccable 检测仅报告现有工具页无关侧边线，不属于本次变化。
- 测试全部使用合成数据，未连接真实直播间。桌面、浏览器、输出服务器和隔离用户数据已清理；保留 `tmp/` 中基线与 QA 证据。任务增量已复核，既有工作区改动保留，未提交。
