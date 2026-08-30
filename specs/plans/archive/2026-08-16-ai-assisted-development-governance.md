# AI-Assisted Development Governance Implementation Plan

> Status: Done
> Date: 2026-08-16
> Completed: 2026-08-16

## Goal

Establish a repository-specific governance system that helps AI agents locate the
correct owner, preserve contracts, avoid expanding legacy patterns, and verify
their work with small deterministic checks.

## Non-goals

- Do not refactor Admin, storage, Electron, playback, or domain business logic.
- Do not migrate all legacy SQL, `window.AdminApp` usage, or empty catch blocks.
- Do not introduce role-agent documents, a framework, a build system, a runtime
  dependency, a process, a port, or a service.
- Do not translate or move the existing top-level specification bodies.
- Do not implement a complete HTTP, WebSocket, or IPC contract inventory in this
  phase; that is a later enforcement phase.
- Release pipeline hardening is a separate plan and is not implemented here.
- Do not create commits automatically. End each milestone with a reviewable diff
  and let the user decide when to commit.

## Separate Follow-up

Release hardening requires its own focused plan. That plan may cover clean-tree
enforcement, version validation, asset generation, tag handling, publication
retries, and resumability, but it must not expand this plan's implementation or
verification scope.

## Current Behavior

- The root `AGENTS.md` provides repository guidance but points to the nonexistent
  `doc/` directory instead of `docs/architecture/`.
- Architecture facts are documented under `docs/architecture/`, with a fact map
  in `docs/architecture/README.md`.
- `docs/architecture/engineering/modularity-standard.md` defines the intended
  modular-monolith boundaries but has only a file-level status statement.
- `test/module-boundaries.test.js` already protects selected boundaries, including
  queue and SuperChat storage access, Admin global access, playback dependency
  wiring, shared utilities, and composition roots.
- The top-level specification files under `specs/` have no lifecycle status.

## Ownership

- The root `AGENTS.md` owns project-wide AI change rules. Scoped `AGENTS.md`
  files own justified specialization for storage, Electron, and Admin code.
- `docs/architecture/README.md` owns the architecture fact map. The documents it
  routes to own their respective runtime contracts and engineering rules.
- `PLANS.md` owns planning policy, while `specs/README.md` owns specification
  lifecycle status and evidence requirements.
- `test/governance-docs.test.js` owns deterministic document-structure checks.
  `test/module-boundaries.test.js` and `test/esm-module-boundaries.test.js` own
  the machine-enforced architecture boundaries described in this plan.
- When ownership is uncertain, verify it through the fact map, route table,
  imports and callers, relevant tests, then optional `git log -- <file>` history.
  History is supporting evidence, not ownership authority.

## Proposed Changes

1. Replace the root guidance with a concise constitution and three scoped local
   rule files.
2. Add planning, routing, specification-lifecycle, legacy-boundary, and ADR
   documents without duplicating volatile runtime inventories.
3. Add a small governance-document test and layered verification commands.
4. Freeze selected legacy Admin, SQL, and empty-catch text debt in architecture
   tests without refactoring business code.
5. Repair known and newly discovered in-scope documentation link drift.
6. Archive completed plans and record their final status and implementation
   deviations.

## Authority And Conflict Resolution

The rewritten root constitution must use the following rules:

1. The explicit user requirement of the current task defines the goal.
2. The root `AGENTS.md` always applies. A local `AGENTS.md` may specialize root
   rules for its scope. It must not weaken project-wide safety, security,
   data-integrity, secret-protection, compatibility, or destructive-operation
   guarantees. Scoped exceptions to architectural or implementation defaults must
   be explicit, justified, and as narrow as possible.
3. Accepted specifications define required target behavior, and accepted ADRs
   define architecture direction. Contract changes must be explicit. Changing an
   accepted decision requires a new ADR or an explicit superseding ADR.
4. Owner documents in the architecture fact map describe current public
   contracts.
5. Engineering standards fill in general implementation rules.
6. An active plan describes execution only; it cannot redefine requirements.
7. Code and passing tests are evidence of current behavior, not automatically
   evidence of intended behavior.
