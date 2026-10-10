# 使用文档八章迁移实施计划

Status: Completed

用户已授权实施；不提交或发布。

## 目标与边界

按已确认的八章方案重排正文，最大限度复用现有文本、106 张已引用图片及图注，统一正文标题、行距和图文宽度。保留目录容器、分组布局、展开定位、检索索引与高亮、图片放大、新手引导的实现；目录仅调整章名和目标链接。产品行为、账号授权和数据契约均不变。

## 当前实现与归属

`public/pages/admin/toolbox/usage-guide.html` 递归组合正文分片，目前为 17 章；正文和媒体样式归 `public/css/admin/toolbox/usage-guide.css`、`usage-guide-media.css`。现有 JS 根据 section、article、strong、details 建立索引和定位，保留这些标记。技术事实说明归 `docs/reference/frontend/pages.md`。

迁移依据为用户确认的 `tmp/usage-guide-structure-proposal-2026-10-09.md` 和 `tmp/usage-guide-design-research-2026-10-09.md`；本次工作树基线保存在 `tmp/usage-guide-implementation-2026-10-09/baseline/`。这些临时材料不替代当前技术文档。

## 交付步骤

- [x] 将 17 章迁为安装连接、点歌播放、弹幕互动、礼物分析、场景素材、档案工作台、维护数据、异常问答八章；按正文职责拆开混合文章，兼容旧锚点。
- [x] 迁移正常规则问答，异常问答分类保留；逐项核对原 38 问及原图片、图注和独有事实。
- [x] 正文采用 24/20/18/16 px 层级，图注 13 px，正文约 40em、图片最大 960px；使用既有主题变量，不改目录和检索样式。
- [x] 同步组合、章节归属和搜索用例，更新页面技术说明；核对新手引导入口仍有效。
- [x] 运行直接相关 Node 测试及 `npm run verify:docs`，核对唯一 ID、完整锚点、图片保留与无重复组合；隔离 Electron 验证排版、定位、搜索和图片放大。

## 验证与完成条件

使用现有 `test/admin/admin-page-composition.test.js`、`frontend-usage-guide.test.js`、`frontend-usage-guide-search-browser.test.js` 及样式归属检查。正文主章与目录必须同序且 Q&A 最后；原 JS、图片资产不变；旧锚点有唯一有效目标，全部原图片仍被引用。检查迁移后的事实归属，不能以通过测试代替内容核对。

最后检查任务范围 diff、`git diff --check` 和 `git status --short`，记录测试与桌面验证实际结果。截图示例和自动化不宣称真实直播/第三方账号成功。新手引导与功能指南若入口行为未变，仅核对不改写。

## 失败处理

只对照本次工作树备份撤回任务自己的改动，不使用仓库级恢复，不覆盖并行编辑。隔离验证只操作测试数据和自建进程，结束后清理进程。未完成的验收明确留在本计划，不标记完成。

## 完成证据（2026-10-09）

- 四个定向文件共 35 项通过：`node --experimental-vm-modules --test test/admin/admin-page-composition.test.js test/admin/frontend-usage-guide.test.js test/admin/frontend-usage-guide-search-browser.test.js test/admin/admin-style-ownership.test.js`。包含八章顺序、旧锚点所属章节、所有正文链接的唯一目标、归档正文搜索、异常问答展开及原目录行为。
- `npm run verify:docs` 10 项通过。页面技术说明及礼物许愿正文路径已同步；功能行为未改，其他功能指南不改。新手引导重新打开已在桌面验证，配置文件不改。
- 106 张原已引用图片全部保留；113 次引用收敛为 112 次，合并设置速查里的重复 `B/song-settings-rules.webp`，正文规则旁仍有同图。110 个 figure 均有图注，另两张安装图保留原 alt；全部旧 ID 保留、无重复 ID、无内部断链和嵌套 article。
- 导航、搜索、灯箱三个 JS 和目录、搜索两个 CSS 与任务开始时的工作树逐字一致。全窗截图不再受 320px 高度限制，宽幅操作截图解除紧凑宽度；小图片不放大。图片显式使用原始宽度预留布局，修复首次懒加载使跳转落点漂移的问题。
- 复用 `scripts/usage-guide-shots/electron-fixture.cjs`，隔离数据与配置均在本次 `tmp/` 子目录。真实 Electron、preload 和桌面请求认证，远端回复为合成数据。已检查首搜落点、横向/侧栏目录、640px 正文、960px 图片、字体层级、图片放大/Escape、FAQ 自动展开、无结果搜索、快速上手和重开新手引导。最后一次补拍时工具会话超时，未保存该次补拍；之前的检查和截图已完成，随后仅清理本次夹具进程及子进程。未操作用户客户端或真实直播账号。
- 临时基线、迁移对照、测试输出和桌面截图在 `tmp/usage-guide-implementation-2026-10-09/`；长期保留本记录是为了说明内容迁移、旧入口兼容和媒体布局的取舍。未提交 Git，现有并行工作保留。
