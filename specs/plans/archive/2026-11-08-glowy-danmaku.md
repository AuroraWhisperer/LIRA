# Glowy 弹幕与通用侧倾透视

Status: Completed

## Goal

将用户选定的 Glowy 演示作为新客户端样式：深色透明玻璃、彩色侧光、分层进退场、横排与竖排；右侧使用对应舰长／提督／总督图案。通用高级效果提供易用的左右侧倾及透视距离，其他样式也能保存并输出相同效果。

## Implementation Baseline / Ownership

- 尚无 `glowy` 样式；已有 Glass 是不同的通知卡，不替换它。
- `shared/danmaku-style-options.js` 与 Node 镜像拥有样式和字段校验，`danmaku-parameter-controls.js` 生成所有入口的控件。
- `component-style-parameters.js` 已有旋转与倾斜；`component-effect-filters.js` 以固定 1000px 透视计算绘制及布局边界；`component-style-parameter-view.js` 拥有效果编辑。
- `danmaku-feed.js` 已有纵／横轴有序列表、有限入场、同步移动、清理和减少动态效果；新样式只在 composition root 选择轴，不复制 feed。
- `bilibili-guard-icons.js` 拥有普通／千舰图标切换，无须新增远程请求。

## Constraints / Non-goals

保持本地账号外观归属、现有 HTTP／IPC／页面与上游消息合同；只扩展可选本地外观字段，旧配置默认不变。无新依赖、服务、字体下载、服务器修改、用户数据访问或安装包发布。保留工作区其他任务的改动；不提交或创建分支。

## Proposed Changes

- 新增 `danmaku-glowy.js`／`glowy.css`，复用安全正文和表情节点，统一事件金额与大航海图案；默认 22px 正文、紧凑玻璃卡片。
- 注册样式、默认区域、样式库和独立预览入口；新截图来自本地实际渲染。
- Glowy 通过自身参数选择横／竖排、头像／时间显示及侧光强度；共享参数保留原有字体／颜色／背景／滚动方向。
- 给现有 transform 增加可选 `perspective`（默认 1000px），编辑器添加左右侧倾快捷预设，保存为现有旋转数值；绘制与边界共用 `effectTransform`。
- 同步 `overlays.md`、`danmaku-motion.md`、外观效果指南及相关应用内指南。

## Milestones / Verification

- [x] 公共透视字段、侧倾预设及原配置恢复：现有参数合同、镜像及本地保存／服务重建检查通过。
- [x] Glowy 的四类消息、舰徽、横／竖布局与动效：安全正文、金额、撤回、字体和密集追加已核对。
- [x] 隔离 Electron 从样式库选择、改参、保存、重开；真实本机场景合成事件输出，另以 floating 验证公共侧倾和独立档案。
- [x] 与原作者视频画面比较，完成左右侧倾、无头像、窄区域、动画开关及减少动态效果检查；保存截图，关闭本轮全部测试句柄。隔离 Electron 数据的删除被策略拒绝，保留目录，不绕过。
- [x] 执行相关语法、文档、架构与差异检查；仓库级排版和文档的其他任务失败单独记录，不修改其断言或计划状态。

## Findings / Verification Results

- 新样式只负责材质和消息组合。横排侧倾密集播放复现卡片短暂重叠：公共 feed 的变换占位仍固定使用上下边距，缓存宽度与自然 flex 宽度不一致；改为沿 `flowAxis` 预留边距和补偿交叉轴。相同真实帧复查左右侧倾最小间距约 11.98／12.00px，无重叠；原公共动效覆盖继续通过。
- 收紧普通礼物／上舰为紧凑横条，避免通用礼物的字体、布局及扫光覆盖本款。持续动画关闭只停舰徽循环，不覆盖有限入场；礼物／SC 不加载随后被丢弃的头像。
- `node --test test/danmaku/danmaku-style-options.test.js test/danmaku/danmaku-message-renderer.test.js test/danmaku/danmaku-appearance.test.js test/scenes/component-style-parameters.test.js`：77/77。最后的头像请求调整另以 Glowy renderer 聚焦用例确认。
- `node --test test/danmaku/danmaku-glowy-browser.test.js test/danmaku/danmaku-feed-motion.test.js test/danmaku/danmaku-layout.test.js`：55/55；最后持续动画修正后 Glowy 浏览器回归再次通过。覆盖两轴、侧倾、密集播放、已有节点保留及 SC 删除。
- `test/overlays/component-style-effects.test.js`：6/6，包括所有已登记样式、导入 CSS 和隔离 HTML 的效果与恢复。合跑 typography 的独立 4 项通过，全样式字号测试仍在并行 Astral 的 `12px → 13.1875px` 断言失败；本任务未修改 Astral。Glowy 另有 12 组 16／40px、1／0.75 倍和自定义字体的实际浏览器测量，全部符合所选字号。
- `npm run verify:architecture`：30/30；18 个相关 JavaScript 文件语法检查通过。`verify:docs` 早期有其他任务的计划状态格式失败，最终归档后为 10/10；最后 Glowy 浏览器回归再次 1/1 通过，`git diff --check` 与最终状态检查完成。
- Electron 保存并重开恢复横排、隐藏头像／时间、侧光 60%、透视 1400px；画布真实菜单切换左右预设保留透视距离，floating 另外保存右倾／1800px。最终重新加载的本机场景使用 Glowy 横排／左倾／1400px，合成上舰和完整 SC 正常显示，SC 撤回已实际生效。
- 实际播放证据和数据在 `tmp/glowy-2026-11-08/`；`glowy-final.png`、`glowy-motion-layers.png`、`scene-final-source.png`、`runtime-qa.json` 以及起始快照保留。正式样式缩略图为本机渲染的 `public/img/overlays/danmaku-previews/glowy.png`（720×450）。手动设计检测只提示原作明确要求的 3px 彩色侧光，保留此设计。
- 技术参考、动效合同、用户指南和应用内指南已同步；导览沿用现有弹幕入口，不逐款枚举样式，无须修改。未改 HTTP／IPC、认证、服务器渲染、字体资源与数据格式迁移。未连接真实 B 站账号或直播软件实播，未提交、打包或发布；原作者字体及源码未取得，不宣称逐像素一致。
- 浏览器、Electron 和预览 HTTP 服务已关闭。只针对本轮创建的 `tmp/glowy-electron-GUBiHz/` 校验路径后申请删除，工具返回 `blocked by policy`；目录仍保留，未通过其他方式重试或处理之前被拒绝的目录。

## QA Inventory

视觉：卡片比例、间距、字体层次、彩色边光、玻璃 alpha；头像版／无头像版；右侧三档舰徽；分层入场和事件条；透视两侧与正面；横排。功能：配置按样式记忆与恢复、保存重开／输出、动态消息、SC 完整金额与撤回、其他样式的透视与原动画组合、减少动态效果。探索：长昵称＋长 SC 在窄区域；密集追加中修改透视不重建或重复消息。

## Rollback / Done When

只按本任务开始时快照审查并撤销自身增量，不重置整个工作区。Done When：新样式在客户端可选、可保存、输出经实际 Electron 和场景验证，所有显式要求有对应证据，文档一致且任务差异已审查。原作者的公开视频可证明可见布局和时序，不能证明原字体文件或逐像素相等；最终如实说明实际比对结果。