8. Resolve conflicts by determining intended behavior from the explicit user
   requirement, accepted specifications and ADRs, and the owning public contract,
   in that order, then compare it with runtime evidence. When intent remains
   unclear, surface the conflict; do not rewrite documentation merely to match an
   implementation.

The fixed engineering priority is:

`Correctness and data safety > security > compatibility > architecture >
maintainability > minimal diff > cleverness.`

## Compatibility Constraints

- Preserve HTTP methods, paths, response shapes, public error semantics,
  WebSocket messages, IPC channels, database schema, settings keys, persisted JSON,
  page URLs, authentication behavior, and updater asset names.
- Preserve Node.js 24+, CommonJS backend style, Vanilla JavaScript ES modules,
  `node:test`, and the existing Electron packaging configuration.
- Keep `contextIsolation`, safeStorage, session partition behavior, token and
  cookie protection, log redaction, and `local-media://` origin checks intact.
- Keep generated output under `data/`, `logs/`, `tmp/`, and `release/` out of
  commits.
- Preserve unrelated user changes. Never use a blanket checkout or destructive
  reset as rollback.

## Language Policy

- Every governance Markdown file created or fully rewritten by this plan should be
  written in English. This is a writing convention, not a CI failure condition.
- The existing top-level specification bodies remain at their current paths and
  keep their current language. Their new index is English.
- Existing architecture documents that receive factual link corrections keep
  their existing language; this plan is not a translation project for the entire
  architecture library.

## Diff Verification Convention

- Before running `git diff --check` for a task-owned new file, expose that exact
  path to Git with `git add -N -- <path>`. Intent-to-add does not stage file
  content, but it makes whitespace errors in new files visible to diff checks.
- Use exact task-owned paths. Never use `git add -A`, `git add .`, or another
  broad staging command as verification preparation.
- Review `git diff` and `git status --short` at the end. If staged content exists
  for another reason, review `git diff --cached` as well. Do not create a commit
  or stage file contents unless the user explicitly requests it.

## File Map

| File                                                                    | Action             | Responsibility                                                                       |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                             | Rewrite            | Root constitution, authority rules, workflow, verification, and local rule discovery |
| `PLANS.md`                                                              | Create             | Risk-based planning requirements and plan format                                     |
| `docs/architecture/engineering/ai-workflow.md`                          | Create             | Task-to-owner, contract, consumer, and test routing                                  |
| `docs/architecture/engineering/legacy-boundaries.md`                    | Create             | Qualitative legacy registry and migration direction                                  |
| `docs/architecture/engineering/modularity-standard.md`                  | Rewrite in English | Target architecture, stable rule IDs, status, and enforcement mapping                |
| `src/storage/AGENTS.md`                                                 | Create             | SQLite migration, transaction, and data-safety restrictions                          |
| `src/electron/AGENTS.md`                                                | Create             | Renderer privilege, IPC, lifecycle, session, and update restrictions                 |
| `public/js/admin/AGENTS.md`                                             | Create             | ESM, legacy bridge, rendering safety, and UI ownership restrictions                  |
| `specs/README.md`                                                       | Create             | Spec lifecycle index, status vocabulary, threshold, and template                     |
| `docs/architecture/adr/0008-ai-assisted-change-governance.md`           | Create             | Accepted governance decision and trade-offs                                          |
| `test/governance-docs.test.js`                                          | Create             | Small deterministic governance and documentation checks                              |
| `test/module-boundaries.test.js`                                        | Extend             | Exact legacy text-debt budgets                                                       |
| `package.json`                                                          | Modify             | Add quick and full verification scripts                                              |
| `docs/architecture/frontend/app.md`                                     | Correct            | Replace stale `admin.html` references                                                |
| `docs/architecture/frontend/pages.md`                                   | Correct            | Replace stale `admin.html` references                                                |
| `docs/architecture/README.md`                                           | Update             | Engineering navigation, ADR, fact-map entries, and volatile-version cleanup          |
| `docs/architecture/engineering/build.md`                                | Update             | Verification scripts only                                                            |
| `docs/architecture/engineering/test.md`                                 | Update             | Governance checks and verification commands                                          |
| `docs/superpowers/plans/2026-08-16-modularity-low-coupling-refactor.md` | Move and normalize | Archive the completed historical plan without changing historical changelog text     |

