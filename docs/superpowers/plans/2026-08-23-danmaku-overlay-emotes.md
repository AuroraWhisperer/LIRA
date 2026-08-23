# 弹幕姬独立页面与 Bilibili 表情支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将弹幕姬从手动发送区拆开，提供固定 `/danmaku` 直播页面、全新的信号带视觉，并正确显示 Bilibili 整条与行内表情。

**Architecture:** Bilibili 解析器从 `DANMU_MSG.info[0][15]` 及其 `extra` JSON 中提取并校验表情元数据，消息处理器继续产出一个规范化弹幕对象。服务端用不持久化的有界内存缓冲保存最近消息，将首帧放入 WebSocket snapshot，并以 `danmaku:message` 推送增量；独立 Overlay 与管理页预览复用同一页面和无状态 DOM 组件。

**Tech Stack:** Node.js 24+, CommonJS backend, Vanilla JavaScript ES modules, native CSS, Electron 43, `node:test`.

## Global Constraints

- 保持模块化单体，不新增依赖、进程、端口、前端框架或构建步骤。
- 固定页面路径为 `/danmaku`，实际管理页地址使用当前本机服务 origin；页面可被 OBS / 直播姬嵌入。
- Bilibili 图片只接受 `https://*.hdslb.com/*`，并继续通过现有 `/api/bilibili/avatar` 受信任图片代理加载。
- 弹幕文字与表情替代文本必须通过 DOM API / `textContent` 渲染，不插入不可信 HTML。
- 弹幕流只保存在内存中，不新增数据库 schema、设置键或用户数据持久化。
- 以 Electron 桌面管理页和透明直播页面为主要验收目标；保留现有 `/games` 行为。
- 不创建 Git 提交，保留与本任务无关的用户修改。

---

### Task 1: 解析并传递 Bilibili 表情元数据

**Files:**
- Modify: `src/bilibili/parsers/danmaku-parser.js`
- Modify: `src/bilibili/packet-parser.js`
- Modify: `src/bilibili/danmaku/message-handlers.js`
- Test: `test/bilibili-danmaku-parser.test.js`
- Test: `test/danmaku-client.test.js`

**Interfaces:**
- Consumes: `DANMU_MSG.info`, including `info[0][15].emoticon`, `info[0][15].emots`, and JSON-encoded `info[0][15].extra`.
- Produces: `extractBilibiliDanmakuEmotes(info) -> Array<{text:string,url:string,width:number,height:number}>` and `onMessage({ ..., emotes })`.

- [x] **Step 1: Write parser regressions for whole-message and inline emotes**

```js
assert.deepEqual(extractBilibiliDanmakuEmotes(info), [{
  text: '[妙]',
  url: 'https://i0.hdslb.com/bfs/emote/miao.png',
  width: 64,
  height: 64
}]);
```

- [x] **Step 2: Run the focused parser tests and confirm the new export is missing**

Run: `node --test test/bilibili-danmaku-parser.test.js`

Expected: FAIL because `extractBilibiliDanmakuEmotes` is not implemented.

- [x] **Step 3: Implement the minimal trusted-image parser**

Parse object or JSON forms, inspect both the outer option object and nested `extra`, discard entries without a non-empty trigger or trusted `*.hdslb.com` image URL, clamp dimensions to safe positive integers, and deduplicate by trigger text.

- [x] **Step 4: Attach parsed emotes to the existing message callback**

```js
this.handlers.onMessage({
  message: text,
  emotes: packetParser.extractBilibiliDanmakuEmotes(info),
  // existing identity and trace fields remain unchanged
});
```

- [x] **Step 5: Run parser and client regressions**

Run: `node --test test/bilibili-danmaku-parser.test.js test/danmaku-client.test.js`

Expected: PASS with ordinary messages still returning an empty `emotes` array.

### Task 2: Publish a bounded live danmaku feed

**Files:**
- Create: `src/bilibili/danmaku/feed-buffer.js`
- Modify: `src/server/bilibili-client.js`
- Modify: `src/server.js`
- Test: `test/danmaku-feed-buffer.test.js`

**Interfaces:**
- Consumes: normalized `onMessage(danmaku)` payload and active `roomId`.
- Produces: `createDanmakuFeedBuffer({limit}).setRoom(roomId)`, `.push(danmaku)`, `.getSnapshot()`, `.clear()`; WebSocket `danmaku:message` with `{item}`; snapshot `state.danmakuFeed`.

- [x] **Step 1: Write feed-buffer tests**

Cover public-field projection, monotonically increasing local IDs, configured capacity, defensive snapshots, and clearing only when the room ID actually changes.

- [x] **Step 2: Run the focused test and confirm the module is missing**

Run: `node --test test/danmaku-feed-buffer.test.js`

Expected: FAIL with `MODULE_NOT_FOUND`.

- [x] **Step 3: Implement the bounded in-memory buffer**

```js
const feed = createDanmakuFeedBuffer({ limit: 40 });
feed.setRoom(roomId);
const item = feed.push(danmaku);
```

Only expose `id`, `uid`, `name`, `message`, `avatarUrl`, `guardLevel`, `medalName`, `medalLevel`, `timestamp`, and validated `emotes`.

- [x] **Step 4: Wire snapshot and incremental publication at the composition root**

Call `feed.setRoom(roomId)` when building the active Bilibili client, call `publishDanmaku(danmaku)` before downstream command/game processing, include `danmakuFeed` in `getState()`, and broadcast `{type:'danmaku:message', item}`.

