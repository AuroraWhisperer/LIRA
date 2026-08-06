# Xiaomi AI Danmaku Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, modular `小米`-triggered AI assistant to the danmaku tool that can use DeepSeek hosted search, QWeather, AMap, and local time while delivering short mention-aware replies in receive order.

**Architecture:** A dedicated `src/ai/` domain owns configuration, encrypted secrets, provider adapters, safety, prompting, orchestration, caching, and queueing. The server only wires incoming danmaku, API routes, and the existing sender through narrow interfaces; the browser only edits redacted configuration and displays status.

**Tech Stack:** Node.js 24 CommonJS, built-in `fetch`, `node:sqlite`, Electron `safeStorage`, vanilla browser JavaScript, HTML/CSS, `node:test`.

## Global Constraints

- Trigger word defaults to `小米`.
- Model defaults to `ds-v4-flash`, hosted Web Search enabled, reasoning disabled.
- Every Bilibili reply chunk includes `@用户名 ` and is at most 40 Unicode characters including the mention.
- AI replies have a 50-character hard ceiling and are safely truncated server-side; simple replies use about 18–22 Chinese text characters plus optional punctuation or one short emoticon.
- Generations may run concurrently, but complete replies are delivered FIFO one viewer at a time.
- Keys and endpoint URLs start blank; plaintext keys never enter logs or read responses.
- Platform-compliant throttling is required; detection evasion is prohibited.
- Keep modules focused, use JSDoc for public/complex boundaries, and avoid unrelated refactors.

---

### Task 1: Persistence and secret boundary

**Files:**
- Create: `src/ai/config.js`
- Create: `src/ai/config-store.js`
- Create: `src/ai/secret-codec.js`
- Modify: `src/storage/schema.js`
- Modify: `src/storage/database.js`
- Test: `test/ai-config-store.test.js`

**Interfaces:**
- Produces: `createAiConfigStore(db, secretCodec)`, `createElectronSecretCodec()`, `normalizeAiConfig(input, current)`.
- The store returns redacted configuration and explicit `has*Key` booleans.

- [ ] Write failing tests for defaults, validation, encrypted round trips, redacted reads, parameterized log writes, cache/context expiry, and blacklist changes.
- [ ] Run `node --test test/ai-config-store.test.js` and confirm the missing modules fail.
- [ ] Add the focused AI tables and store implementation; reject non-empty secret saves when OS encryption is unavailable.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Provider and tool adapters

**Files:**
- Create: `src/ai/http-client.js`
- Create: `src/ai/deepseek-client.js`
- Create: `src/ai/tools/qweather-tool.js`
- Create: `src/ai/tools/amap-tool.js`
- Create: `src/ai/tools/current-time-tool.js`
- Test: `test/ai-provider-adapters.test.js`

**Interfaces:**
- Produces: `createDeepSeekClient(options).createResponse(input)`, `createQWeatherTool(options)`, `createAmapTool(options)`, `getCurrentTime(input)`.
- All adapters return normalized JSON and throw redacted public errors.

- [ ] Write failing fetch-mock tests for request URL/header/body, timeout, Responses output parsing, hosted search declaration, GeoAPI weather lookup, AMap POI/geocode/route calls, and IANA time-zone formatting.
- [ ] Run the focused test and confirm failures.
- [ ] Implement the minimum adapters using built-in `fetch`, `AbortSignal.timeout`, strict URL parsing, and response-size/error guards.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Prompt, safety, orchestration, and FIFO delivery

**Files:**
- Create: `src/ai/prompt.js`
- Create: `src/ai/safety.js`
- Create: `src/ai/async-coordinator.js`
- Create: `src/ai/xiaomi-ai-service.js`
- Test: `test/xiaomi-ai-service.test.js`