## Milestone 1: Root Constitution And Planning Standard

### Task 1.1: Rewrite The Root Constitution

Files:

- Modify: `AGENTS.md`

Required sections:

- Project identity and scope.
- Priorities.
- Authority and conflict resolution, using the exact eight rules in this plan.
- Sources of truth and links to the architecture fact map.
- Before editing:
  `fact map -> route table -> exports/imports/callers -> relevant tests ->
optional git history`.
- Change scope.
- Architecture invariants.
- Legacy policy.
- Compatibility and security.
- Bug-fixing rules.
- Risk-based plan trigger.
- Layered verification.
- Final diff review.
- Definition of Done.
- Project commands and style pointers.
- Explicit links to the three local `AGENTS.md` files.

The file must not:

- Refer to `doc/`.
- Duplicate endpoint lists, IPC channel counts, table names, settings keys, or
  other volatile contract facts.
- Ban established stores, factories, repositories, or adapters. It must instead
  prohibit abstractions introduced only for reuse or hypothetical flexibility.
- Use module count as the sole planning trigger.

Verification:

```powershell
rg -n "doc/|3\+ modules|No factories|No repositories" AGENTS.md
git diff --check -- AGENTS.md
```

Expected:

- The first command prints no obsolete or forbidden wording.
- `git diff --check` exits successfully.

### Task 1.2: Create The Planning Standard

Files:

- Create: `PLANS.md`

Required content:

- A plan is required for architecture-boundary changes, public contract changes,
  schema or persisted-format changes, Electron security or lifecycle changes,
  state-owner changes, large legacy migrations, and complex async, retry, or
  idempotency behavior.
- Module count is a signal, not a hard threshold.
- A specification answers what behavior is required.
- A plan answers how a risky implementation will be delivered.
- A complex bug may require a plan without requiring a new specification.
- Active plans live in `specs/plans/`.
- Completed or superseded plans live in `specs/plans/archive/`.
- Required information:
  Goal, Non-goals, Current Behavior, Ownership, Compatibility Constraints,
  Proposed Changes, Milestones, Verification, Rollback or Failure Handling, and
  Done When.
- Headings are recommended but not machine-enforced.
- Sections that do not apply may contain `N/A`.
- Plans are living documents and must record discovered deviations.

Verification:

```powershell
git add -N -- PLANS.md
git diff --check -- PLANS.md
```

Expected: success.

## Milestone 2: Repository Navigation And Scoped Rules

### Task 2.1: Create The AI Workflow Router

Files:

- Create: `docs/architecture/engineering/ai-workflow.md`

Use a human-readable Markdown table enclosed by:

```markdown
<!-- ROUTE_TABLE_START -->

| Route ID | Domain | Owner | Contract | Typical Consumers | Tests |
| -------- | ------ | ----- | -------- | ----------------- | ----- |

<!-- ROUTE_TABLE_END -->
```

Rules for machine readability:

- Route IDs are stable, unique, uppercase identifiers beginning with `ROUTE-`.
- Owner, Contract, and Tests cells contain only backticked repository-relative
  literal file or directory paths separated by `<br>`.
- Typical Consumers may contain prose but should prefer repository paths.
- Every listed path must exist. Wildcards and glob syntax are not supported.
- Do not include volatile numeric facts such as endpoint or IPC counts.

Required route rows:

