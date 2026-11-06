# 全屏礼物掉落与摇摇乐实施计划

Status: Completed

当前需求来自本次用户指令；参考 BV1aN411w7tf 与 BV1UWF6eUEcc。

## Goal

在「礼物姬 → 全屏礼物」加入礼物掉落与底部摇摇乐，两者独立启用、保存参数及最低结算金额。掉落图可调大小；每份从本机捕捉 final 结算时起拥有相同配置时长，先到期先移除碰撞体，失去支撑的礼物继续下落。

## Current Behavior / Ownership

- `runtime-transport.js` 在 final 回调中生成本地 `gift:frame`，通过原 WS 和场景窗口扇出；`frame-config.js` 的林间花信 FIFO 与原门槛保持不变。
- `gift-frame` 是现有场景组件，`gift-effects-component.js` 管播放；当前无内置样式卡，只有导入素材。新增两款内置变体，保留旧 `{}` 配置和资源型样式。
- `gift-frame.js` 管原设置；新设置控制器负责两款参数的草稿、保存和画布预览。礼物原图沿用共享 gift artwork resolver 与本地目录，不另开 B 站请求。
- 合同：`docs/reference/backend/{bilibili/gift,storage,ws}.md`、`frontend/overlays.md`；指引：`public/pages/admin/toolbox/usage-guide-guard-thanks.html`、`docs/guides/component-sources.md`。互动导览不枚举各款全屏效果，入口不变，无需修改。

## Boundaries / Compatibility

不改变服务器结算、账本、来源隔离、旧特效队列、授权或媒体来源检查。不新增依赖、进程或数据库迁移。新事件是现有 `gift:frame` 的本地主题扩展；仅向已有 gift-effects scope 投影展示字段。工作区已有大量用户修改，只追加本任务内容，不提交、不切分支。

## Changes / Milestones

- [x] 配置与事件：共享参数定义（掉落/摇摇乐各自开关、金额、大小、存活时长，摇摇乐摆幅）；后端验证和默认值；final 入口同刻记录 startedAt，分别匹配门槛并生成稳定独立 ID。沿用精确礼物身份解析本地图。验证：结算门槛、双启用、重复交付、图片身份与投影白名单。
- [x] 播放：原生 JS 刚体掉落（旋转、碰撞、支撑、到期移除）与底部弹簧立牌；独立生命周期，加载/场景等待不延后截止时间，隐藏恢复不补时。现有完整浏览器源与选中变体均可显示。验证：确定性物理测试及真实浏览器播放，特别是移除底层后上层继续掉落。
- [x] 界面：全屏礼物两组设置和草稿保存、示例预览、两张内置画布样式；参数不相互覆盖。验证：现有隔离 Electron 夹具保存及画布/独立来源；不启动或操作用户应用。
- [x] 同步文档和用户指引，检查差异和状态；不改无关截图与测试。验证：直接相关 Node/浏览器/Electron 检查、`npm run check`、`npm run verify:architecture`、`npm run verify:docs`、`git diff --check`。全局架构与一个拓展注册测试的无关失败详见下文。

## Verification Results

- 新增 `gift-motion-effects.test.js` 4 项：final 独立金额、双主题稳定 ID/来源投影、固定截止时间、移除底层后上层落地。`gift-motion-browser.test.js` 1 项使用真实发布场景检查两款分流、原图延迟、重复交付、字面安全文本、到期及刷新不重播。最终 5/5 通过。
- 旧边框/草稿、事件发布、场景 gift window、场景 schema、独立来源等首轮 53 项中 52 通过；唯一失败为未修改的加班机注册夹具没有导出 `showConfirmationDialog`。后续礼物导入/感谢/画布、设置持久化与隔离 Electron 林间花信回归 35/35 通过；最后复核新效果与旧 Electron 导入 6/6 通过。不修改加班机代码或测试来取得绿色结果。
- 隔离 Electron 实际分别保存掉落 120px/9秒/5元、摇摇乐 180px/7秒/30度/10元，另一款设置保持；实际画布预览读取 180px。独立浏览器真实播放 180 张掉落与 14 张底部立牌，约 2 秒 rAF 采样平均 16.62ms；该结果仅代表此机合成场景，不是 OBS/直播姬实播基准。页面错误为零。
- `npm run check` 通过（当时 1737 文件），`npm run verify:docs` 10/10，Impeccable detector 返回空结果，`git diff --check` 通过。架构 27/28：唯一失败是未修改的 `public/js/admin/overtime.js` 清空了 empty catch 后旧基线未同步；本任务涉及的存储依赖、ESM、作用域与模块边界均通过。
- 技术参考、WS 字段、本机设置和用户操作指引同步；导览未枚举款式且入口未变，保持不动。原林间花信示例图配文明确为该款局部示例。
- 自有浏览器、上下文、HTTP/WS 服务和隔离 Electron 均关闭；截图与合成 profile 在仓库 `tmp/gift-motion-20261106/`，未进入差异。未使用真实用户数据，未实送礼、实播、打包、提交或发布。

## Failure Handling

缺图使用已有占位图，后台的结算与账本不受渲染影响。到期、关闭、来源 reset 和销毁清理节点/动画；测试只用 `tmp/` 内合成数据。修改前保留任务涉及文件的原始副本，以便与当前未提交内容区分；回退只撤销本任务补丁。

## Done When

两款在全屏礼物可独立保存、预览、添加并发布到画布，最低金额由 final 总额判断；掉落大小可调、各实例截止时间固定且移除支撑后上层下落；摇摇乐具有独立弹性运动与参数。相关检查通过，实际播放/保存证据及限制记录在此，文档同步，最终补丁不包含运行数据或无关改动。
