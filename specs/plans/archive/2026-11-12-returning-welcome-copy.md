# 多天未到欢迎词库

Status: Completed

## 目标与边界

按用户要求将「久别重逢／重逢客套话词库」改为「多天未到欢迎／多天未到词库」。参考用户提供的梦游机器人截图口吻，提供一个完整文案词库，不按缺席天数分组。网站在当前浏览器要求登录，文案依据已提供截图改写，不声称已读取完整网站词库。

不改变超过 24 小时的触发条件、完整天数算法、个人欢迎优先级、二次问候、冷却、租户和账号授权。无新字段、依赖、连接或发送器，不提交或部署。

## 当前实现与归属

- Server `src/modules/danmaku/welcome-service.js` 在首次欢迎中固定拼接昵称、天数和随机后半句；`src/lib/welcome-messages.js` 拥有昵称、头衔、注音和长度回退。
- `src/lib/welcome-options.js` 拥有默认词库，`src/storage/welcome-settings.js` 拥有读取与保存；已保存默认词库会覆盖代码默认值。
- Live `public/js/admin/danmaku-welcome-{model,library}.js`、`danmaku-welcome.js` 与两个欢迎 HTML 片段拥有设置界面，继续使用现有 `returningEnabled` / `returningMessages`。
- 当前接口契约由 Server `docs/protocol/viewer-welcome.md` 和 `device-api.openapi.json` 维护；客户端入口在 `docs/reference/desktop/{main,preload}.md`，用户操作在 `usage-guide-danmaku-replies.html`。

## 实施与验证

- [x] 在现有 `test/welcome-stages.test.js` 扩展天数场景为完整模板，增加旧默认升级不覆盖自定义库、变量与昵称字面量的最小覆盖。
- [x] 在现有 renderer 中仅对 returning 分支展开 `{username}`、网站别名 `{uname}` 和 `{days}`；先展开天数，再替换昵称，避免解析昵称内的变量文本。含变量的完整模板不再追加固定前缀；无变量文案继续旧后半句行为。

  ```js
  if (returningDays !== null) {
    if (!/\{(?:username|uname|days)\}/u.test(template))
      template = `欢迎 {username}，{days}天没见啦，${template}`;
    template = template.replaceAll('{uname}', '{username}').replaceAll('{days}', String(returningDays));
  }
  ```

- [x] 在既有默认配置中提供 20 条适用于任意缺席天数的完整句。读取设置时，仅与原始五条默认完全一致的数组自动采用新默认；其他自定义数组原样保留，写入仍走原事务。
- [x] 同步标题、按钮、输入示例、变量提示及错误信息；不新增天数分组或第二套编辑器。更新原有前端与 Electron 保存用例的定位和模板输入。
- [x] 同步 Server 需求、验收、协议及 Live 技术参考、内置指南；使用现有隔离 Electron 夹具检查参数页与词库，更新指南参数截图。
- [x] 运行定向验证：Server `npm run verify -- --node test/welcome-stages.test.js --node test/welcome-settings-http.test.js --node test/welcome-settings.test.js --plan` 后执行同范围；Live `npm test -- --file=test/settings/frontend-welcome.test.js --file=test/desktop/welcome-editor-electron.test.js`。Markdown 运行 Live `npm run verify:docs` 和 Server `npm run docs:check`。
- [x] 检查两仓任务增量、`git diff --check` 与 `git status --short`，记录结果。

## 完成证据

- 修改前完整模板场景复现了重复昵称前缀及未展开 `{days}`；修改后相关测试通过。
- Server 三个完整文件 37/37、Live 前端与 Electron 两个完整文件 21/21 通过，无跳过。保留原缺席边界、个人优先、二次问候、短句回退、草稿失败及旧服务器禁用控制覆盖。
- Server 文档/协议检查 59/59，Live 文档检查 10/10。Live 首次失败来自本计划使用中文状态标签，改为规范 `Status:` 后通过。
- 隔离 Electron 使用现有隐藏窗口夹具、随机端口及专用 `tmp/` 数据目录，匿名 `/admin` 返回 401；实际 preload/IPC 保存由既有测试覆盖。目视确认参数名称、20 条完整文案、变量提示、独立分页与无天数分组。窗口已关闭；指南截图更新为实际参数页 900×545。
- 技术协议、需求与验收、客户端技术参考、内置操作指南和组件样式指南同步。交互教程未引用旧功能名，无须修改；历史计划保留原描述。未改字段名、长度限制、认证或发送生命周期，未提交、打包、部署或发送真实弹幕。

## 兼容、回退与完成条件

保留现有未提交修改，编辑前将任务文件复制到各仓 `tmp/returning-welcome-copy-baseline/`，审查时与这些副本比较。若失败，只修复或撤销本任务增量，不整体恢复文件。旧自定义后半句和完整模板均能发送，界面使用新名称且只有单一词库，相关验证和文档同步完成即交付。正式部署另行报告，不把源码验证称作线上生效。