| Route ID               | Domain                                                 |
| ---------------------- | ------------------------------------------------------ |
| `ROUTE-MUSIC-REQUESTS` | Song library, requests, matching, queue, and cooldowns |
| `ROUTE-PLAYBACK`       | Playback, providers, streams, and lyrics               |
| `ROUTE-WESING`         | WeSing capture and synchronization                     |
| `ROUTE-BILIBILI`       | Bilibili danmaku and commands                          |
| `ROUTE-GIFTS`          | Gifts and SuperChat                                    |
| `ROUTE-OVERTIME`       | Overtime settlement and countdown                      |
| `ROUTE-AI`             | AI assistant and provider adapters                     |
| `ROUTE-STORAGE`        | Storage, schema, migrations, and retention             |
| `ROUTE-SERVER`         | Server core, HTTP, WebSocket, and lifecycle            |
| `ROUTE-ELECTRON`       | Electron windows, login, IPC, update, and shutdown     |
| `ROUTE-ADMIN`          | Admin frontend and page composition                    |
| `ROUTE-OVERLAYS`       | OBS overlays                                           |

The governance test must require every ID in this set exactly once and reject
duplicate Route IDs. Additional rows are allowed only with a unique `ROUTE-*` ID.
Domain prose may evolve without changing the stable ID.

Each row must be validated against current imports, callers, owner documents, and
tests. `git log -- <file>` may be used only as optional archaeology; it is never
ownership proof.

### Task 2.2: Create The Legacy Registry

Files:

- Create: `docs/architecture/engineering/legacy-boundaries.md`

Register these qualitative boundaries without copying current counts:

- `window.AdminApp` text debt across `public/js/`.
- Domain SQL outside `src/storage/`.
- `src/shared/utils.js` as a high-fan-in aggregation point.
- Mutable domain behavior in composition roots.
- Empty catch text debt across `src/` and `public/js/`.
- Classic-script global registration outside the ESM target architecture.

For each boundary document:

- Current shape.
- New-code rule.
- Allowed task-scoped migration behavior.
- Target architecture.
- Enforcement status and evidence.
- If a numeric debt budget exists, the exact test file and test name that own the
  baseline.
- If no numeric gate is appropriate, use `N/A - prose boundary` or name the
  nonnumeric enforcement and review process.

State explicitly that prose is qualitative and, where a numeric budget exists,
the named test is the only numeric authority. A `Migration Target` does not need
an artificial numeric baseline.

### Task 2.3: Rewrite The Modularity Standard

Files:

- Rewrite: `docs/architecture/engineering/modularity-standard.md`

Preserve the existing architecture decisions and Mermaid dependency diagram while
translating the complete file to English. Add stable rule IDs and this status
vocabulary:

- `Enforced`: a deterministic gate comprehensively blocks the violation.
- `Incrementally Enforced`: tests freeze known debt or cover only selected paths.
- `Migration Target`: desired direction is documented but not comprehensively
  machine-enforced.

Initial rule registry:

| Rule ID               | Rule                                                 | Status                 | Enforcement                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOD-COMPOSITION-001` | Composition roots only wire components and lifecycle | Enforced               | Composition-root boundary test                                                                                                                                                   |
| `MOD-STORAGE-001`     | Domain services do not issue SQL                     | Incrementally Enforced | Receiver-aware SQL debt budget                                                                                                                                                   |
| `MOD-STORAGE-002`     | Stores own transaction boundaries                    | Incrementally Enforced | Selected store atomicity tests plus review                                                                                                                                       |
| `MOD-ADMIN-001`       | New Admin code does not add global-state access      | Incrementally Enforced | `window.AdminApp` debt budget                                                                                                                                                    |
| `MOD-FRONTEND-001`    | New frontend code uses explicit ESM boundaries       | Incrementally Enforced | `test/esm-module-boundaries.test.js` rejects undeclared or unimported identifiers in ES modules under `public/js/`; review covers explicit exports and classic-script exceptions |
| `MOD-SHARED-001`      | Shared utilities remain domain-neutral               | Migration Target       | Selected regression assertions                                                                                                                                                   |
| `MOD-CONTRACT-001`    | Public contracts remain compatible by default        | Incrementally Enforced | Existing regression tests; full inventory deferred                                                                                                                               |

Do not label review-only or partial coverage as `Enforced`.

### Task 2.4: Create The Three Local Constitutions

Files:

- Create: `src/storage/AGENTS.md`
- Create: `src/electron/AGENTS.md`
- Create: `public/js/admin/AGENTS.md`

Storage rules:

- Schema evolves only through migrations.
- Existing user databases must upgrade without data loss.
- Repeated startup and migration execution must be idempotent.
- Stores own transactions and stable return shapes.
- Schema changes update migration code, stores, tests, and the storage owner
  document.
- Tests use temporary directories and never real user data.

Electron rules:

- Never expose cookies, tokens, arbitrary file access, API keys, or unrestricted
  privileged operations to renderers.
- Preserve context isolation, safeStorage, session partitions, and exact
  `local-media://` origin checks.