- [x] **Step 5: Run the buffer and Bilibili runtime regressions**

Run: `node --test test/danmaku-feed-buffer.test.js test/bilibili-runtime.test.js test/danmaku-client.test.js`

Expected: PASS without changing current command, game, gift, or sender contracts.

### Task 3: Build the fixed `/danmaku` signal-feed Overlay

**Files:**
- Create: `public/pages/overlays/danmaku.html`
- Create: `public/js/overlays/danmaku.js`
- Create: `public/css/overlays/danmaku.css`
- Modify: `public/js/overlays/danmaku-feed.js`
- Modify: `public/css/overlays/games.css`
- Modify: `src/server/http-utils.js`
- Test: `test/danmaku-overlay.test.js`
- Test: `test/games-overlay.test.js`
- Test: `test/admin-page-composition.test.js`

**Interfaces:**
- Consumes: snapshot `state.danmakuFeed`, incremental `danmaku:message`, and shared `createDanmakuFeed(root, {resolveAvatarUrl, resolveEmoteUrl, ...})`.
- Produces: fixed frameable `/danmaku` page; safe mixed text/image message DOM; `?preview=1` deterministic preview mode.

- [x] **Step 1: Write route, contract, and safe-rendering regressions**

Require the `/danmaku` page mapping and frame exception, ESM entry, snapshot plus incremental consumers, image proxy resolver, `textContent`, no `innerHTML`, and inline/whole-emote DOM tests.

- [x] **Step 2: Run the focused overlay tests and confirm they fail**

Run: `node --test test/danmaku-overlay.test.js test/games-overlay.test.js test/admin-page-composition.test.js`

Expected: FAIL because the fixed page and emote renderer do not exist.

- [x] **Step 3: Extend the shared renderer with safe message segments**

Build text spans and `<img class="draw-danmaku-emote">` nodes from exact trigger matches, use proxy-resolved URLs, preserve trigger text as `alt`, and replace failed images with their text fallback.

- [x] **Step 4: Implement the live Overlay controller**

Load the connect snapshot, append and deduplicate incremental items, reconnect with bounded exponential backoff, and render local samples only when `preview=1`.

- [x] **Step 5: Implement the signal-feed visual**

Use a transparent stage, compact signal header, chamfered dark message strips, restrained cyan/gold/violet accents, `Bahnschrift SemiCondensed` headings, `Microsoft YaHei UI` body, `Cascadia Mono` utility labels, responsive sizing, keyboard-readable contrast, and reduced-motion fallback.

- [x] **Step 6: Run focused overlay tests**

Run: `node --test test/danmaku-overlay.test.js test/games-overlay.test.js test/admin-page-composition.test.js`

Expected: PASS; `/games` still renders its existing bubble style while gaining emote images.

### Task 4: Separate Admin preview and sender, then update contracts

**Files:**
- Modify: `public/pages/admin/toolbox/danmaku.html`
- Modify: `public/js/admin/danmaku-tool.js`
- Modify: `public/css/admin/other-features/danmaku-tool.css`
- Modify: `public/pages/admin/toolbox/usage-guide.html`
- Modify: `docs/architecture/frontend/overlays.md`
- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/backend/bilibili/danmaku.md`
- Modify: `docs/architecture/backend/ws.md`
- Test: `test/frontend-admin-ai.test.js`

**Interfaces:**
- Consumes: `localOverlayOrigin()`, `copyText()`, fixed `/danmaku?preview=1` iframe, and existing sender form IDs.
- Produces: a standalone “弹幕姬” section with read-only URL/copy/open controls and exact preview; a sibling “发送弹幕” section with unchanged send behavior.

- [x] **Step 1: Update static Admin regressions**

Assert the fixed URL controls and preview iframe exist, the sender section is not nested inside the overlay section, and the legacy direct sample renderer import is removed.

- [x] **Step 2: Run the Admin regression and confirm it fails**

Run: `node --test test/frontend-admin-ai.test.js`

Expected: FAIL against the currently nested preview/sender structure.

- [x] **Step 3: Split the fragment and bind URL controls**

Set the read-only value to `${localOverlayOrigin()}/danmaku`, copy with `copyText`, open with `window.open(..., 'noopener')`, and keep all sender form IDs and behavior unchanged.

- [x] **Step 4: Align Admin styles and usage copy**

Give the address deck and exact-page preview clear desktop hierarchy; remove CSS that only served the old in-page sample bubbles; explain that `/danmaku` is the fixed browser-source address and the send form is a separate operation area.

- [x] **Step 5: Update architecture owners**

Document the normalized emote shape and proxy rule, bounded `danmakuFeed` snapshot field, `danmaku:message` event, `/danmaku` consumer, and revised Admin responsibilities.

- [x] **Step 6: Run repository gates and review the final diff**

Run: `node --test test/bilibili-danmaku-parser.test.js test/danmaku-feed-buffer.test.js test/danmaku-overlay.test.js test/games-overlay.test.js test/frontend-admin-ai.test.js test/admin-page-composition.test.js`, `npm run check`, `npm run verify:docs`, `npm run verify:architecture`, `npm run verify:quick`, `git diff --check`, and `git status --short`.

Expected: all focused and quick gates pass; every changed line belongs to the independent overlay, emote rendering, Admin separation, tests, or owning docs.
