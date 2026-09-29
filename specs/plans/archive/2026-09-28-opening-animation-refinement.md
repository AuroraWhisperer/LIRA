# Opening Animation Refinement Implementation Plan

**Status:** Completed — 2026-09-28。

**Goal:** 已打开的开播浏览器源自动同步设置，后台编辑保持动画与音乐连续，并改善无人物构图、文字层级和低画质暂停行为。

**Architecture:** 复用 `GET /api/opening/config`，以单飞、可取消的每秒轮询同步独立浏览器源。后台预览复用现有 sandbox iframe 和受来源校验的 postMessage；配置变化交给一个可更新、可清理的页面运行时处理。

**Tech Stack:** Vanilla JavaScript ES modules、CSS、Node.js 测试与隔离浏览器检查。

## Boundaries And Current Behavior

- 当前开播页只读一次配置；后台除音量外的输入会重新导航 iframe；低画质经历隐藏/显示后错误恢复 SVG 动画。
- 无人物仍保留人物构图；主标题按字数缩小到接近副标题；底部欢迎语偏小。
- 不改 HTTP/WS 权限、设置键、媒体上传/读取契约、固定地址或 Electron 生命周期；不新增依赖、不提交。
- 保留既有唱片、粉金配色和三种轨道。此次“音乐律动”仅改为准确的“氛围律动”，不引入音频分析。
- 工作区已有大量其他改动；只修改本任务所属文件。

## Ownership And Changes

- `public/js/overlays/opening.js`：配置归一化、轮询、预览消息、增量渲染、音频/动画生命周期；删除未使用粒子变量的定时更新。
- `public/js/admin/start-animation.js`：复用预览文档，load 后补送最新状态，媒体上传后只更新相关素材；合并并串行保存设置，防止旧写入覆盖新输入。
- `public/css/overlays/opening.css` 与 `opening-layout.css`：按文字/构图职责抽出被修改的布局，保持现有主样式文件行数预算；无人物采用居中文案，长标题最多自然排成两行，底部文字增大。
- `public/pages/admin/toolbox/start-animation.html` 与相关使用说明：更新“氛围律动”文案。
- `test/overlays/frontend-opening-runtime.test.js` 与现有 opening 测试：连续更新、停止/恢复、单飞与晚到响应、来源校验和卸载清理。
- 当前行为契约归 `docs/reference/frontend/overlays.md`；人物上传规格中预览重载描述同步更新。

## Milestones And Verification

1. [x] 建立运行时回归测试，证明当前配置不会持续同步、预览会重复导航、低画质恢复有误。
2. [x] 改为增量配置和单飞轮询；失败保留最后有效画面，下轮重试；请求限时并在 pagehide 取消。后台消息覆盖迟到的初始读取，音量/文案修改不重新加载音频。
3. [x] 完成无人物/长标题布局和文案，检查有/无人物、20 字标题、40 字副标题、32 字主播名、48 字页脚。
4. [x] 更新当前契约与测试，检查最终 diff，归档完成记录。

运行：

```powershell
node --experimental-vm-modules --test test/overlays/frontend-opening-runtime.test.js test/overlays/opening-overlay.test.js test/overlays/opening-upload-api.test.js test/overlays/opening-media-stream.test.js
npm run check
npm run verify:modularity
npm run verify:docs
git diff --check
git status --short
```

使用隔离的合成配置/仓库测试媒体完成浏览器检查；不操作真实用户配置。后台逻辑由模块级测试覆盖，若检查完整后台则必须使用隔离 Electron 授权流程，不能用普通浏览器代替。

## Failure Handling And Done When

网络失败保留当前配置，禁用仍持续读取配置以支持再次开启；预览更新不重启音频，不重复注册事件；低画质和减少动态效果始终保持 SVG 暂停；退出释放定时器、请求和媒体。所有验收有实际证据，当前文档一致，未引入运行数据或秘密。需要回退时仅逆向本任务补丁，不覆盖其他改动。

## Evidence

- 前次评审：原有 7 个 opening 测试通过，隔离复现低画质初始暂停但隐藏/显示后恢复 SVG。
- 本轮四个直接相关测试文件共 29 项通过；最后一次 JS/测试调整后，运行时和页面契约两文件 14 项再次通过。
- `npm run check`：1036 个 JavaScript 文件通过；`npm run verify:docs`：9 项通过。
- `npm run verify:modularity`：本次开播样式主文件降至 592 行，已删除其过期行数豁免；全仓仍因既有 `public/css/admin/gift-display.css`（633 行）和 `test/gifts/frontend-gift-display-settings.test.js`（632 行）缺少逐文件审查记录而失败，未修改这两项。
- 1920×1080 隔离 Chromium：有/无人物下 20/40/32/48 字边界无横向溢出或越界，主标题两行，页脚 24px；正常文案和两种构图均截图检查。
- 同一浏览器文档中修改标题/音量，音频时间由约 0.34s 继续至 0.93s，SVG 时间连续且 `performance.timeOrigin` 不变；总开关关闭后背景透明、音频暂停且 src 清空。
- 三种轨道任一时刻仅一个前景动效显示；低画质和系统减少动态效果均暂停 SVG。真实 sandbox iframe 接受同 origin 父窗口配置，更新标题/音量而不重载文档。
- Impeccable 静态检查的提示限于保留的主题光晕/唱片纹理与按契约隐藏的无 src 人物图，未发现此次变更引入的破图或布局问题。
- 已清理隔离浏览器、HTTP 服务和临时父页面；截图位于聊天可视化目录，不进入仓库。未使用真实用户配置，未做 OBS 实播帧耗测量。
