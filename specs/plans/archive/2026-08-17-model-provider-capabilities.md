# Model Provider Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Those optional skills are unavailable in this workspace, so execute inline with the same test-first checkpoints.

**Goal:** Add explicit model wire protocol and reasoning-effort configuration, then make the Admin UI show only the capabilities that the resolved provider protocol can actually control.

**Architecture:** Extract endpoint resolution into one AI-domain module shared by request construction and public capability projection. Preserve automatic compatibility as the default, while allowing explicit Responses or Chat Completions selection and conditional UI controls.

**Tech Stack:** Node.js 24+, CommonJS, native `fetch`, Vanilla JavaScript ES modules, CSS, `node:test`.

## Global Constraints

- Follow `specs/model-provider-capabilities_design.md` exactly.
- Preserve existing API paths, response envelopes, encrypted secrets, settings keys, and unrelated worktree changes.
- Add no runtime dependency, database schema, process, port, or frontend build step.
- Do not commit automatically.

---

## Goal

Complete the accepted design with deterministic endpoint routing, validated persisted enums, a capability-aware Admin form, owner documentation, and regression coverage.

## Non-goals

- Provider-domain presets, automatic remote capability discovery, streaming, retries, or failover.

## Current Behavior

- URL shape alone chooses protocol.
- All providers see the same two capability checkboxes.
- Responses has only on/off reasoning; custom Chat receives no reasoning control.

## Ownership

- Owner: `src/ai/`
- Contracts: `docs/architecture/backend/ai.md`, `docs/architecture/backend/api.md`, `docs/architecture/frontend/app.md`
- Consumers: `src/server/routes/ai-routes.js`, `public/js/admin/ai-assistant-settings.js`
- Tests: `test/ai-config-store.test.js`, `test/ai-provider-adapters.test.js`, `test/ai-routes.test.js`, `test/frontend-admin-ai.test.js`, `test/third-party-api-compatibility.test.js`

## Compatibility Constraints

- Default `auto` must preserve all current endpoint tests.
- Existing `reasoningEnabled` remains persisted and accepted.
- New public fields are additive and contain no secrets.

## Task 1: Configuration contract and endpoint owner

**Files:**

- Create: `src/ai/model-endpoint.js`
- Modify: `src/ai/config.js`
- Modify: `src/ai/config-store.js`
- Modify: `src/server/routes/ai-routes.js`
- Test: `test/ai-config-store.test.js`
- Test: `test/ai-routes.test.js`

**Interfaces:**

- `resolveModelEndpoint(url, protocolPreference)` returns `{url, protocol, adapted, officialDeepSeek}`.
- `resolveModelsEndpoint(url)` returns the model-list URL.
- `describeModelEndpoint(url, protocolPreference)` returns the public capability enums defined by the specification.

- [x] Add regression tests for enum defaults, validation, persistence, route allow-listing, and secret-free capability projection.
- [x] Run `node --test test/ai-config-store.test.js test/ai-routes.test.js`.
- [x] Implement fixed-enum normalization, centralized endpoint resolution, and public capability projection.
- [x] Run the focused tests and confirm they pass.

## Task 2: Protocol and reasoning request behavior

**Files:**

- Modify: `src/ai/deepseek-client.js`
- Test: `test/ai-provider-adapters.test.js`
- Test: `test/third-party-api-compatibility.test.js`

**Interfaces:**

- Consumes the endpoint helpers from Task 1.
- Responses reasoning uses `reasoningEnabled` plus `reasoningEffort`; Chat behavior remains provider-safe.

- [x] Add regression tests for explicit Responses/Chat roots, high reasoning effort, automatic compatibility, and absence of Chat reasoning fields.
- [x] Run `node --test test/ai-provider-adapters.test.js test/third-party-api-compatibility.test.js`.
- [x] Replace the in-file resolver with the shared helper and construct the Responses reasoning object from validated config.
- [x] Run the focused tests and confirm they pass.

## Task 3: Capability-aware Admin interface

**Files:**

- Modify: `public/pages/admin/toolbox/danmaku.html`
- Modify: `public/js/admin/ai-assistant-settings.js`
- Modify: `public/css/admin/other-features/ai-assistant.css`
- Test: `test/frontend-admin-ai.test.js`

**Interfaces:**

- Reads `modelApiProtocol`, `reasoningEffort`, and server-derived `modelEndpoint` from the existing config response.
- Submits new fields through the existing autosave flow.

- [x] Add DOM and interaction tests for the protocol selector, capability rail, Responses effort control, DeepSeek toggle, and provider-managed Chat state.
- [x] Run `node --experimental-vm-modules --test test/frontend-admin-ai.test.js`.
- [x] Add the compact capability rail and conditional rendering using fixed text and `hidden`/`disabled` states.
- [x] Run the Admin test and confirm it passes.

## Task 4: Contracts and gates

**Files:**

- Modify: `docs/architecture/backend/ai.md`
- Modify: `docs/architecture/backend/api.md`
- Modify: `docs/third-party-api-support.md`
- Modify: `specs/README.md`
- Archive: `specs/plans/archive/2026-08-17-model-provider-capabilities.md`

- [x] Update owner documents with the exact config enums, endpoint rules, request fields, and capability projection.
- [x] Run `npm run verify:docs`, then focused AI/Admin tests.
- [x] Run `npm run check`, `npm run verify:quick`, and `npm test`.
- [x] Mark the specification Implemented, record verification results, and archive this plan.
- [x] Review `git diff`, `git diff --check`, `git diff --cached`, `git status --short`, and scan for credentials.

## Results

- Focused AI/config/routes/provider/Admin tests passed.
- DeepSeek official Chat reasoning effort support was added after confirming the current official `reasoning_effort` contract.
- Desktop and 375 px responsive browser checks showed no horizontal overflow.
- `npm run verify:docs`, `npm run check`, and `npm run verify:quick` passed.
- `npm test`: 625 tests, 624 passed, 1 skipped, 0 failed.

## Rollback Or Failure Handling

- Stop at the first failing focused checkpoint and inspect only task-owned files.
- Reverse task-owned hunks with `apply_patch`; do not use reset, blanket checkout, or broad deletion.
- If a provider rejects an explicitly selected protocol, return the existing safe upstream error and let the user change the protocol; do not retry another billable protocol automatically.

## Done When

- Every acceptance criterion in the design specification has passing evidence.
- Automatic mode remains backward compatible.
- The Admin UI accurately distinguishes hosted search, local tool search, DeepSeek thinking, Responses effort, and provider-managed Chat reasoning.
- Full gates pass and no secret or unrelated content enters the task diff.
