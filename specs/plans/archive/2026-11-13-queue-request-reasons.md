# 点歌板失败原因实施计划

**Status:** Complete

**Goal:** 点歌板成功仍显示绿色、失败仍显示红色；失败提示同时展示点歌人、歌曲和实际拒绝原因，包括个人冷却剩余秒数、歌曲冷却恢复时间及其他点歌规则。

**Architecture:** 沿用现有临时点歌结果与队列快照链路，增加可选的用户可读 `reason`。消息入口和手动添加入口传递已有领域拒绝说明，展示投影仅放行该字段，提示正文复用现有安全文本渲染、滚动和阅读时间。

**Tech Stack:** CommonJS、原生 JavaScript ES modules、现有 Node/VM 测试。

## 当前行为与所有者

- `src/server/message-application.js` 与 `src/server/routes/queue-routes.js` 记录点歌结果时丢弃已有拒绝原因。
- `src/music/queue-service.js` 拥有临时结果，`src/server/overlay-projection.js` 拥有展示白名单。
- `public/js/overlays/queue-request-notice.js` 拥有共用提示，当前只显示点歌人、歌名及成功/失败。
- 直接相关测试为 `queue-service`、`song-cooldown`、`queue-request-notice` 与 `overlay-projection`；现有队列 ESM/随机入口测试用于消费者回归。

## 边界与兼容

- 只增加失败结果的可选公开说明；既有字段、成功提示、颜色、去重、接收期限、阅读顺序和动画保持兼容。旧结果缺少原因时仍显示失败。
- 复用已知业务拒绝的用户可读原因，不将意外异常、UID 或私密元数据投影到直播画面。
- 不改点歌准入、冷却计算、SC 开关、弹幕自动回复、数据库或远端同步协议。
- 保留其他任务的修改，尤其并行的点歌空格设置；不提交、分支、部署或操作真实账号数据。

## 实施与验证

- [x] 扩展现有契约/集成用例，确认临时结果、手动入口、消息入口、展示白名单及安全文本显示尚未保留原因。
- [x] 在现有所有者和调用点传递 `reason`，把失败原因放入可滚动正文，保留固定的成功/失败结果。
- [x] 同步音乐服务参考、点歌板参考和应用内点歌指南；WS 参考已有队列字段指向领域快照，无需复制字段契约。交互引导无新增入口或配置，保持不变。
- [x] 运行 `node --experimental-vm-modules --test test/songs/queue-service.test.js test/songs/song-cooldown.test.js test/songs/queue-request-notice.test.js test/songs/queue-random-request.test.js test/songs/queue-overlay-esm.test.js test/overlays/overlay-projection.test.js`；必要时复用已有浏览器验证路径确认长原因完整可读。
- [x] 运行受影响 JS 语法检查、`npm run verify:docs`，审阅 touched diff、`git diff --check`、`git status --short`。

## 失败处理与完成条件

只修复本任务拥有的具体行，不破坏性回滚。各现有点歌失败入口的公开原因完整到达同一提示，个人和歌曲冷却可分辨且带已有剩余时间，其他失败解释可读，旧结果仍兼容、长原因安全显示并可完整阅读；相关检查通过且技术文档与使用说明一致后完成。

## 完成证据

- 原实现先在既有用例中复现原因丢失；修复后六个相关文件共 81 项通过，0 失败、0 跳过，日志位于 `tmp/queue-request-reasons-tests.log`。覆盖消息/手动入口、歌曲冷却、公开投影、字面文本渲染及长失败原因的完整阅读和重排。
- 五个受影响 JavaScript 源文件语法检查通过；文档门禁 10/10 通过。
- 先确认隔离预览精确路由 HTTP 200，再由内置浏览器加载实际共用提示模块和 CSS，核对绿色成功、红色失败和带资格原因的窄提示；没有使用真实账号或直播数据。完整长文滚动由既有 VM 行为用例验证。临时预览进程及浏览器页已关闭，预览脚本已清理。
- 修改保持在已有所有者和展示链路；并行的点歌空格设置、礼物及其他用户改动保留。源码已完成，未提交、打包或部署；真实 B 站与直播软件实播未执行。
