# LIRA Repository Instructions

## Project

LIRA is a local-first modular monolith: Electron 43 desktop + Node.js 24+
backend, Vanilla JavaScript ES modules, and native CSS. Pages live in
`public/pages/`, frontend modules in `public/js/`, and shared CSS tokens in
`public/css/styles-base.css`.

LIRA targets Bilibili (B 站) as the live platform. OBS and Bilibili Livehime
(哔哩哔哩直播姬) are both supported streaming applications, using the same
browser-source overlays. Keep platform and streaming-application terminology
distinct; generic overlay behavior must not be described as exclusive to either.

Electron desktop is the primary UI target. Streaming-software browser-source
overlays are explicit browser-first exceptions. Accepted server-assisted work may move selected
shared, realtime, persistence, and authentication responsibilities to a remote
LIRA Server without turning the product into unrelated services.

Scoped `AGENTS.md` files apply to their directory trees; deeper instructions
specialize this root file for touched files. They may narrow implementation
defaults but must not weaken root safety, security, data-integrity, compatibility,
or destructive-operation rules.

- [Storage](src/storage/AGENTS.md)
- [Electron](src/electron/AGENTS.md)
- [Admin frontend](public/js/admin/AGENTS.md)

## Priorities And Sources Of Truth

Engineering priority:

`Correctness/data safety > security > explicit requirement > compatibility > accepted architecture > maintainability > minimal diff > cleverness.`

Intended behavior comes from:

1. Current explicit user requirement.
2. Accepted specification.
3. Accepted ADR.
4. Owning architecture/contract document.
5. Tests/runtime evidence.
6. Existing implementation.

Code and passing tests describe current behavior; they do not automatically
define intended behavior.

Use these only when relevant:

- `docs/README.md` — document roles and current entry points.
- `docs/architecture/README.md` — system boundaries and accepted decisions.
- `docs/reference/README.md` — implementation contract fact map.
- `docs/architecture/engineering/ai-workflow.md` — owners/contracts/consumers.
- `docs/architecture/engineering/modularity-standard.md` — dependency rules.
- `PLANS.md` — planning policy.
- `specs/README.md` — specification status.

## Core Rules

