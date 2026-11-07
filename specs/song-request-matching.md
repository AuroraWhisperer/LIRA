# Feature: 可选择的点歌歌名匹配方式

Status: Implemented

## Goal

主播在「点歌 → 点歌规则 → 歌名匹配方式」选择保留现有规则，或开启前缀优先，使「听说」能够在存在《如果你也听说》和《听说你》时匹配后者。

## Requirements and acceptance criteria

- 默认 `unique` 保留现有完整歌名优先、唯一包含匹配；可选 `prefix` 在完整歌名之后先尝试唯一前缀，没有前缀候选时再尝试唯一包含匹配。仅考虑启用歌曲，关键词是字面文本，多首候选不猜测。匹配算法的实现事实见[音乐服务](../docs/reference/backend/music/services.md#71-歌曲-crud)。
- 未匹配时保留现有歌库限制行为；普通弹幕与启用的 SC 点歌共用该规则。成功补全使用完整歌名、歌手和歌库身份，原始点歌消息保留。
- 下拉框沿用现有自动保存；下一条点歌使用新模式，已有队列不被改写。`songRequestMatchMode` 沿用 settings 存储与账号同步，旧快照省略不重置已选模式，非法枚举整批拒绝。
- 验收覆盖截图的两首歌、多个前缀、完整歌名优先、停用歌曲、字面通配符、唯一包含回退、模式切换、自动保存与设置读回。

## Architecture and compatibility

扩展现有歌曲服务、SongStore 查询、点歌设置及表单，不引入新的数据库 schema、端点、依赖或队列格式。服务器只同步设置，桌面执行匹配。云端可选字段及旧快照行为由[设置 API 参考](../docs/reference/backend/api.md)维护。原有存档和队列无需迁移。

## Verification

- `test/songs/song-request-autocomplete.test.js`
- `test/settings/settings-contract.test.js`
- `test/settings/frontend-song-request-settings.test.js`
- 隔离 Electron 点歌规则表单的选择、自动保存和刷新读回。

2026-11-07 已验证以上三份 Node 文件，并通过队列、SC 与云同步相关回归；隔离 Electron 使用真实 preload 和桌面请求鉴权，确认默认保持原文、前缀优先补全、单次选择只触发一次设置同步，以及刷新和重启后保留选择。服务端定向 schema、租户隔离及原子拒绝检查通过。完整固定版本契约门禁因现有客户端锁定提交与本地服务端提交不一致而未通过，不将这些定向结果当作固定版本门禁通过。

## User guidance

应用内[点歌使用文档](../public/pages/admin/toolbox/usage-guide-song.html)和控件帮助说明模式差异。既有点歌规则入口不变，无需更改导航或交互式引导。
