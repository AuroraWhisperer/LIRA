# 礼物许愿统一插入规则

**Status:** Completed

## 目标与边界

文字版图片与名称、数量统一用标记插入，提供中文按钮、问号说明和内置使用指南。用户无需同时学习图片位置选项与文字标记两套规则。保留现有图片转换、今日颜色、统计和鉴权行为，不新增数据库迁移或依赖。

## 当前行为与归属

`shared/gift-wish-card.js` / CSS 由管理页和 OBS 共用，目前图片位置单独由 `textImagePosition` 决定。`admin/gifts/wishes.js` 和 `toolbox/gift-wishes.html` 拥有编辑器；内置指南归属 `usage-guide-toolbox-danmaku-gifts.html#ug-gift-wishes`。已有 `lira-help` 与插入按钮可直接复用。

## 兼容与实现

- 增加 `{图片}`：模板先按图片标记切分，再用文本节点替换名称和数量；每个图片标记对应一张图片，支持任意位置，不解析 HTML。
- 共享模板读取函数兼容旧 `before` / `after` / `inline`，转换为相应位置的标记；显式 `{图片}` 优先，不重复追加。编辑时读同一转换结果，保存时将旧位置置为 `none`。旧接口字段及存储继续保留。
- 旧 200 字模板转换后会增加 4 字；服务端与输入框上限调整为 240，避免旧文案被截断或无法保存。API 参考同步记录。
- 移除位置选项，在现有插入按钮中加入「插入礼物图片」。只有模板含图片标记时显示动态/静态选项。基本操作常驻提示，含义与示例放入问号及指南。

## 里程碑与验证

- [x] 实现共享解析、兼容转换及编辑器；更新 `test/gifts/frontend-gift-wishes.test.js`，覆盖光标插入、删除、保存重开、旧位置、显式标记优先、安全文本，保留 PNG/跨日/沙盒用例。
- [x] 同步内置使用指南、API/前端参考；更新服务端长度边界测试。
- [x] 运行 `node --experimental-vm-modules --test --test-reporter=dot test/gifts/frontend-gift-wishes.test.js test/gifts/gift-wishes.test.js test/gifts/gift-wish-routes.test.js test/admin/frontend-usage-guide.test.js test/admin/contextual-help.test.js test/admin/admin-page-composition.test.js test/admin/admin-style-ownership.test.js`。
- [x] 使用现有隔离 Electron fixture 实看按钮、问号和段中图片排版；审查任务差量，执行 `git diff --check`、`git status --short`。不重启用户应用。

## 验证结果

2026-09-28：上述 70 项测试通过，改动的三份运行时 JS 语法检查通过。Electron 复用本任务隔离合成数据，`/admin` 授权探测 HTTP 200、真实 preload 可用；实际操作验证图片按钮、问号说明、段中静态 PNG、保存重开和指南内部链接。截图保存在任务可视化目录 `gift-wish-image-token.png`，未写入仓库。测试进程已关闭，此前被策略拒绝删除的临时目录未重试删除。

## 失败处理与完成条件

只使用合成测试数据；失败定位到上述 owning modules，逐段撤回本次修改，不覆盖已有未提交工作。旧许愿可正常显示和编辑、图片/名称/数量操作一致、文档与 UI 相符、相关验证通过后归档。
