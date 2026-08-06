# AI Request Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make official DeepSeek configurations work for live AI replies and record every model request, raw response, parsed result, and failure in `logs/ai.log` without exposing API keys.

**Architecture:** The DeepSeek client selects Chat Completions only for the official DeepSeek base URL and retains the existing Responses protocol for complete custom gateway URLs. A focused JSON-lines logger receives lifecycle events from the client; the server places its file beside the existing desktop and terminal logs.

**Tech Stack:** Node.js 24, CommonJS, built-in `fetch`, `node:fs/promises`, `node:test`.

## Global Constraints

- Keep custom Responses API gateway behavior unchanged.
- Store AI diagnostics in the existing `logs` directory as `ai.log`; do not create another directory.
- Never write API keys or Authorization values to the AI log.
- Touch only the AI client, logger wiring, and their tests.

---

### Task 1: Official DeepSeek protocol alignment

**Files:**
- Modify: `src/ai/deepseek-client.js`
- Test: `test/ai-provider-adapters.test.js`

**Interfaces:**
- Consumes: `createDeepSeekClient({ fetchImpl, logEvent })`
- Produces: `createResponse(request)` supporting official Chat Completions and custom Responses endpoints.

- [ ] **Step 1: Replace the misleading official-base regression assertion**

Assert that `https://api.deepseek.com` sends both connection tests and normal generation to `/chat/completions`, converts instructions/input to messages, converts function definitions to Chat Completions tools, and normalizes text/tool calls/token usage.

- [ ] **Step 2: Run the provider adapter test and confirm it fails**

Run: `node --test test/ai-provider-adapters.test.js`
Expected: FAIL because normal requests currently post Responses JSON to the API root.

- [ ] **Step 3: Implement the minimum protocol adapter**

Detect only the official root or `/v1` base, convert Responses-style requests to Chat Completions requests, retain short-lived tool-call message history by response ID, and reject an empty model response with `DEEPSEEK_INVALID_RESPONSE`.

- [ ] **Step 4: Run the provider adapter test**

Run: `node --test test/ai-provider-adapters.test.js`
Expected: PASS.

### Task 2: Dedicated AI JSON-lines log

**Files:**
- Create: `src/ai/request-logger.js`
- Modify: `src/ai/deepseek-client.js`
- Modify: `src/ai/xiaomi-ai-service.js`
- Modify: `src/server.js`
- Create: `test/ai-request-logger.test.js`
- Test: `test/ai-provider-adapters.test.js`

**Interfaces:**
- Produces: `createAiRequestLogger({ filePath }).log(event)`.
- Consumes: DeepSeek client `logEvent(event)` callback.

- [ ] **Step 1: Write logger and client trace tests**

Verify JSONL creation, ordered events, request/response correlation, purpose labels, raw response retention, and recursive replacement of API keys and authorization fields.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `node --test test/ai-request-logger.test.js test/ai-provider-adapters.test.js`
Expected: FAIL because the logger and trace callback do not exist.

- [ ] **Step 3: Implement logging and server wiring**

Append UTF-8 JSON lines asynchronously to `<data parent>/logs/ai.log`, call the logger before and after upstream requests and normalization, record errors before rethrowing, and label input review, generation, tool follow-up, output review, and connection-test calls.

- [ ] **Step 4: Run targeted tests**

Run: `node --test test/ai-request-logger.test.js test/ai-provider-adapters.test.js test/xiaomi-ai-service.test.js`
Expected: PASS.

### Task 3: Repository verification

**Files:**
- Verify only; no additional files expected.

**Interfaces:**
- Consumes: all changes from Tasks 1 and 2.
- Produces: syntax-clean and regression-tested repository state.

- [ ] **Step 1: Run static checks**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 2: Run the full serial test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check` and `git status --short`
Expected: no whitespace errors and only the planned files changed.
