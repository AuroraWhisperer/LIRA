# Third-party reasoning controls implementation plan

Status: Complete — 2026-11-16; implementation and isolated desktop verification complete, no production relay execution claimed.

## Goal and decisions

Make the configured third-party model's reasoning setting visible and controllable. The user's 2026-11-16 request supersedes the former blanket restriction on third-party Chat reasoning parameters. Follow CC Switch's separation of model capabilities and wire-format conversion, without adding a provider registry or changing the configured URL/protocol.

- Prefer explicit catalog capabilities, including an empty list. For custom/auto OpenAI-compatible endpoints, fall back to the existing exact OpenAI model definitions when metadata is absent. Unknown aliases remain unconfirmed.
- Send supported Chat effort as `reasoning_effort`; Responses continues to send `reasoning.effort`. Unknown third-party Chat models retain parameter omission.
- Project the effective outgoing reasoning setting from the same parameter builder used for requests. Show saved request mode and effort. Models without a supported off mode show an enabled, disabled switch and editable effort selector; do not claim that their minimum effort disables thinking.
- Keep `reasoningEnabled` and `reasoningEffort` storage compatible. Preserve legacy disabled settings on always-thinking models as their minimum supported effort until the user selects a different effort.

## Ownership and scope

- `src/ai/model-reasoning.js`: catalog precedence and exact-model fallback.
- `src/ai/model-endpoint.js`, `src/ai/model-protocol.js`, `src/ai/config-store.js`: custom Chat capability, shared wire parameters and additive public `modelEndpoint.reasoningState` projection.
- `public/js/admin/ai-assistant-config-view.js`, `public/pages/admin/toolbox/danmaku-ai.html`: mode display and honest controls; existing autosave remains the owner of persistence.
- Existing `test/ai/` suites cover actual outgoing fields, catalog isolation, public projection, saving and model changes. Reuse the isolated desktop fixture for a targeted UI check.
- Update `specs/model-provider-capabilities_design.md`, `docs/reference/backend/ai.md`, `docs/reference/backend/api.md`, `docs/guides/third-party-api-support.md`, and `public/pages/admin/toolbox/usage-guide-ai.html`. Check the tour for affected guidance.

No new settings keys, migrations, authentication changes, runtime dependencies, domain/alias heuristics, live-service mutations, commits or release. Preserve unrelated concurrent edits, especially the existing AI markup/test changes.

## Milestones and verification

- [x] Extended existing tests; five initial regressions failed for the expected missing capability/request/UI behavior before implementation.
- [x] Implemented model fallback and shared reasoning-parameter resolution. Model reasoning, third-party endpoints, provider adapters and config-store tests passed.
- [x] Implemented visible state and controls; frontend settings and rendering tests passed. A catalog-refresh regression also covers changing an always-thinking model to one with an explicit off mode.
- [x] Ran affected AI routes, provider contracts, ChatGPT client and response-budget suites. Across the affected suites, 143 distinct tests passed. The first combined run exposed one additive-projection expectation and three overly broad config-refresh regressions; the refresh now updates only reasoning state and preserves drafts.
- [x] Synchronized the owning contract and user guidance. Reviewed the unchanged DeepSeek guide screenshot and tour: its switch remains valid and the tour has no reasoning-specific instructions.

## Desktop evidence

Used `test/fixtures/daily-bot-editor.cjs` with production HTML, preload, desktop request authentication and an owned data directory under `tmp/`. Anonymous `/admin` returned 401; the isolated Electron session loaded it through its normal authentication. The test used an in-memory production config store and real model-client parameter construction with a synthetic transport.

- `gpt-6.1-sol` displayed an enabled, disabled switch and editable `low/medium/high/xhigh/max` tiers; its legacy off preference displayed effective `low`.
- Selecting `high`, saving and testing the connection emitted `reasoning_effort: high`; selecting `low` restored that tier.
- `gpt-6-sol` allowed off, emitted `reasoning_effort: none`, retained off after reload, and returned to an enabled tier through the switch.
- Manual catalog refresh retained state; an unknown alias displayed unconfirmed capability and disabled control; returning to the known model restored its tiers. Visual inspection found the controls and state text visible together.
- The owned Electron process and temporary data directory were closed/removed; only the QA screenshot remains in repository `tmp/`. No user app, credentials or LIRAHUB production requests were used.

## Failure handling and done when

Keep upstream parameter rejection visible through existing errors; never retry by silently dropping the user's reasoning choice. Roll back only task-owned hunks if necessary. Done when the model in the report exposes supported tiers, supported off requests serialize correctly, always-thinking models are identified honestly, controls persist, affected checks pass, and documentation/diff review are complete. Production LIRAHUB execution is a separate evidence boundary: synthetic request inspection does not establish that a relay honors the fields.
