# AI Web Search and Route Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep current-information and intercity travel questions useful on both Responses and official Chat Completions endpoints.

**Architecture:** Preserve the provider-native `web_search` tool for Responses gateways. For official Chat Completions, adapt it to a strict function tool backed by a small Bing RSS client, then feed normalized title/snippet/url records through the existing tool loop. Tighten the assistant prompt so trains and other current facts use search, while AMap remains for local driving/transit/walking routes.

**Tech Stack:** CommonJS Node.js 24, native `fetch`, `node:test`.

## Global Constraints

- Keep existing two-space JavaScript style, semicolons, and CommonJS modules.
- Do not add dependencies; cap all external response sizes and result counts.
- Run `npm run check && npm test` before completion.

### Task 1: Add Search Client

**Files:** Create `src/ai/tools/web-search-tool.js`; create `test/ai-web-search-tool.test.js`.

- [x] Add `createWebSearchTool({ fetchImpl })` with `search(config, { query })`.
- [x] Request Bing RSS with a bounded query and timeout, parse title/description/link records, decode XML entities, and return at most five results.
- [x] Return public, actionable errors for empty query, timeout, HTTP failure, invalid/empty response.
- [x] Add mocked tests for normalization and failed responses.

### Task 2: Adapt Official Chat Search

**Files:** Modify `src/ai/deepseek-client.js`; modify `test/ai-provider-adapters.test.js`.

- [x] Convert provider-native `{ type: 'web_search' }` into a strict `web_search(query)` function definition in Chat Completions requests.
- [x] Remove the old “当前接口不支持 web_search” capability notice.
- [x] Add assertions for the converted tool and retained normal function tools.

### Task 3: Execute Search and Clarify Route Policy

**Files:** Modify `src/ai/prompt.js`; modify `src/ai/xiaomi-ai-service.js`; modify `src/server.js`; modify `test/xiaomi-ai-service.test.js`.

- [x] State that train/high-speed/flight/concert/news/current-information questions must use `web_search`, and that AMap `get_route` is for local driving/transit/walking only.
- [x] Dispatch `web_search` calls to the injected tool and add the tool to runtime wiring.
- [x] Add a regression test proving a web search function call reaches the model follow-up and produces a delivered answer.

### Task 4: Verify

- [x] Run focused tests, then `npm run check && npm test`.
- [x] Review the diff for unrelated changes and remaining provider/network limitations.
