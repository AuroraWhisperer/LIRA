# Third-Party OpenAI API Compatibility Implementation Plan

**Status:** Complete (2026-08-17)

> **For agentic workers:** Execute this plan inline because the optional
> `superpowers:executing-plans` skill is not available in this workspace. Track
> each milestone and verify it before continuing.

**Goal:** Allow the existing AI assistant to use an OpenAI-compatible third-party API when the user enters either its site root or `/v1` base URL, without breaking DeepSeek official Chat Completions or complete Responses API URLs.

**Architecture:** Keep `src/ai/deepseek-client.js` as the only model-provider boundary. Resolve only unambiguous OpenAI base URLs into Chat Completions endpoints, leave complete `/responses` endpoints on the Responses protocol, and retain DeepSeek-specific request fields only for the official DeepSeek host.

**Tech Stack:** Node.js 24+, CommonJS, native `fetch`, Vanilla JavaScript ES modules, `node:test`.

## Global Constraints

- Preserve existing settings keys, HTTP routes, secret encryption, and public error shapes.
- Do not add dependencies, services, ports, or persistence changes.
- Never commit, log, or return the supplied temporary API Key.
- Preserve complete Responses API URLs and DeepSeek official endpoint behavior.
- Treat existing unrelated worktree changes as user-owned.

## Non-goals

- Supporting streaming or SSE responses; the target service returns standard JSON when `stream: false`.
- Automatic provider discovery through speculative network requests.
- Renaming persisted `deepseek*` configuration keys.

## Current Behavior

- Model listing converts a `/v1` base URL to `/v1/models`, so the target service returns 65 models.
- Model generation only adapts `api.deepseek.com`; a third-party `/v1` URL is posted unchanged and parsed as Responses API output.
- The attempted `reasoning_content` normalization change is behaviorally identical to the original code and does not affect endpoint selection.
- A live, redacted probe confirmed the target service accepts `POST /v1/chat/completions` with `stream: false` and returns `application/json` with `object: "chat.completion"`.

## Ownership

- Owner: `src/ai/deepseek-client.js`
- Contract: `docs/architecture/backend/ai.md`
- Consumers: `src/ai/ai-assistant-service.js`, `src/server/routes/ai-routes.js`, `public/js/admin/ai-assistant-settings.js`
- Focused tests: `test/ai-provider-adapters.test.js`, `test/third-party-api-compatibility.test.js`, `test/frontend-admin-ai.test.js`

## Three-Perspective Design

### Frontend

- Keep the existing URL input and validation.
- State accurately that root URLs, `/v1` base URLs, and complete `/responses` or `/chat/completions` URLs are accepted.
- Preserve loading, autosave, and provider-test behavior.

### Backend

- Introduce one endpoint resolver returning the final URL, protocol, and whether Chat Completions adaptation is active.
- Map non-DeepSeek roots to `/v1/chat/completions`, any `/v1` base to `/v1/chat/completions`, and complete `/chat/completions` URLs to Chat Completions unchanged.
- Keep complete `/responses` and unknown complete paths on the Responses protocol unchanged.
- Send `thinking: { type: "disabled" }` only to official DeepSeek Chat Completions endpoints.
- Resolve non-DeepSeek root model-list URLs to `/v1/models`, while preserving DeepSeek official `/models` behavior.

### Security

- Existing admin API authorization and secret encryption remain unchanged.
- Server-side URL validation remains authoritative; frontend URL validation is only a usability guard.
- Authorization headers remain excluded from model request logs, and configured secrets continue through the existing redactor.
- Replace the temporary Key in the local support document with a placeholder.
- No user-controlled value is interpolated as HTML.

## Milestones

### Milestone 1: Regression coverage

- Add a test using `https://gcli.ggchan.dev/` and assert the requested URL is `https://gcli.ggchan.dev/v1/chat/completions`.
- Add a test using `https://gcli.ggchan.dev/v1` and assert Chat Completions request/response normalization.
- Assert generic third-party requests omit the DeepSeek-specific `thinking` field.
- Preserve tests for complete `/responses`, complete `/chat/completions`, and official DeepSeek bases.

Focused verification: `node --test test/third-party-api-compatibility.test.js test/ai-provider-adapters.test.js` must first expose the current incorrect URL and then pass after implementation.

### Milestone 2: Minimal provider implementation

- Replace host-only routing with deterministic endpoint-shape routing in `src/ai/deepseek-client.js`.
- Reuse the existing request builders, response normalizers, history handling, error mapping, and logging.
- Do not introduce fallback retries that could duplicate billable model requests.

Focused verification: the tests from Milestone 1 pass with exact URL and body assertions.

### Milestone 3: User-facing contract and secret hygiene

- Update `public/pages/admin/toolbox/danmaku.html` and `public/js/admin/ai-assistant-settings.js` with accepted URL forms.
- Update `docs/architecture/backend/ai.md`, the owning contract.
- Correct `docs/third-party-api-support.md` and remove the plaintext temporary Key.

Focused verification: `node --test test/frontend-admin-ai.test.js` and `npm run verify:docs` pass.

### Milestone 4: End-to-end verification

- Run a real connection test through `createDeepSeekClient` using the temporary Key loaded only into process memory; print only protocol metadata and reply presence.
- Run `node --test test/third-party-api-compatibility.test.js test/ai-provider-adapters.test.js test/ai-routes.test.js test/frontend-admin-ai.test.js`.
- Run `npm run check` and `npm run verify:quick`.
- Review `git diff --check`, scoped `git diff`, cached diff, and `git status --short`.

## Verification Results

- Live target service: 65 models listed; `createDeepSeekClient.testConnection` returned a non-empty reply through the automatically adapted Chat Completions endpoint.
- Focused AI, route, and Admin tests: 43 passed.
- `npm run verify:docs`: 5 passed.
- `npm run check`: 363 JavaScript files passed syntax checking.
- `npm run verify:quick`: documentation, syntax, and 9 architecture checks passed.
- `npm test`: 620 tests, 619 passed, 1 skipped, 0 failed.
- Secret scan: no supplied temporary Key remains in source, tests, specifications, or documentation.

## Rollback Or Failure Handling

- Stop after any failing focused test and inspect the scoped diff.
- Reverse only task-owned hunks with `apply_patch`; do not use blanket checkout, reset, or deletion.
- If the live service differs from the probed JSON contract, retain the deterministic tests and report the exact redacted content type/status before expanding scope.

## Done When

- Root and `/v1` third-party URLs successfully use Chat Completions.
- Complete Responses endpoints and official DeepSeek behavior remain covered and passing.
- No Key appears in tracked or untracked task documents or source diffs.
- Focused tests, documentation verification, syntax checks, and quick verification pass.
- Final diff contains only task-related changes plus pre-existing user changes.