- Treat IPC channels and argument/result shapes as public contracts.
- Resource creators own idempotent cleanup of windows, listeners, timers, and
  shutdown handlers.
- Preserve login and playback-flush ordering unless an approved plan changes it.

Admin rules:

- New code uses named ESM imports and exports.
- Do not add `window.AdminApp` dependencies outside the legacy bridge.
- The Admin page is composed from `public/pages/admin/` fragments by
  `src/server/admin-page.js`; there is no `public/pages/admin.html`.
- Render untrusted values through `textContent` or the established escaping
  helpers.
- Do not duplicate server-side business decisions in UI code.

### Task 2.5: Create The Specification Index

Files:

- Create: `specs/README.md`

Enclose the index with:

```markdown
<!-- SPEC_INDEX_START -->

| Document | Type | Status | Runtime Evidence | Last Reviewed |
| -------- | ---- | ------ | ---------------- | ------------- |

<!-- SPEC_INDEX_END -->
```

Index every top-level specification document exactly once. Exclude:

- `specs/README.md` itself.
- Everything below `specs/plans/`.

Allowed statuses:

- `Draft`
- `Accepted`
- `In Progress`
- `Implemented`
- `Reference`
- `Superseded`

Status assignment rules:

- A reverse specification may be `Reference` only after its described runtime
  paths still exist.
- A design may be `Implemented` only when source and tests demonstrate its
  acceptance behavior.
- Changelog text is supporting evidence, not sufficient evidence by itself.
- If only part of the acceptance behavior is present, use `In Progress`.

Every row must contain at least one existing source or test path in Runtime
Evidence and the review date `2026-08-16`.

Also define:

- When a new specification is required.
- The difference between a specification and a plan.
- The English template for Goal, Context, Constraints, Non-goals, Architecture,
  Security, Compatibility, Acceptance Criteria, and Done When.

### Task 2.6: Record The Governance Decision

Files:

- Create: `docs/architecture/adr/0008-ai-assisted-change-governance.md`

Follow the repository ADR format:

- Status.
- Context.
- Decision.
- Consequences: Positive, Negative, and Neutral.
- Alternatives Considered.
- References.

Rejected alternatives:

- A giant root `AGENTS.md` containing volatile contract details.
- Permanent role-agent persona documents.
- Documentation-only governance without deterministic gates.
- A big-bang Admin or storage rewrite.
- A duplicate contract registry that competes with the architecture fact map.

Milestone verification:

```powershell
git add -N -- PLANS.md docs/architecture/engineering/ai-workflow.md docs/architecture/engineering/legacy-boundaries.md src/storage/AGENTS.md src/electron/AGENTS.md public/js/admin/AGENTS.md specs/README.md docs/architecture/adr/0008-ai-assisted-change-governance.md
git diff --check -- AGENTS.md PLANS.md docs/architecture/engineering src/storage/AGENTS.md src/electron/AGENTS.md public/js/admin/AGENTS.md specs/README.md docs/architecture/adr/0008-ai-assisted-change-governance.md
```

Expected: success.

## Milestone 3: Small Deterministic Governance Checks

### Task 3.1: Add Governance Tests

Files:

- Create: `test/governance-docs.test.js`

Keep the governance infrastructure boring: one Node.js test file, no custom
Markdown parser, no language detector, no line-budget framework, and no custom
glob engine. Use direct filesystem reads and small regular expressions only where
the document format is explicitly marked for machine checking.

Required checks:

1. Required governance files exist.
2. Root `AGENTS.md` references all three local `AGENTS.md` files.
3. Relative Markdown links in the governance and architecture index files resolve
   to existing files or directories. Ignore HTTP(S), mailto, data, and anchor-only
   links. Do not validate anchors in this phase.
