# 共享文字格式工具栏

Status: Completed

## 目标与边界

将文本框选区工具栏抽成 Admin 共享组件，接入文本框和礼物许愿文字版，增加现有共享字体库选择。保留各自内容模型、原生撤销、素材/模板块和现有保存入口，不引入编辑器依赖或改变收礼统计。现有未提交的字体、滚动及其他修改保持完整。

## 现状与所有权

- `admin/text-box-editor.js` 拥有文本框编辑、选区和原生撤销；`text-box-format-controls.js` 拥有色板/文字效果。抽出的 `rich-text-toolbar.js` 和 `rich-text-format-controls.js` 负责共享控件与浮动定位。
- `shared/font-library.js` 继续拥有字体选项；工具栏仅注册和释放字体选择器。
- `shared/text-box-config.js` / renderer 接受可选节点字体；场景既有存储和发布流程不变。
- `admin/gifts/wish-text-editor.js` 保留不可拆分模板块。可选 `textRuns` 保存有格式的模板片段，与 `textTemplate` 内容一致；`wish-service.js` 校验，`gift-wish-store.js` 存取，新迁移增加 JSON 文本列，旧值为空数组。仅改备注保留格式；旧客户端提交新模板而不携带格式时清除旧格式，避免内容错配。
- 渲染继续用 DOM 文本和样式赋值，不接受 HTML。许愿未显式指定的颜色继续继承收礼状态色，旧模板、旧图片位置和计数不变。

## 里程碑与验收

- [x] 抽取共享工具栏及 CSS，文本框字体通过校验、渲染、保存和撤销；运行 `node --test test/admin/text-box-editor.test.js test/scenes/text-box.test.js`。
- [x] 许愿接入共享工具栏，完善可选格式字段及幂等迁移；运行 `node --test test/gifts/gift-wishes.test.js test/gifts/gift-wish-routes.test.js test/gifts/frontend-gift-wishes.test.js`，覆盖旧数据升级、非法格式、重启和仅备注修改。
- [x] 在隔离 Electron 中检查两处工具栏的字体、选区保持、内容块、撤销、保存回显；运行对应两个 desktop 文件，并检查截图。
- [x] 同步 `frontend/pages.md`、`frontend/overlays.md`、后端礼物与存储契约、内置文本框/许愿指南；运行 `npm run verify:docs` 和相关架构/语法检查，最终检查任务差异、`git diff --check`、`git status --short`。

## 完成证据（2026-10-16）

- 文本框、场景、许愿服务/路由/前端、字体/选择器生命周期及相关消费者的组合检查 85 项通过；两个 Electron 文件与旧数据库升级组合 8 项通过。
- 补充输出字体真实加载后，文本框 Electron、许愿前端、指南组合 49 项通过。发现 overlay 许愿字段投影会丢弃新格式，已添加嵌套字段白名单；路由与投影组合 14 项通过，额外私密字段仍被剔除。
- 多行局部格式操作曾重复计算 Chromium 的 BR 与块边界，已用原生输入复现并修复；许愿前端、Electron、指南最终组合 50 项通过。同时对齐工作区现有的文字版默认不描边样式，改字体不会额外打开描边。
- `npm run check` 通过，`npm run verify:architecture` 27 项通过，`npm run verify:docs` 10 项通过。初次文档检查仅因本计划使用未识别的中文状态标签失败，改为标准 `Status:` 后恢复。
- 隔离 Electron 实际检查共享字体搜索、选择、模板块与预览，并确认 `FontFace.status` 为 loaded；两份指南截图更新为真实结果。测试实例关闭，隔离 profile 已清理，未操作真实数据。
- 任务差异依据开始时快照及 Git 检查，保留并行字体、滚动和网址组件等修改；临时材料位于忽略的 `tmp/rich-text-toolbar/`。没有提交、打包或发布。
- 测试和技术契约已同步，内置两份指南、问号帮助及截图已更新；README 和导览不包含受影响的具体操作，保持原样。

## 失败处理

仅在 `tmp/` 下使用隔离测试数据库和 Electron profile。发生错误时保留原草稿，不写真实用户数据；依据 `tmp/rich-text-toolbar/before/` 的任务前快照检查任务差异，逐项回退自身更改，不覆盖其他未提交工作。完成以以上行为、迁移、文档和验证实际通过为准，不涉及提交、打包或发布。
