# 职责归属与粒度追加整改

Status: Completed

## Goal

落实当前审查确认的五项职责归位和两项小模块合并，保持行为与公开合同，保留工作区已有修改。

## Scope And Compatibility

仅调整 Live 客户端内部模块，不改 Server、HTTP/WS/IPC、持久化、用户操作、页面 URL 或 Electron 安全配置。无提交、分支、打包、发布。继续采用 CommonJS 后端和无构建 ESM 前端。

现有队列/SC、设置、绘画和礼物测试覆盖主要行为；审查时架构 29/29、相关七文件 38/38 通过。新阶段先复核当前基线。临时材料和首次写入前副本保存在 `tmp/responsibility-refactor-followup-2026-11-10/`。

## Ownership And Decisions

| 项目 | 变更与接口 | 消费者及保护 |
| --- | --- | --- |
| 表单 | `forms.js` 只保留通用控件；快照回填由 `state-renderer.js` 拥有，队列主题控件/兼容换算归 `queue-theme-view.js` / `queue-theme-config.js`；重连错误处理回到 `settings-operations.js` | app、theme、desktop-lyric；保留焦点、dirty、独立表单草稿及百分比测试 |
| SC | 新建 `admin/superchat.js`，整体拥有渲染、操作串行、撤销及释放；app 显式初始化/清理，state-renderer 和清库操作直接消费；队列与 SC 实际共用的复制/滚轮交互放 `queue-list-view.js` | 队首/LIVE/复制/撤销批次测试；补销毁后迟到响应不能恢复撤销状态的生命周期覆盖 |
| 头像 | `bilibiliAvatarSource(value, token)` 原样移入 `shared/bilibili-avatar.js`；登录、房间资料和粉丝视图直接引用 | 登录头像代理、粉丝展示测试；不混并其他头像合同 |
| 预览基础工具 | `previewElement` / `previewToolbarIcon` 移入 `admin/component-preview-elements.js`；surface 保留 iframe 及完整资源生命周期 | 全部具名导入消费者同步；现有预览/画布浏览器场景 |
| 冲刺 | 常量、快照、重置和缓存原样移入 `bilibili/gift/sprint-service.js`；gift/index 仍为门面，query-service 保留流水/统计；SQL 与事务保持在 store | gift-query、gift-routes、projection 与统计测试 |
| 合并身份小模块 | `overtime-gift-identity.js` 三函数收回唯一消费者 `overtime-gift-picker.js`，保持两类 key 差异 | picker、图片 variant 身份及盲盒刷新保护 |
| 合并绘画小模块 | `games-drawing-controls.js` 两函数收回 `games-drawing.js`，去掉回调穿透；geometry 保留 | 绘画撤销、笔画同步、轮次切换测试 |

## Milestones

- [x] 基线与小模块：头像/预览工具归位、两项合并，同步消费者和相关文档。
- [x] 冲刺职责迁移，更新门面和测试导入，保留来源、缓存与重置事务保护。
- [x] SC 完整生命周期归位，更新初始化/清理/快照与清库消费者。
- [x] 表单职责归位，更新快照拥有者、主题、重连及现有行为测试。
- [x] 最终架构/文档/语法检查，差异检查并归档实施证据。

## Verification

按完成批次运行对应的 `node --experimental-vm-modules --test` 现有套件：settings-auth-profile、frontend-fan-profiles-view、overtime-gift-picker、games-drawing、gift-query-service、gift-routes、gift-projection-service、gift-statistics-service、frontend-admin-queue、frontend-queue、frontend-queue-scrolling、admin-state-renderer、frontend-admin-runtime、frontend-admin-startup、settings-clear-all-ui、topbar-status、opening-overlay、frontend-blindbox-mapping-refresh、desktop-lyric-settings、desktop-lyric-settings-runtime。最后运行既有 canvas-empty-previews/text-box-editor 等相关预览浏览器覆盖，不控制用户应用。

