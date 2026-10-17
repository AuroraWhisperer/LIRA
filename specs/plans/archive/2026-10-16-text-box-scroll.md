# 文本框自动滚动

Status: Completed

## 目标与边界

客户端和画布共用两个互斥的自动滚动开关；默认静止，横向向左、纵向向上循环，编辑器保持静止。支持万字正文，不增加富文本框架、运行依赖、业务服务或全局设置；保留原有富文本、动图、选区和原生撤销。

## 当前行为与证据

`text-box-preview.js` 已拥有客户端和画布共用参数面板；`text-box-config.js` 在客户端与后端共同校验结构化配置；`text-box-renderer.js` 按格式片段渲染。现有输出以 640px 设计宽度缩放，只裁剪超出区域的正文。

隔离 Electron fixture 中，一次输入 10000 个中文字约 10ms，编辑与输出各只有一个文本 span；输出自然高度约 22396px。字符数量本身尚未表现为编辑瓶颈，不引入编辑防抖或虚拟 contenteditable。新增播放需要约束绘制区域、避免整段超长文本 transform 图层、重复全文副本与逐帧布局测量。

补测 11000 字/1000 行粘贴发现 `execCommand('insertText')` 按换行触发 2000 次输入、生成 2001 个元素，约 3062ms。因此扩展本任务编辑优化：多行纯文本通过 DOM `textContent` 构造转义 span，以单次原生 `insertHTML` 插入；仍不接受剪贴板 HTML，保留插入位置格式、末尾换行和原生撤销。同时使用粘贴时的当前选区，并补齐块级节点后接文本的换行序列化。

## 所有权与兼容

- `public/js/shared/text-box-config.js`：版本 1 增加可选 `scrollMode: 'none' | 'horizontal' | 'vertical'`；旧配置缺省为 `none`，非法值继续拒绝。
- `public/js/admin/text-box-preview.js`、`public/css/admin/text-box.css`：在对齐/行距后增加自动滚动区，复用现有 switch 样式。启用一个方向自动关闭另一个。
- `public/js/admin/text-box-editor.js`：播放参数变化不重建编辑 DOM，保留选区和原生撤销。
- `public/js/overlays/text-box-scroll.js`、`text-box.js`、`public/css/overlays/text-box.css`：输出滚动生命周期；共用 renderer，横向将换行显示为空格，纵向保留换行/折行。
- `docs/reference/frontend/overlays.md`、`specs/component-scenes.md` 为契约文档；`public/pages/admin/toolbox/usage-guide-text-box.html` 为用户指南；检查现有两张指南截图是否仍准确。
- 原有场景 256 KiB UTF-8 限制、HTTP/IPC/发布/模板协议、安全边界、媒体路径和 640px 缩放规则保持。保留已有未跟踪 `outputs/`，不提交/发布。

## 实施与验证

- [x] 配置和共用 UI：旧配置默认关闭、两个方向往返保存/模板导入、非法值、方向互斥与编辑撤销；扩展现有 `test/scenes/text-box.test.js`、`test/admin/text-box-editor.test.js`、`test/admin/canvas-text-box-picker.test.js`。
- [x] 输出播放：仅一份正文，视口前后留一个视口长度的空白以实现循环；以 40 设计像素/秒用原生滚动偏移播放，rAF 仅写偏移，尺寸只在配置/尺寸/素材变化时重测。同配置不重建，不重置进度；隐藏/销毁停止。短文、万字、富文本/图片、两个方向、改尺寸、关闭与清理用 `test/overlays/text-box-scroll.test.js` 验证。
- [x] 隔离 Electron 检查客户端和画布布局、切换与保存；一万字输入/输出帧间隔和 DOM 数量实测；同步契约/指南及受影响截图。

## 验证记录

- 五个直接相关测试文件 26 项通过；指南和组件定义 19 项通过；架构 27 项通过；六个变更 JS 文件语法检查通过。设计检测器无命中。
- 11000 字/1000 行在隔离 Electron 中粘贴约 19.3ms、一次输入事件、一个正文元素，读回内容完全一致。自动化中 12030 字粘贴约 6.2ms；两者运行环境不同，不作为跨设备性能保证。
- 可见 Electron 窗口连续采样两种方向各约 1.5 秒：输出三个元素，每轮约 356–358 帧，p95 帧间隔约 4.3ms、最大约 8.3ms。隐藏 fixture 会节流到约 1fps，该状态不作为播放性能结论。
- 客户端保存 `vertical` 后，正常授权入口打开画布，准确选中同一实例并恢复滚动方向；265px 参数栏及桌面并排编辑/预览无控件溢出。两张指南截图更新，隔离进程已关闭。
- `verify:docs` 首轮仅因本计划使用“状态”标签而未被门禁识别失败；改为规范 `Status` 并归档后重新验证。未改架构边界或导航入口，交互式引导无需变更。未打包、发布或验证真实 OBS/直播姬推流。

定向命令：

```text
node --experimental-vm-modules --test --test-concurrency=2 test/scenes/text-box.test.js test/admin/text-box-editor.test.js test/admin/canvas-text-box-picker.test.js test/overlays/text-box-scroll.test.js test/desktop/text-box-electron.test.js
npm run verify:docs
npm run verify:architecture
git diff --check
git status --short
```

只在出现具体契约影响时扩大检查。Electron 使用现有 `test/fixtures/danmaku-canvas-editor.cjs`（隔离 userData/sessionData、内存 SQLite、随机端口），不连接真实用户数据。

## 失败处理与完成条件

测试失败先归因，用定向复现修复；停止时只检查并反向修改本任务差异，不进行破坏性回滚。完成要求：旧配置兼容、客户端/画布/输出一致、长文能持续滚动且保留原文、关闭与销毁停止资源、文档和指南同步、定向测试及最终 diff 审查通过。实播软件未实际运行时明确该验证限制。
