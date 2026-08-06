# AI Danmaku Reply Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI replies prefer one Bilibili message, use two when useful, allow a third only for information-heavy answers, and deliver every chunk without splitting short emoticons or triggering immediate-send failures.

**Architecture:** Keep Bilibili's 40-character transport limit in the sender and calculate available body capacity from the actual mention name. Give the model a per-request soft length budget based on one, two, and three message capacities; enforce only a three-message safety ceiling after review. Split at natural punctuation or before a short trailing emoticon, and pace chunks with an independent random 500–1000 ms interval. Increase model completion capacity and distinguish length-truncated/invalid tool output from generic empty responses.

**Tech Stack:** Node.js 24, CommonJS, `node:test`, built-in `Intl.Segmenter`.

## Global Constraints

- A Bilibili message, including the visible `@name ` prefix, is at most 40 grapheme clusters.
- Prefer one message, use two for fact-rich answers, and use three only when the answer genuinely needs it.
- Never emit more than three AI reply messages.
- Preserve short trailing emoticons as a unit when choosing a chunk boundary.
- Do not add dependencies or alter unrelated bot reply behavior.

---

### Task 1: Dynamic reply budget and delivery pacing

**Files:**
- Modify: `src/ai/xiaomi-ai-service.js`
- Modify: `test/xiaomi-ai-service.test.js`

**Interfaces:**
- Consumes: `splitTextIntoCharacters(text)` and the current danmaku `userName`.
- Produces: `getReplyLengthBudget(userName, preferredChars)` and a three-message post-review ceiling.

- [x] **Step 1: Write failing tests** proving instructions state the one/two/three-message capacities for the current mention, short answers prefer one message, and delivery passes the configured interval instead of zero.
- [x] **Step 2: Run** `node --test test/xiaomi-ai-service.test.js` and confirm the new assertions fail.
- [x] **Step 3: Implement** dynamic capacity calculation, per-request instructions, a three-message-only truncation ceiling, 1024 generation/tool-follow-up tokens, and independent 500–1000 ms chunk pacing.
- [x] **Step 4: Run** `node --test test/xiaomi-ai-service.test.js` and confirm it passes.

### Task 2: Natural chunk boundaries

**Files:**
- Modify: `src/bilibili/danmaku/sender-service.js`
- Modify: `test/danmaku-sender-service.test.js`

**Interfaces:**
- Consumes: body capacity after reserving `@name `.
- Produces: `splitDanmakuEveryMentionMessage(message, target, limit)` with punctuation-aware and emoticon-aware boundaries.

- [x] **Step 1: Write failing tests** for `(｡･ω･｡)` near a boundary, punctuation preference, full reconstruction, per-message length, and inter-chunk delay.
- [x] **Step 2: Run** `node --test test/danmaku-sender-service.test.js` and confirm the new assertions fail.
- [x] **Step 3: Implement** minimal boundary selection that keeps a short trailing parenthesized emoticon together when it fits in the next chunk and otherwise prefers nearby punctuation.
- [x] **Step 4: Run** `node --test test/danmaku-sender-service.test.js` and confirm it passes.

### Task 3: Accurate model truncation diagnostics

**Files:**
- Modify: `src/ai/deepseek-client.js`
- Modify: `test/ai-provider-adapters.test.js`

**Interfaces:**
- Consumes: Chat Completions `choices[0].finish_reason` and tool-call argument strings.
- Produces: `DEEPSEEK_OUTPUT_TRUNCATED` for length-ended empty or malformed responses instead of ambiguous generic errors.

- [x] **Step 1: Write failing tests** for an empty `finish_reason: length` response and malformed tool JSON returned with `finish_reason: length`.
- [x] **Step 2: Run** `node --test test/ai-provider-adapters.test.js` and confirm the new assertions fail.
- [x] **Step 3: Implement** finish-reason propagation and error remapping without changing successful response normalization.
- [x] **Step 4: Run** `node --test test/ai-provider-adapters.test.js` and confirm it passes.

### Task 4: Settings copy and repository verification

**Files:**
- Modify: `public/pages/admin.html`
- Modify: `test/frontend-regressions.test.js`

**Interfaces:**
- Consumes: existing `replyMaxChars` preference.
- Produces: UI copy that describes a soft length preference and the one/two/three-message policy.

- [x] **Step 1: Update regression expectations** to require soft-preference wording rather than an absolute hard limit.
- [x] **Step 2: Update the settings hint** while retaining the existing stored setting and input compatibility.
- [x] **Step 3: Run** `node --experimental-vm-modules --test test/frontend-regressions.test.js`.
- [x] **Step 4: Run** `npm run check` and `npm test`; fix only regressions caused by these changes.
