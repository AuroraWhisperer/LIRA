# AI Danmaku Delivery Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect AI reply chunks missing from the Bilibili room feed, regenerate the answer, and stop after three total attempts.

**Architecture:** A small in-memory verifier observes incoming room danmaku and matches every chunk sent by the logged-in account. The AI delivery path sends, waits for verification, and bypasses the response cache when a failed attempt must be regenerated.

**Tech Stack:** Node.js 24, CommonJS, `node:test`, existing Bilibili WebSocket and HTTP clients.

## Global Constraints

- Count an attempt as successful only when every sent chunk appears in the room feed.
- Regenerate from the same viewer request after an incomplete attempt; do not merely resend the old answer.
- Make no more than three total send attempts.
- Preserve unrelated in-progress AI quota changes in the working tree.

---

### Task 1: Verify sent chunks against room feed events

**Files:**
- Create: `src/ai/danmaku-delivery-verifier.js`
- Test: `test/ai-danmaku-delivery-verifier.test.js`

**Interfaces:**
- Consumes: incoming `{ uid, userName, message }` danmaku and sent `{ accountUid, messages, mentionName, sentAfter }` metadata.
- Produces: `createDanmakuDeliveryVerifier().observe(danmaku)` and `waitForDelivery(delivery)` returning `Promise<boolean>`.

- [x] **Step 1: Write failing tests for complete, partial, and absent delivery**

  Cover exact multi-chunk matches, optional `@name ` prefixes, wrong-account events, duplicate chunks, and timeout returning `false`.

- [x] **Step 2: Run the focused test and verify the module is missing**

  Run: `node --test test/ai-danmaku-delivery-verifier.test.js`

- [x] **Step 3: Implement the minimal buffered verifier**

  Buffer recent observed messages so events arriving between the HTTP send response and waiter registration are not lost; filter by sender UID and send start time; consume one matching event per expected chunk.

- [x] **Step 4: Run the focused test and verify it passes**

  Run: `node --test test/ai-danmaku-delivery-verifier.test.js`

### Task 2: Regenerate and retry AI replies

**Files:**
- Modify: `src/ai/xiaomi-ai-service.js`
- Modify: `src/bilibili/danmaku/sender-service.js`
- Modify: `src/server.js`
- Modify: `test/xiaomi-ai-service.test.js`
- Modify: `test/danmaku-sender-service.test.js`

**Interfaces:**
- Consumes: sender result fields `accountUid`, `messages`, and `sentAfter`; verifier `waitForDelivery` dependency.
- Produces: up to three ordered generate/send/confirm attempts for one accepted AI request.

- [x] **Step 1: Write failing retry tests**

  Assert partial and absent confirmation regenerate and retry, successful confirmation stops immediately, and three failed confirmations stop after exactly three sends.

- [x] **Step 2: Expose sender verification metadata**

  Return the authenticated account UID and send start timestamp from the existing sender result without changing non-AI behavior.

- [x] **Step 3: Implement bounded regeneration**

  Add an optional cache-bypass argument to generation. In delivery, confirm each send; on failure regenerate the same item with cache bypass; stop after three total attempts and log the final swallowed-delivery result.

- [x] **Step 4: Wire incoming room events to the verifier**

  Instantiate the verifier in `src/server.js`, observe each incoming danmaku before normal handling, and inject `waitForDelivery` into the AI service.

- [x] **Step 5: Run focused and full verification**

  Run: `node --test test/ai-danmaku-delivery-verifier.test.js test/xiaomi-ai-service.test.js test/danmaku-sender-service.test.js`

  Run: `npm run check && npm test`