4. The marked route table contains every required Route ID exactly once, contains
   no duplicate Route ID, and uses explicit backticked repository paths in Owner,
   Contract, and Tests cells. Wildcards are not supported; list concrete paths.
5. Every top-level `specs/*.md` file except `README.md` appears exactly once in
   the marked spec index, with an allowed status and existing Runtime Evidence.
6. Findings include `path:line [RULE_ID] reason; suggested fix`.

The test may use a small temporary fixture helper for malformed-document cases,
but it must not expose a reusable parser API or invoke Git. The repository itself
is the input; newly created nonignored files are visible directly to the test.

Initial command:

```powershell
node --test test/governance-docs.test.js
```

Expected:

- If Milestone 2 is complete and no additional in-scope documentation drift
  exists, the test passes.
- Otherwise, failures identify concrete missing governance requirements or stale
  in-scope links for repair in Milestone 5.

### Task 3.2: Add Verification Scripts

Files:

- Modify: `package.json`

Add:

```json
"verify:docs": "node --test test/governance-docs.test.js",
"verify:architecture": "node --experimental-vm-modules --test test/module-boundaries.test.js test/esm-module-boundaries.test.js",
"verify:quick": "npm run verify:docs && npm run check && npm run verify:architecture",
"verify": "npm run verify:quick && npm test"
```

Performance expectations:

- `verify:docs` and `verify:architecture` remain deterministic and small enough
  to complete in seconds on the current repository.
- `verify:quick` is the normal pre-review gate.
- `verify` is the full gate and may take longer as the suite grows.
- The full suite may rediscover targeted governance and architecture tests. That
  limited repetition is acceptable in the full gate so it retains the quick
  gate's early, focused failure feedback before running the complete suite.
- No brittle timing assertion is added.

Verification:

```powershell
npm run verify:docs
npm run verify:architecture
```

Expected: success after Milestone 5 repairs all discovered documentation drift.

## Milestone 4: Legacy Boundary Budgets

### Task 4.1: Expand Admin Global Coverage

Files:

- Modify: `test/module-boundaries.test.js`

Requirements:

- Scan all JavaScript files below `public/js/`.
- Exempt `public/js/admin/legacy-admin-bridge.js` as the intentional boundary.
- Count raw `window.AdminApp` tokens deterministically. This is a text-debt
  budget, not a semantic dependency count; comments are therefore included.
- Preserve the existing limits and add every currently observed file outside the
  existing scan.
- Store exact per-file baselines only in the test.
- A new file with a token fails.
- A changed file must not exceed its baseline.
- Remove a baseline entry when its actual count reaches zero.

Do not copy the total file count into governance prose. The implementation must
derive the baseline from the current source because earlier drafts contained an
incorrect total.

### Task 4.2: Add Receiver-aware SQL Debt Coverage

Files:

- Modify: `test/module-boundaries.test.js`

Use this receiver-aware raw-text pattern:

```javascript
/\b(?:db|songDb|superChatDb|giftDb|musicDb|checkinDb)\.(?:prepare|exec)\s*\(/g;
```

Rules:

- `src/storage/**` is the target infrastructure boundary and is exempt.
- Outside `src/storage/`, only the following current files may match:
- `src/music/song-service.js`
- `src/music/requester-target-store.js`
- `src/overtime/overtime-store.js`
- `src/ai/config-store.js`
- `src/ai/api-quota-store.js`
- `src/server/settings-bootstrap.js`
- `src/bilibili/gift/query-service.js`
- `src/bilibili/gift/event-service.js`
- `src/bilibili/gift/detection-service.js`
- `src/bilibili/gift/statistics-consumer.js`
- `src/bilibili/gift/blind-box-analysis.js`

- Derive each current per-file count from the source when implementing the test;
  freeze the numeric baselines only in `test/module-boundaries.test.js`.
- A new matching file fails.
- A file exceeding its baseline fails.
- Existing negative assertions for queue and SuperChat services remain.
- Describe this as receiver-aware text scanning, not as a parser and not as
  impossible to false-positive.

