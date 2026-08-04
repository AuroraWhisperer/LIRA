# Random Song Multi-Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持弹幕随机点歌用 `+` 拼接多个条件，并且只从同时满足全部条件的歌库歌曲中随机。

**Architecture:** Bilibili 桥接层只解析并传递原始筛选文本；歌曲服务负责读取已启用歌曲和随机避重；新的纯函数模块负责拆词及跨语言、歌手、分类、标签的 AND 匹配。模块间只传字符串、歌曲对象数组或歌曲对象，不共享数据库句柄和运行状态。

**Tech Stack:** Node.js 24、CommonJS、`node:test`、`node:sqlite`

## Global Constraints

- 使用两空格缩进、单引号、分号和 CommonJS `'use strict'`。
- 只修改随机点歌所需文件，不引入依赖，不改动用户已有未提交文件。
- 关键匹配规则写清楚注释，并通过 `npm run check && npm test`。

---

### Task 1: 纯多条件筛选模块

**Files:**
- Create: `src/music/random-song-filter.js`
- Create: `test/random-song-filter.test.js`

**Interfaces:**
- Consumes: `filterRandomSongCandidates(songs, scopeText)` 的普通歌曲数组和弹幕筛选文本。
- Produces: `parseRandomSongTerms(scopeText): string[]`、`filterRandomSongCandidates(songs, scopeText): object[]`、`randomLanguageAliases(term): string[]`。

- [x] **Step 1: 写失败测试**

覆盖 `国语+周杰伦+抒情` 只保留三个条件都命中的歌曲、任一条件无匹配时返回空数组、全角加号、语言别名、标签精确匹配及单条件兼容。

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/random-song-filter.test.js`
Expected: FAIL，模块尚不存在。

- [x] **Step 3: 最小实现**

实现无副作用的拆词和 AND 谓词；标签先拆分后完整比较，不使用子串匹配。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/random-song-filter.test.js`
Expected: PASS。

### Task 2: 歌曲服务集成

**Files:**
- Modify: `src/music/song-service.js`
- Modify: `test/random-song-filter.test.js`

**Interfaces:**
- Consumes: Task 1 的 `filterRandomSongCandidates(songs, scopeText)`。
- Produces: 保持现有 `listRandomSongCandidates(db, scopeText)` 和 `pickRandomSong(db, scopeText)` 签名不变。

- [x] **Step 1: 写数据库集成失败测试**

创建临时歌库，保存同时满足和仅部分满足条件的歌曲，断言候选只含全部匹配项；不存在完整交集时断言为空。

- [x] **Step 2: 运行测试确认旧实现失败**

Run: `node --test test/random-song-filter.test.js`
Expected: FAIL，旧实现只识别单个作用域且不查询标签。

- [x] **Step 3: 接入纯筛选模块**

用一条静态 SQL 读取已启用歌曲及分类，再交给纯函数过滤；保留现有近 10 首避重和随机抽取逻辑。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/random-song-filter.test.js`
Expected: PASS。

### Task 3: 弹幕行为与完整验证

**Files:**
- Modify: `src/bilibili/bilibili-message-handler.js`
- Modify: `test/random-song-filter.test.js`

**Interfaces:**
- Consumes: 现有注入接口 `context.pickRandomSong(scopeText)`。
- Produces: 候选为空时返回 `accepted: false`，不调用 `addQueueItem`，不更新用户冷却。

- [x] **Step 1: 写弹幕行为失败测试**

断言组合条件原样传给注入接口；接口返回 `null` 时弹幕被忽略、队列未写入、冷却未更新。

- [x] **Step 2: 调整无匹配提示与注释**

提示明确说明“全部条件”，不改变成功路径和依赖注入边界。

- [x] **Step 3: 运行定向测试**

Run: `node --test test/random-song-filter.test.js test/bilibili-message-log.test.js`
Expected: PASS。

- [x] **Step 4: 运行全量校验**

Run: `npm run check && npm test`
Expected: 语法检查通过；全量测试若受无关工作区改动影响，记录具体失败并保持该改动不变。