- Solve the requested problem at the owning layer with the smallest correct change.
- Reuse established patterns/helpers, but do not expand a documented legacy boundary.
- Judge file size by source kind, cohesive responsibility, and purpose. Line counts
  are review signals, not automatic split/fail criteria; follow the
  [file-size review policy](docs/architecture/engineering/modularity-standard.md#file-size-review).
- Preserve unrelated user changes and behavior; do not refactor, reformat, or
  rename adjacent code or fix unrelated bugs/failures unless they block the task.
- Do not add speculative requirements, defensive behavior, cleanup, abstractions,
  or tests without a requirement or concrete regression risk.
- Do not commit, branch, tag, release, or publish unless explicitly asked.
- Never use destructive reset, blanket checkout, or broad deletion as rollback.
- Keep runtime/generated data and secrets out of commits.
- Put ad hoc scripts, temporary/intermediate artifacts, QA screenshots, and test
  scratch directories inside the repository-root `tmp/`.
- Stop when the requested behavior is implemented and evidence is sufficient.

## Workflow By Risk

Choose the lightest workflow that can establish confidence.

### Small / Low Risk

Examples: copy, CSS, small markup, obvious local renderer behavior, tiny config
changes, or a narrow bug with a clear cause.

Default:

1. Inspect the smallest relevant code and nearby precedent.
2. Make the smallest change.
3. Run one cheap focused check or one direct runtime inspection when useful.

Do **not** by default create a formal plan, read broad architecture/history, spawn
a subagent, add test infrastructure, create one-off Playwright/Electron automation,
run repository-wide verification, or broaden acceptance criteria.

### Focused / Normal Risk

For a normal feature or bug contained in one area:

1. Locate the owner and relevant callers/consumers.
2. Inspect directly related tests or runtime behavior.
3. Implement the scoped change.
4. Run directly affected checks.
5. Expand investigation or verification only for a concrete blast-radius reason.

### High Risk / Cross-Cutting

Use a formal plan and broader verification for architecture/ownership, public
contracts, persistence/migrations, auth/secrets, Electron security/lifecycle,
server-assisted migration or tenant isolation, packaging/updater/build
infrastructure, complex async/retry/recovery, concurrency/idempotency/ordering
behavior, multiple independent domains, or large migrations.

File count alone does not determine risk.

## Investigation And Planning

Start with the narrow question. Prefer targeted `rg`, relevant file sections,
nearby callers, and directly related tests. Avoid broad searches, full-file dumps,
large logs, and repeated reads after the owner is known.

When ownership is unclear or the work is Focused or High Risk:

`fact map -> route table -> exports/imports/callers -> relevant tests -> optional git history`

Use `git log` or `git blame` only when historical intent is genuinely needed.

Outside the High Risk cases above, create a formal plan only when it materially
reduces uncertainty or controls multi-stage work. Multiple files, UI work, tests,
or delegation do not by themselves require a plan.

A useful plan records decisions, boundaries, dependencies, and verification. It
should not restate obvious implementation steps merely to create ceremony.

## Test And Documentation Synchronization

Affected tests, technical documentation, and user guidance are part of the same
task as the implementation. Check their impact before editing, update them as
each behavior is completed, and resolve known drift before declaring the task
done. Do not defer this work to commit or release preparation.

- Locate the relevant tests and document owners using the existing route table
  and [documentation map](docs/README.md). Record affected material in the existing
  plan when one is required; small changes do not need a separate checklist.
- **Tests:** update expectations and fixtures when intended behavior changes;
  add coverage when the risk-based verification rules below call for it. Expected
  outcomes must follow the requirement or accepted contract. Do not weaken valid
  assertions merely to make the changed implementation pass. For refactors that
  preserve behavior, retain behavioral coverage and run the affected tests.
- **Technical documentation:** update the owning reference when interfaces,
  fields, defaults, limits, configuration, or documented implementation facts
  change, including module ownership and paths. Update architecture documents
  when their responsibilities or boundaries change; follow the documentation
  map instead of duplicating contracts.
- **User guidance:** when features, entry points, operating steps, configuration,
  or user-visible limits change, check the relevant `docs/guides/`, README files,
  in-app `public/pages/admin/toolbox/usage-guide*.html`, and
  `public/js/admin/interactive-tour-config.js`. Update affected instructions,
  examples, and screenshots when they would otherwise mislead the user.
- If existing tests still cover the intended behavior or a documentation category
  is unaffected, leave it unchanged and give a brief reason in the completion
  report. Impact assessment is required; edits to every category are not.
- Use the focused verification below and the existing `npm run verify:docs` gate
  when changing current Markdown documentation or its navigation. That gate does
  not prove that behavior descriptions or user instructions are accurate; compare
  affected content with the implementation and relevant runtime evidence.

## Scope And Architecture

Every changed line should trace to the current task.

Keep the modular monolith. Do not add a process, service, framework, frontend
build step, runtime dependency, or architectural layer without an accepted
architectural reason.

Composition roots own wiring/lifecycle; domain decisions stay in the owning
service/runtime; cross-domain access follows the established boundary.

Preserve by default all public HTTP/WebSocket/IPC contracts, persisted formats
and settings keys, page URLs, authentication/updater behavior, and Electron
security invariants including context isolation, `safeStorage`, session
partitions, secret protection, log redaction, and `local-media://` origin checks.

Changing one of these boundaries is not a Small task.

### Server-Assisted Evolution

Server-assisted work extends the modular monolith; it does not by itself justify
microservices, one process per feature, or a new framework. Prefer staged changes
that keep unrelated local behavior working until an accepted requirement moves it.

For multi-streamer/server behavior:

- `streamerId` is the stable internal tenant identity. Bilibili `roomId` is an
  external attribute, not an authorization boundary.
- Resolve streamer scope at an authenticated server boundary and carry that scope
  through the runtime. Never trust client-supplied identity, role, ownership, or
  `streamerId` as authorization evidence.
- Bind Bilibili events to the owning streamer runtime at ingress. Do not route
  unscoped events through global mutable `currentStreamer` state.
- Keep streamer-private persistence, settings, realtime subscriptions, Bilibili
  credentials, and business state isolated by streamer. Global storage is for
  genuinely platform-wide state such as server/admin metadata and the shared
  Bilibili gift catalog/assets.
- Keep `admin`, `streamer`, `device`, `overlay`, and explicitly public access as
  distinct principals/scopes. Enforce authorization server-side for protected HTTP
  and WebSocket operations; credentials must be revocable and must not be reused
  across privilege levels.
- Do not implement remote access by simply weakening loopback, Host/Origin, Electron,
  secret-protection, or storage boundaries. Internal Node listeners, SQLite files,
  and secret stores are not public interfaces.
- Keep server location/domain configurable. Do not hardcode public IPs, domains, or
  deployment-specific URLs into business logic.

## Desktop And UI

Electron desktop is the source of truth for normal user-facing UI behavior,
visual hierarchy, sizing, interaction, and privileged integration. Reuse existing
design tokens and nearby patterns. Overlays for OBS and Bilibili Livehime are
browser-source surfaces.

For a small UI change, one targeted runtime inspection is normally enough when
code alone cannot establish the result. Verify what the task actually changes.

Do not automatically add unrelated viewport, browser-parity, keyboard, overflow,
screenshot, or external-state checks unless the requirement, existing contract,
or a plausible regression makes them relevant. Prefer existing verification paths
over one-off automation.

## Bug Fixing And Verification

For a bug: confirm the smallest useful reproduction when practical, fix the
owning cause, re-run the focused reproduction or test, and expand only if the
result suggests wider impact.

Do not require a new regression test for every trivial fix when existing evidence
is sufficient. Add or update a test when it materially protects the behavior,
captures a non-obvious regression, or is required by an existing contract.

Before adding coverage, search the owning suite for existing cases, helpers, and
fixtures. Prefer reusing or extending matching coverage; add a new case only for
a concrete coverage gap. Keep each case focused on one behavior or contract,
and assert shared rules at their owning layer. Consumer tests should cover their
own integration, without repeating the owner's internal details. Reuse must not
couple mutable state, execution order, or unrelated responsibilities.

If a local change requires many unrelated test edits, first distinguish actual
contract impacts from duplicated assertions or overly broad shared fixtures.
Address coupling within the task's scope instead of bulk-changing expectations;
preserve coverage of distinct failure modes. Detailed reuse criteria live in the
[testing conventions](docs/reference/engineering/test.md#复用与职责范围).

Verification is **risk-based, not a mandatory ladder**.

- **Small:** final diff plus one affected test, syntax check, or runtime inspection
  when useful. Automated tests may be skipped when no meaningful focused test
  exists; state that in the final response.
- **Focused:** directly affected tests/scripts, relevant syntax/static checks,
  targeted runtime verification, and `git diff --check`. Use broader repository
  checks only when blast radius justifies them.
- **High risk:** add the relevant repository-wide gates justified by the changed
  contracts, architecture, lifecycle, persistence, security, build, or packaging
  surface.

Do **not** automatically escalate from focused checks to repository-wide or full
suites. Reserve full suites for cross-cutting/critical changes or explicit
requests, and do not build temporary infrastructure merely to prove a trivial
change.

When a full suite fails, collect its failures and resolve them together with
focused checks before another full run. Do not edit, format or stage the files
under test while the suite is running: a whole-suite run observes files when it
loads them, so code that changes mid-run produces results that cannot be
attributed to one revision and must be rerun. An isolated pass does not resolve a
failure seen only under concurrency: reproduce the triggering conditions and
verify the fix there. Before repeating a full run, state what caused each known
failure, what changed, and which focused evidence passed. Unexplained intermittent
failures require diagnosis, not repeated full runs. For releases, follow
[the release guide](RELEASE_GUIDE.md#2-验证提交推送).

Tests must not use real user data. Deterministic tests must isolate temporary
state, restore modified globals, and avoid external services.

## Final Review And Communication

After the last edit:

- inspect the touched diff;
- run `git diff --check`;
- inspect `git status --short`;
- preserve existing staged content and inspect it only as needed to distinguish
  pre-existing changes from the current task.

Confirm no generated, sensitive, or runtime material entered the diff. Do not
repeat full review passes unless a later edit invalidates the earlier one.

A task is done when the requested behavior is implemented, verification
proportional to risk has passed or limitations are stated, relevant contracts
remain consistent, and the final diff is reviewed.

For tiny tasks, do not announce a formal plan or narrate routine commands. For
longer tasks, update only on meaningful findings, decisions, blockers, or
verification results.

Final responses normally state: what changed, important files touched,
verification actually run, the synchronization outcome for tests, technical
documentation, and user guidance (including brief reasons for unchanged
categories), and any remaining risk or limitation.

## Commands And Style

Use repository scripts as needed; command availability should be discovered from
the repository rather than treated as a mandatory checklist.

Follow more specific scoped instructions and surrounding-file conventions where
compatible.

Default style where no more specific local convention applies:

- two-space indentation;
- semicolons;
- single quotes;
- `camelCase` variables/functions;
- `PascalCase` classes;
- `UPPER_SNAKE_CASE` constants;
- lowercase kebab-case filenames;
- CommonJS backend;
- ES modules frontend.
