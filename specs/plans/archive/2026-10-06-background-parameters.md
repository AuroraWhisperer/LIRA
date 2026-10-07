# 背景参数与套装默认值

Status: Completed

## Goal

静态、动态背景支持不透明度、模糊、填充、亮度、饱和度、对比度、遮罩；视频支持速度和音量。作者通过现有 ZIP config 提供默认值，实例可修改和恢复默认，保存并应用后输出一致。

## Current Behavior / Ownership

`public/js/shared/scene-extra-components.js` 目前只有背景 style；`src/server/scene-components.js` / `scene-extra-config.js` 校验场景配置；`component-style-library.js` 把 ZIP config 合入库模板。`scene-extra-preview.js` 创建参数面板，`component-style-inspector.js` 更换外观。`background.js` 渲染资源背景，普通媒体由 `component-media.js` 管理。

## Compatibility / Non-goals

只扩展 background 外观合同，不改业务设置、权限、IPC、数据库结构或其他组件。旧自定义媒体背景保留 fill，旧资源背景保留 cover；缺失视觉参数保持原图。新添加背景默认 cover。库模板不随实例编辑改变，已有场景不随素材库更新改变。默认快照只允许背景参数。保留工作区已有变更，不提交、不打包发布。

## Proposed Changes

- 共享 background-appearance 定义字段与默认值；服务端沿用字段校验，额外验证可选 backgroundDefaults 快照，导入时产生快照。
- 背景参数专用视图使用现有 DOM、样式 token 与实例 controller，基础参数展开，更多调整折叠，视频字段按类型显示；恢复默认只修改当前实例。
- 背景渲染器统一处理原生与媒体元素的视觉效果/播放速度；滑动不重建视频或重置播放位置。
- 更新作者和用户指南、overlay 合同；新增针对性验证。

## Milestones / Verification

- [x] 配置与导入：旧配置、范围/未知字段拒绝、两种 ZIP 默认值及实例隔离均验证通过。
- [x] 面板与输出：普通图片/视频、资源静态/动态、实时参数、恢复默认、换样式、保存输出、重开验证通过；隔离 Electron fixture 完成真实桌面桥保存及界面检查。
- [x] 边界与文档：架构、文档、相关场景/预览检查已执行；无关失败列于下方；完成本次差异及状态审查。

## Verification Results

- `node --test test/scenes/component-styles.test.js test/admin/component-style-library.test.js`：14/14 通过。导入检查覆盖普通媒体与资源型 ZIP，新版本不覆盖旧实例，移除库条目后默认快照仍存在。
- 最后一次 `node --test test/scenes/scene-extra-components.test.js test/admin/component-style-library.test.js`：12/12 通过。补充拒绝显式 null，以及面板数值/滑块、默认恢复、换样式保留几何、输出一致性。
- `node --test --test-name-pattern='animated wallpaper' test/admin/canvas-component-suites.test.js`：1/1 通过。发现并修复视频初次 load 把倍速重置为 1 的问题，使用 defaultPlaybackRate 与 playbackRate 一致保存；测试也覆盖静态切换和减少动态效果。
- 场景/预览组合检查（scene-extra-components、component-preview、component-preview-providers、component-preview-drafts、scene-document-model）：69/70 通过。未通过的 A03 只使用 danmaku：当前 12 款样式生成 273094 字节，超出 262144 上限；与背景无关，未修改。
- `npm run verify:docs`：10/10 通过。
- `npm run verify:architecture`：18/19 通过；唯一失败为未在本任务修改的 `public/js/admin/gift-wishes-canvas-data.js` 空 catch 文本债务。ESM 标识符与模块依赖检查通过。
- Impeccable detector：本次 UI 目标结果 `[]`。
- 使用 `test/fixtures/danmaku-canvas-editor.cjs` 与 tmp 独立数据启动真实 Electron，确认匿名 admin 为 401、桌面授权成功、实际画布 URL 为 200；通过桌面桥保存 opacity=0.75、blur=3、playbackRate=0.75，再恢复默认。侧栏内容宽/滚动宽均为 265 px，无横向溢出，页面错误为空。测试进程与数据已清理，截图保存在 `tmp/background-parameters-qa/`。
- 未运行真实 OBS / 哔哩哔哩直播姬性能测量，未构建或发布安装包。

## Rollback / Done When

失败时仅修复或撤回本次补丁；测试只用 tmp 下独立数据与内存数据库。完成要求基础/高级/视频控件和默认快照正确，预览与发布输出一致，兼容性检查通过，文档同步，最后差异审查完成。真实 OBS/直播姬性能不作为未经测试的完成声明。