### Task 4.3: Add Empty Catch Text-debt Coverage

Files:

- Modify: `test/module-boundaries.test.js`

Scan every JavaScript file under `src/` and `public/js/` with this exact raw-text
pattern:

```javascript
/\bcatch(?:\s*\([^)]*\))?\s*\{(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\}/g;
```

Semantics:

- `catch {}` and `catch (error) {}` count as empty.
- A body containing only whitespace, line comments, or block comments also
  counts as empty because it performs no recovery, reporting, or cleanup.
- A body containing any executable token does not match.
- This is intentionally a raw-text debt check, not a JavaScript parser. Matches
  inside embedded native-source strings, including those in
  `src/music/wesing-native-monitor-source.js`, remain part of the baseline.
- Derive each current per-file count from the source when implementing the test;
  freeze numeric baselines only in `test/module-boundaries.test.js`.
- A new matching file fails, and an existing file may not exceed its baseline.
  Remove a baseline entry when its count reaches zero.

New production code must not add an empty or comment-only catch. A deliberately
silent best-effort cleanup still requires a short explanatory comment and an
explicit budget review; the comment does not exempt it from the text-debt gate.

Verification:

```powershell
node --test test/module-boundaries.test.js
node --experimental-vm-modules --test test/esm-module-boundaries.test.js
```

Expected: pass without business-code changes.

## Milestone 5: Existing Documentation And Metadata Repair

### Task 5.1: Repair Stale Admin Page Documentation

Files:

- Modify: `docs/architecture/frontend/app.md`
- Modify: `docs/architecture/frontend/pages.md`

Replace all stale `public/pages/admin.html` references with the actual model:

- HTML fragments under `public/pages/admin/`.
- Composition by `src/server/admin-page.js`.
- Ordering protected by `test/admin-page-composition.test.js`.

Do not invent fragment line-number links. Link stable files or directories only.

### Task 5.2: Update Architecture Navigation

Files:

- Modify: `docs/architecture/README.md`
- Modify: `docs/architecture/engineering/build.md`
- Modify: `docs/architecture/engineering/test.md`

Required updates:

- Remove the manually maintained release-version stamp from the architecture
  index; release metadata has a different owner and should not be mirrored here.
- Add `ai-workflow.md` and `legacy-boundaries.md` to engineering navigation.
- Add ADR-0008 to the ADR list.
- Add fact-map entries for routing, legacy governance, and the spec index without
  duplicating their content.
- Document each verification script introduced by this plan.
- Document the verification commands and the distinction between the quick and
  full gates. Do not record a test-file count or release-pipeline details here.

### Task 5.3: Repair Additional In-scope Link Findings

Files:

- Modify only governance or architecture index files reported by
  `test/governance-docs.test.js`.

Run `npm run verify:docs` after the known repairs. For every additional broken
relative link in the checker's declared scan scope:

- Correct the link target or link text to the current owner path.
- Keep the edit link-only; do not rewrite adjacent prose, formatting, or document
  structure.
- If the intended target or owner cannot be established from the fact map,
  route table, source, and tests, record the finding and resolve ownership before
  editing. Do not suppress or broadly exclude the file to make the gate pass.
- Repeat the targeted check until no in-scope broken-link finding remains.

### Task 5.4: Archive The Completed Historical Plan

Files:

- Move:
  `docs/superpowers/plans/2026-08-16-modularity-low-coupling-refactor.md`
  to
  `specs/plans/archive/2026-08-16-modularity-low-coupling-refactor.md`.

Use `git mv` so history remains visible. Replace the tool-specific required-skill
header with:

```markdown
> Status: Done
> Archived: 2026-08-16
```

Do not rewrite historical `UPDATE.md` inline-code references; they describe the
repository state at the time and are intentionally ignored by the Markdown link
checker.

Before moving, run:

```powershell
rg -n "modularity-low-coupling-refactor|docs/superpowers/plans" --glob '*.md' .
```

Update actual Markdown links if any are discovered. Do not change changelog code
spans.

Milestone verification:

