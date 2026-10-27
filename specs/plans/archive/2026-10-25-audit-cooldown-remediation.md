# Audit Cooldown Remediation Implementation Plan

Status: Completed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 F-02/F-06，使用户点歌冷却按可信主播作用域和稳定身份隔离，并让异常未来时间不会放大剩余冷却。

**Architecture:** 保留现有 `user_cooldowns.user_key` 单列和内存 Map/DB 恢复边界，在 Bilibili 消息桥生成带版本的作用域/身份组合键；不改公开 HTTP/WS 合同。存储层负责恢复及清理时间边界，冷却服务负责读取时的时钟回拨保护。

**Tech Stack:** CommonJS、Node.js `node:test`、`node:sqlite`、现有 Bilibili 点歌策略与冷却 store。

## Global Constraints

- 保留当前工作树已有改动，不 reset、不 blanket checkout、不删除用户数据。
- 只使用合成消息、内存或隔离临时 SQLite；不读取真实数据库或账号。
- 旧无作用域键不得回退成所有主播共享的冷却；不改变点歌命令、配额、歌曲冷却或公开响应结构。
- 不提交、不发布；文档与 focused 测试随实现同步。

## Ownership And Current Behavior

- Owner：`src/bilibili/bilibili-message-handler.js`、`src/music/user-request-cooldown.js`、`src/storage/cooldown-store.js`。
- 可信输入：`src/server/bilibili-client.js` 捕获的 `fanScope`；`src/electron/fan-profile-controller.js` 的 Server origin + `streamerId` 编码。
- 回归套件：`test/songs/queue-service.test.js`、`test/songs/song-cooldown.test.js`、`test/songs/user-request-cooldown.test.js`、`test/songs/cooldown-store.test.js`。
- 当前缺陷：裸 UID/昵称键跨 scope 复用；冷却为 0 也写入；未来 `last_request_at` 产生负 elapsed。
- 契约文档：`docs/reference/backend/bilibili/danmaku.md`、`docs/reference/backend/storage.md`。

## Proposed Changes

1. 新键采用 `v2:` 前缀加 JSON 三元组 `[fanScope || null, identity.type, identity.uid]`，只对有稳定身份且当前规则大于 0 的成功接纳记录；无身份且规则为 0 仍按原流程允许，但不写冷却。
2. 旧裸 UID、`open_id:` 和昵称键不迁移、不查询、不映射到任何 scope；保留至现有 24 小时清理，避免升级时删除无关记录或把冷却扩散到租户。
3. 恢复只加载 `threshold <= last_request_at <= now`；读取时未来时间视为无有效冷却，Map/DB pruning 清除未来行，防止系统时钟回拨后剩余秒数无限放大。

### Task 1: 先写身份/scope 回归

**Files:**
- Modify: `test/songs/queue-service.test.js`
- Modify: `test/songs/song-cooldown.test.js`（仅复用现有 fixture 需要时）

- [x] 在现有 `requestFixture` 风格下增加合成 scope A/B 测试：UID `42` 在 A 接纳后，B 的首次请求必须成功，A 的第二次仍拒绝；`reset()` + `restore()` 后结果不变。增加 `open_id` 与 UID 不互相阻断的断言。
- [x] 增加无身份、昵称 `42`、冷却为 0 的请求，断言成功且 `user_cooldowns` 没有新行；再开启 60 秒，真正 UID `42` 仍成功。保留现有显式零覆盖及资格拒绝不写冷却断言。
- [x] 运行 `node --test test/songs/queue-service.test.js test/songs/song-cooldown.test.js`，确认新增用例在实现前按预期失败，既有失败单独记录，不通过削弱断言修复。

### Task 2: 实现作用域键和时间边界

**Files:**
- Modify: `src/bilibili/bilibili-message-handler.js`
- Modify: `src/music/user-request-cooldown.js`
- Modify: `src/storage/cooldown-store.js`
- Test: `test/songs/user-request-cooldown.test.js`
- Test: `test/songs/cooldown-store.test.js`

- [x] 在消息桥中用当前 `identity`/`fanScope` 生成 v2 键；只有 `cooldownSeconds > 0 && identity` 才查询和 `recordAccepted`，记录的 UID 使用已验证的 `identity.uid`。不在昵称或匿名回退路径写稳定身份键。
- [x] 在恢复 SQL 同时传入 threshold 与当前时间上界；在 `getLastRequestAt` 用同一当前时间判断未来值并返回 0。`pruneMap` 对未来行逐项删除，不能因遇到未来行而停止清理其他过期行；`prune` 同步删除未来 DB 行。
- [x] 添加固定 `Date.now()` 的未来 365 天恢复/读取测试：恢复不加载未来行，读取剩余冷却不超过当前配置；推进时间或重开服务也不能产生负 elapsed。保留旧键 store 的通用读写测试，以证明兼容策略是消息桥不再消费旧键，而非破坏性迁移。
- [x] 运行四个点歌/冷却 focused 套件，确认新增与既有用例全部通过。

### Task 3: 文档和差异复核

- [x] 更新 `danmaku.md` 的键构成、0 秒不写入、旧键不消费策略；更新 `storage.md` 的恢复时间范围和 future pruning。用户操作步骤、设置键及界面不变，用户指南无需修改。
- [x] 运行 `npm run verify:docs`、`git diff --check`，检查 scoped diff 和 `git status --short`，确认没有真实数据、生成数据库或临时文件进入交付。

## Completion Evidence

2026-10-25 完成 F-02/F-06。四个冷却 focused 套件 39/39、点歌目录 265/265、domain 初始化与清库恢复 22/22 通过；文档门禁 10/10 通过。全目录首轮发现的随机点歌旧预期已改为“0 秒不写入”，另一处 SongStore 测试夹具改为先建表再创建 store，复跑无失败。未改变 schema、公开 API/WS 或用户操作，未使用真实账号/数据库；旧无 scope 键仅保留至既有清理，不由新消息链消费。

## Verification / Rollback / Done When

Focused 命令为 `node --test test/songs/queue-service.test.js test/songs/song-cooldown.test.js test/songs/user-request-cooldown.test.js test/songs/cooldown-store.test.js`。若出现迁移或跨域影响，再按具体调用方扩展，不默认运行全库。回滚只反向编辑本计划拥有的源码/测试/文档行，不使用破坏性 Git 操作。

完成条件：跨 scope、身份命名空间、重启恢复和未来时间用例通过；旧记录策略与 owner 文档一致；无 schema/公开合同变化；最终 diff 只含本工作包及必要索引更新。
