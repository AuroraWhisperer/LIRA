# AI Route Tool Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Suzhou route request finish with a useful answer instead of exhausting tool calls after ambiguous geocoding.

**Architecture:** Improve AMap candidate selection at the coordinate-resolution boundary so the full user query is preferred over a less-specific first result. Raise the default tool-call budget enough for one corrective route round, and preserve the non-thinking setting when adapting official DeepSeek requests to Chat Completions. Add focused regression tests at each boundary.

**Tech Stack:** CommonJS Node.js 24, `node:test`, `node:assert/strict`, native `fetch`.

## Global Constraints

- Keep the existing two-space JavaScript style, semicolons, and CommonJS modules.
- Keep changes surgical and avoid new dependencies.
- Run `npm run check && npm test` before completion.

### Task 1: Lock Down Route Candidate Selection

**Files:**
- Modify: `test/ai-provider-adapters.test.js`
- Modify: `src/ai/tools/amap-tool.js`

- [x] Add a regression test where AMap returns `常熟市园区站(公交站)` before `吴中区苏州园区站(进站口)` and assert the latter coordinate is used for `苏州园区站`.
- [x] Implement a small candidate scorer that prefers a formatted address containing the complete requested place text, with the existing first-match behavior as the fallback.
- [x] Run the focused provider test and verify it passes.

### Task 2: Allow One Corrective Route Round

**Files:**
- Modify: `src/ai/config.js`
- Modify: `test/ai-config-store.test.js`

- [x] Change the new-install default `maxToolCalls` from 4 to 6, preserving the existing allowed range.
- [x] Add an assertion that a fresh AI config exposes 6 as the default.
- [x] Run the focused config test and verify it passes.

### Task 3: Preserve Non-Thinking Mode Through Chat Adaptation

**Files:**
- Modify: `src/ai/deepseek-client.js`
- Modify: `test/ai-provider-adapters.test.js`

- [x] Add a Chat Completions assertion for the disabled-thinking request field used by the provider adapter.
- [x] Add that field only when `reasoningEnabled` is false, leaving reasoning-enabled requests unchanged.
- [x] Run the focused provider tests and verify both official endpoint paths still normalize responses correctly.

### Task 4: Full Verification

**Files:**
- No additional files.

- [x] Run `npm run check`.
- [x] Run `npm test`.
- [x] Review the diff for unrelated changes and report any remaining provider-compatibility risk.