**Interfaces:**
- Consumes: redacted/full config accessors, provider/tools, `sendReply({ message, mentionTarget, mentionEveryChunk })`.
- Produces: `createXiaomiAiService(dependencies)` with `handleDanmaku`, `getStatus`, `testConfiguration`, and `shutdown`.

- [ ] Write failing tests for exact trigger behavior, local unsafe rejection before tools, structured model safety checks, tool routing/loop limit, ambiguity clarification, user/room throttles, cache, context inheritance, bounded generation concurrency, and sequence-preserving delivery.
- [ ] Run the focused test and confirm failures.
- [ ] Implement the fixed simplified-Chinese cat prompt, tool schemas/rules, local safety fallback, and coordinator with independent generation/delivery phases.
- [ ] Re-run the focused test and confirm it passes with no unhandled rejections.

### Task 4: Mention-aware sending and runtime wiring

**Files:**
- Modify: `src/bilibili/danmaku/sender-service.js`
- Modify: `src/server.js`
- Test: `test/danmaku-sender-service.test.js`
- Test: `test/bilibili-startup-wiring.test.js`

**Interfaces:**
- Extends: `send({ message, mentionTarget, mentionEveryChunk })` without changing its default behavior.
- Connects: live `onMessage` events to `xiaomiAi.handleDanmaku` and the AI delivery callback to `danmakuSender.send`.

- [ ] Add a failing sender test proving each chunk reserves and repeats the mention while legacy callers still mention only once.
- [ ] Add a failing wiring test proving each incoming danmaku is offered to the AI service without blocking existing handlers.
- [ ] Implement the opt-in split/send mode and runtime lifecycle wiring with concise warning logs.
- [ ] Run both focused tests and confirm they pass.

### Task 5: Administration API

**Files:**
- Create: `src/server/routes/ai-routes.js`
- Modify: `src/server/api-routes.js`
- Modify: `src/server.js`
- Test: `test/ai-routes.test.js`

**Interfaces:**
- Produces: `GET /api/ai/config`, `PUT /api/ai/config`, `GET /api/ai/status`, and `POST /api/ai/test`.
- Consumes: `context.ai` facade only; routes do not access databases or providers directly.

- [ ] Write failing route tests for authentication inheritance, allowlisted fields, invalid URLs/numbers, preserving blank secret inputs, clearing secrets explicitly, redacted reads, and safe upstream test errors.
- [ ] Run the focused test and confirm failures.
- [ ] Add the route module and narrow runtime context facade.
- [ ] Re-run the focused test and confirm it passes.

### Task 6: Danmaku-tool user interface

**Files:**
- Modify: `public/pages/admin.html`
- Create: `public/js/admin/xiaomi-ai-settings.js`
- Modify: `public/js/admin/index.js`
- Modify: `public/js/admin/danmaku-tool.js`
- Modify: `public/css/admin/other-features.css`
- Test: `test/frontend-regressions.test.js`

**Interfaces:**
- The frontend reads only redacted config/status and sends explicit config changes.
- `window.AdminApp.xiaomiAiSettings` exposes `init()` and `refresh()` for the existing danmaku feature lifecycle.

- [ ] Add failing regression assertions for section placement, blank secret and URL inputs, defaults, accessible labels/status, save/test controls, module import, and safe `textContent` rendering.
- [ ] Run the focused test and confirm failures.
- [ ] Add the compact cat-status section, responsive form grid, validation, dirty-state-safe secret updates, and clear loading/error/success states.
- [ ] Re-run the focused test and confirm it passes.

### Task 7: Full verification and visual QA

**Files:**
- Modify only files that fail verification because of this feature.

- [ ] Run `npm run check` and fix feature-related syntax failures.
- [ ] Run `npm test` and fix feature-related regressions without changing unrelated behavior.
- [ ] Launch the desktop/admin page with a temporary data directory, capture desktop and narrow-width screenshots, and inspect placement, overflow, focus, blank defaults, and status readability.
- [ ] Remove only temporary artifacts created by this verification and record the final commands/results.