```powershell
npm run verify:docs
git diff --check
```

Expected: success.

## Milestone 6: Final Verification And Review

### Task 6.1: Run The Verification Gates

Run targeted checks first:

```powershell
node --test test/governance-docs.test.js
node --test test/module-boundaries.test.js
node --experimental-vm-modules --test test/esm-module-boundaries.test.js
```

Then run:

```powershell
npm run check
npm run verify:docs
npm run verify:architecture
npm test
npm run verify
git add -N -- test/governance-docs.test.js
git diff --check
git status --short --untracked-files=all
git diff --stat
```

### Task 6.2: Review The Complete Change

Final review checklist:

- No business module changed.
- No API, WebSocket, IPC, schema, persisted payload, page URL, authentication, or
  updater contract changed.
- No runtime code changed.
- All new or rewritten governance Markdown is English.
- English is a writing convention, not a character-level CI rule.
- Existing top-level spec files remain at their original paths.
- `specs/README.md` indexes each top-level spec exactly once.
- Every required Route ID appears exactly once, and all Route IDs are unique.
- Route owner, contract, and test paths are literal and resolve.
- Legacy numeric baselines exist only in tests.
- Admin, SQL, and empty-catch debt cannot expand to a new file.
- Governance failures include a file, line, stable rule ID, reason, and suggested
  fix.
- Governance checks do not implement a general Markdown parser, glob engine,
  language detector, line-budget framework, or warning subsystem.
- No debug code, temporary compatibility layer, generated installer, database,
  log, cookie, token, or session material is included in the diff.

### Task 6.3: Mark And Archive This Plan

Only after Tasks 6.1 and 6.2 pass:

1. Change this plan's status from `Active` to `Done` and add
   `> Completed: 2026-08-16`.
2. Add a short `Completion Notes` section recording material deviations from the
   plan, or state `None` when implementation matched the plan.
3. Move this file from
   `specs/plans/2026-08-16-ai-assisted-development-governance.md` to
   `specs/plans/archive/2026-08-16-ai-assisted-development-governance.md`.
4. Preserve history with `git mv` when the source is already tracked. If it is
   still untracked, move only this exact file and then run `git add -N --` on the
   archived path so the final diff check includes it.
5. Search for and repair actual Markdown links to the active path. Do not change
   historical changelog code spans.
6. Rerun the final document and diff checks against the archived state:

```powershell
npm run verify:docs
git add -N -- specs/plans/archive/2026-08-16-ai-assisted-development-governance.md
git diff --check -- specs/plans/archive/2026-08-16-ai-assisted-development-governance.md
git status --short --untracked-files=all
```

## Completion Notes

- `MOD-COMPOSITION-001` is recorded as `Incrementally Enforced` rather than
  `Enforced` because the current structural tests cover selected server and
  Electron composition-root assertions, not the complete repository boundary.
- All other planned governance deliverables were completed without changing
  runtime or business code.

## Rollback And Failure Handling

- Stop immediately when a milestone fails and inspect the scoped diff.
- Do not run `git checkout --`, `git reset --hard`, or a blanket restore.
- Revert only task-owned hunks through an explicit patch.
- If the user has approved commits, use `git revert` rather than rewriting
  history.
- The archive move may be reversed with an explicit `git mv` only after checking
  for concurrent changes.
- No data migration or schema change occurs, so there is no user-data rollback.

## Done When

- The governance hierarchy and conflict-resolution rules are explicit.
- Root and local `AGENTS.md` files are linked and consistent.
- AI tasks have a verified owner, contract, consumer, and test routing path.
- Specs have evidence-backed lifecycle status without moving existing files.
- Legacy Admin globals, domain SQL, and empty catches are frozen by deterministic
  per-file budgets.
- Documentation links, literal route paths, and spec indexing are machine-checked
  with actionable `path:line` findings.
- Quick and full verification commands are documented and passing.
- `npm run check`, `npm test`, and `npm run verify` all pass.
- This plan is marked `Done`, includes completion notes, and resides under
  `specs/plans/archive/`.
- The final diff contains only the governance, documentation, test, and metadata
  work described by this plan.
