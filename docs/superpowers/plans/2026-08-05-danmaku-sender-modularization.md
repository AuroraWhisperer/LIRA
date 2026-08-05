# Danmaku Sender Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate danmaku sending, mention selection, storage, HTTP, and UI behind explicit contracts while preserving manual sending and optional mention of the latest successful random requester.

**Architecture:** The requester target store is the only SQL owner. A pure mention policy formats and validates targets. A dependency-injected sender service coordinates auth, room resolution, target lookup, and the Bilibili client. Routes and browser code are thin adapters.

**Tech Stack:** Node.js 24, CommonJS backend modules, browser JavaScript modules, `node:test`, SQLite.

## Global Constraints

- Do not add automatic chat replies for rejected random requests.
- Do not expose Bilibili cookies or CSRF values to the browser.
- Do not add dependencies.

---

### Task 1: Domain contracts

**Files:**
- Create: `src/music/requester-target-store.js`
- Create: `src/bilibili/danmaku/mention-policy.js`
- Test: `test/danmaku-sender-service.test.js`

**Interfaces:**
- Produces: `getLatestRandomRequester()` and `buildMentionedMessage(message, target)`.

- [x] Write tests for normalized targets and visible mention formatting.
- [x] Implement the SQL-owned requester target store and pure mention policy.
- [x] Run the targeted tests.

### Task 2: Sender orchestration

**Files:**
- Create: `src/bilibili/danmaku/sender-service.js`
- Modify: `src/server.js`
- Modify: `src/server/routes/bilibili-routes.js`

**Interfaces:**
- Consumes: injected auth, room, live state, target, and client factories.
- Produces: `getState()` and `send({ message, mentionRequester })`.

- [x] Write isolated orchestration tests with fake dependencies.
- [x] Move rate limiting, state aggregation, and send orchestration into the service.
- [x] Keep routes as validation and serialization adapters.

### Task 3: Browser module

**Files:**
- Create: `public/js/admin/danmaku-tool.js`
- Modify: `public/js/admin/other.js`
- Modify: `public/js/admin/index.js`

**Interfaces:**
- Consumes: `/api/bilibili/danmaku/state` and `/api/bilibili/danmaku/send`.
- Produces: `window.AdminApp.danmakuTool.init()` and `.refresh()`.

- [x] Move all sender DOM and fetch behavior out of toolbox navigation.
- [x] Retain only a refresh hook in generic feature selection.
- [x] Run static checks and the complete test suite.