完成后运行 `npm run verify:architecture`、`npm run verify:docs`、`npm run check`、`git diff --check`，对照本任务副本审查差异与 `git status --short`。不运行无关全量业务套件；记录实际命令与结果。

技术事实更新 `docs/reference/frontend/app.md`、`pages.md`、`comms.md`、`overlays.md`、`docs/reference/backend/bilibili/gift.md`。用户指南保持：用户操作、界面及地址不变。测试保留行为断言，仅按拥有者调整导入与夹具，新增覆盖限于实际生命周期风险。

## Failure Handling And Done When

发现失败先用对应聚焦测试定位；不得放宽有效断言或覆盖其他修改。必要时只撤回首次写入前副本中本任务对应差异。七项完成、相关验证通过、文档归属一致且最终差异已核对后标记 Completed；未执行验证明确记录。

## Execution Evidence

- 实施前聚焦基线 45/45；头像、预览工具、两项合并相关 42/42；冲刺查询/路由/投影/统计 23/23；SC 拆分首轮 34/34。
- 表单与 SC 生命周期共 15 文件 72 项：首轮 70 项通过；两项失败为百分比浮点尾数和既有 clock 参数绑定对测试替身新增订阅能力的依赖。主题显示消除浮点尾数，测试替身复用真实字段订阅入口；对应两文件 12/12 通过，行为断言保持。
- SC 新覆盖：dispose 取消未发送队列、移除监听器，重新初始化后旧响应不能覆盖新 token/计时器或重读状态；原批次过期、淡出及显式清除覆盖保留。
- 表单核查发现主题与歌单板已有专属回填，原 fillForm 的主题字段被 owner 排除规则跳过；syncAllRangeInputs 只被旧测试调用。移除重复路径，旧字号/速度换算放入 queue-theme-config 的显示投影，由 queue-theme-view 唯一消费；字体选项仍先准备后赋值，草稿持久化单位不变。透明度原测试转向实际主题 controller/view，包含 0 和 preset 编辑；增加旧字体/速度换算覆盖。通用快照回填保留独立 owner、dirty 和焦点保护。
- 浏览器集成：canvas-empty-previews 与 text-box-editor 合计 21/21；component-preview-browser 的队列编辑/保存场景 1/1。使用现有隔离夹具，未控制用户应用。
- 未改变用户操作与公开合同，用户指南保持不变；模块归属同步六份技术参考。最终架构 29/29、文档 10/10、1,832 个 JavaScript 语法通过；改动后的 SC 文件末次回归 12/12。

## Final Review

- 对照首次写入前副本，37 个消费者只更新导入且具名绑定不变；头像、预览 DOM/SVG、选择器身份函数、冲刺快照与重置函数逐段对比保持原逻辑。绘画控件由原唯一消费者直接管理，移除回调透传。
- 已审查本任务源码、测试、技术参考差异；删除的两个模块无现存运行时或测试引用。旧 forms 业务接口及 syncAllRangeInputs 的运行时调用已清空，通用控件消费者保持原接口。
- 保留工作区原有改动，以及检查期间出现的时钟字段编辑、房主短长号、榜单阅读位置等并行改动；这些并行改动未计入本次整改范围。clock 测试替身复用真实字段订阅以兼容当前代码。
- git diff --check 通过；新文件单独检查。git status --short 无本次临时日志、运行数据或敏感材料进入差异，未操作暂存区。
- 用户操作、页面地址、公开 HTTP/WS/IPC、设置键和持久化格式保持，技术参考已同步，用户指南无需调整。未执行全仓业务套件或真实 OBS/直播姬长时间实播；本次没有修改外部平台接入或媒体输出行为。
- 日志与任务差异副本在 repository-root tmp/responsibility-refactor-followup-2026-11-10/，仅作本次审查材料。无提交、分支、打包、发布；七项均完成，无剩余实施项。
