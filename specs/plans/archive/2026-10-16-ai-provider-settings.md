# AI provider settings restoration

Status: Completed

## Goal and boundaries

Show a saved API key as its first six characters plus `********` (keys of twelve
characters or fewer remain fully masked), and restore the persona previously
selected for each AI platform, including after reopening the settings page.
Keep the current key storage, origin validation, provider contracts and persona
pack format. Do not add separate provider credentials or change the active user
installation. Existing unrelated workspace edits must remain intact.

## Current behavior and ownership

`public/js/admin/ai-assistant-config-view.js` leaves saved password values empty
but still shows the unsaved placeholder. `ai-assistant-personas.js` falls back
from cat to general on an incompatible platform and forgets the prior choice.
`src/ai/config-store.js` owns configuration persistence and its public projection.
Use its existing transaction and `ai_configuration` key/value table: add a
server-maintained `providerPersonaIds` JSON row and a read-only public map. Derive
`deepseekApiKeyPreview`, `qweatherApiKeyPreview`, and `amapApiKeyPreview` in the
public projection; complete secrets remain excluded. Remembered deleted roles
fall back to general. The frontend uses the saved map plus pending local choices.

## Work and verification

- [x] Extend existing config-store and settings tests to reproduce the missing
  preview, platform round trip, reload, deletion, and failed-save behavior.
- [x] Implement the owning store/projection and renderer changes. Verify prefix
  previews remain placeholders and never appear in configuration/model requests;
  clear only successfully submitted secret drafts after saving.
- [x] Update backend AI/API/storage references, the frontend reference, and the
  third-party API/in-app AI guides. README and tour entry points are unchanged.
- [x] Run `node --experimental-vm-modules --test test/ai/ai-config-store.test.js
  test/ai/ai-model-key-origin.test.js test/ai/ai-personas.test.js
  test/ai/ai-routes.test.js test/ai/frontend-admin-ai-settings.test.js
  test/ai/frontend-admin-ai.test.js`, `npm run verify:docs`, and relevant static
  architecture checks because public projection/persistence change.
- [x] Reuse the isolated desktop fixture through Playwright to inspect the masked
  prefix and switch DeepSeek → Doubao → DeepSeek, including a fresh page load.
  Use synthetic in-memory storage and tmp-only Electron directories; no real
  credentials or upstream service calls. Check no-key and new-key behavior.
- [x] Inspect task diff, `git diff --check`, and `git status --short`.

## Results

- 122 tests passed: the six AI suites listed above plus
  `test/admin/frontend-usage-guide.test.js`. New cases first reproduced the missing
  preview/restoration. Existing save tests now assert successful secret drafts
  clear while unsaved and newer edits remain intact.
- Documentation gate: 10 passed; architecture gate: 27 passed; all eight changed
  JavaScript files passed `node --check`.
- Isolated Electron confirmed visible `sk-dem********`, empty password value,
  DeepSeek cat → Doubao general → DeepSeek cat, persistence after recreating the
  store/reloading the page, key replacement, empty model-list credentials, fully
  masked short keys, and the unconfigured placeholder. No renderer errors; one
  configuration save per platform switch. Test process, database and profile
  were closed/removed. Screenshots remain under `tmp/ai-provider-settings/`.
- Technical references and both user guides are synchronized. Existing guide
  screenshots show unconfigured examples, so remain accurate. README/tour entry
  points did not change. An independent troubleshooting paragraph added to the
  same AI guide during this task was preserved.
- No commits, packaging, deployment, real credentials or upstream AI calls.

## Completion and failure handling

Complete when focused checks and isolated desktop behavior pass and the guides
match the result. On failure inspect and revise only task-owned edits; no broad
checkout/reset, commits or publication. The additive preferences row may remain
unused by older code without changing existing persisted values.
