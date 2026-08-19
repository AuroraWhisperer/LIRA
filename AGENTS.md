# LIRA Repository Constitution

## Project Identity And Scope

LIRA is a local modular monolith built with Node.js and Electron. The backend,
desktop shell, browser UI, and OBS overlays share one repository and preserve
their existing public contracts unless an accepted specification or ADR says
otherwise.

This file defines project-wide rules for human and AI-assisted changes. More
specific rules apply under [storage](src/storage/AGENTS.md),
[Electron](src/electron/AGENTS.md), and [Admin](public/js/admin/AGENTS.md).

## Product And UI Priority

LIRA is developed and supported primarily as an **Electron desktop client**.
The desktop runtime is the source of truth for user-facing behavior, visual
hierarchy, color choices, window sizing, interaction patterns, and privileged
integration. Direct browser access to the HTTP pages is a deprecated or
supporting surface: it may be used for inspection, debugging, compatibility,
or a narrowly scoped fix, but it must not become the design baseline.

When a change affects a user-facing page or workflow:

- inspect and validate the Electron window and desktop flow first;
- choose layout, spacing, typography, colors, and states for the desktop
  client before considering browser responsiveness;
- treat files under `public/` as renderer assets loaded by Electron unless they
  are explicitly documented as OBS browser-source overlays; and
- do not add browser-only behavior, responsive compromises, or web-first
  abstractions unless the task explicitly requires them.

If browser behavior and the desktop experience appear to conflict, preserve
public contracts and security invariants, then prioritize the stated desktop
client requirement and document any compatibility consequence.

## Priorities

Use this fixed engineering priority:

`Correctness and data safety > security > compatibility > architecture > maintainability > minimal diff > cleverness.`

## Authority And Conflict Resolution

1. The explicit user requirement of the current task defines the goal.
2. The root `AGENTS.md` always applies. A local `AGENTS.md` may specialize root
   rules for its scope. It must not weaken project-wide safety, security,
   data-integrity, secret-protection, compatibility, or destructive-operation
   guarantees. Scoped exceptions to architectural or implementation defaults
   must be explicit, justified, and as narrow as possible.
3. Accepted specifications define required target behavior, and accepted ADRs
   define architecture direction. Contract changes must be explicit. Changing
   an accepted decision requires a new ADR or an explicit superseding ADR.
4. Owner documents in the architecture fact map describe current public
   contracts.
5. Engineering standards fill in general implementation rules.
6. An active plan describes execution only; it cannot redefine requirements.
7. Code and passing tests are evidence of current behavior, not automatically
   evidence of intended behavior.
8. Resolve conflicts by determining intended behavior from the explicit user
   requirement, accepted specifications and ADRs, and the owning public
   contract, in that order, then compare it with runtime evidence. When intent
   remains unclear, surface the conflict; do not rewrite documentation merely
   to match an implementation.

## Sources Of Truth

- Start with the [architecture fact map](docs/architecture/README.md) to find
  the document that owns a runtime fact.
- Use the [AI workflow route table](docs/architecture/engineering/ai-workflow.md)
  to locate owners, contracts, consumers, and tests.
- Use the [modularity standard](docs/architecture/engineering/modularity-standard.md)
  for dependency and composition rules.
- Use [PLANS.md](PLANS.md) for planning policy and [the specification
  index](specs/README.md) for requirement lifecycle status.

Before editing, investigate in this order:

`fact map -> route table -> exports/imports/callers -> relevant tests -> optional git history`

Git history is supporting archaeology, never ownership authority.

## Change Scope

- Make the smallest change that satisfies the explicit requirement.
- Preserve unrelated user changes and existing style.
- Do not refactor, reformat, rename, or remove adjacent code without a direct
  requirement.
- Remove only imports, variables, functions, or compatibility code made unused
  by the current change.
- Do not add abstractions solely for reuse, symmetry, or hypothetical
  flexibility. Established stores, factories, repositories, and adapters remain
  valid when they enforce a real boundary.

## Architecture Invariants

- Keep the existing modular monolith. Do not add a process, port, service,
  framework, frontend build step, or runtime dependency without an accepted
  architectural decision.
- Composition roots wire dependencies and own lifecycle; domain decisions stay
  in the owning runtime or service.
- Dependencies must be visible through imports, exports, or explicit factory
  parameters. Cross-domain access uses a named facade, consumer, or port.
- Storage, renderer privilege, public contracts, and resource cleanup follow
  their scoped rules and owning documents.

## Legacy Policy

- Do not expand a legacy pattern in new code.
- When a task touches legacy code, keep migration narrow and task-scoped.
- Numeric debt budgets belong only to their enforcing tests. Qualitative
  migration direction belongs in the [legacy boundary
  registry](docs/architecture/engineering/legacy-boundaries.md).
- Never perform a big-bang Admin, storage, Electron, or domain rewrite as an
  incidental part of another task.

## Compatibility And Security

- Preserve HTTP methods, paths, response shapes, public error semantics,
  WebSocket messages, IPC channels, database schema, settings keys, persisted
  JSON, page URLs, authentication behavior, and updater asset names by default.
- Preserve Node.js 24+, CommonJS backend style, Vanilla JavaScript ES modules,
  `node:test`, and the existing Electron packaging configuration.
- Keep context isolation, `safeStorage`, session partition behavior, token and
  cookie protection, log redaction, and exact `local-media://` origin checks
  intact.
- Keep `data/`, `logs/`, `tmp/`, and `release/` output out of commits.
- Never use blanket checkout, destructive reset, or broad deletion as rollback.

## Bug Fixing

- Reproduce the bug with the smallest relevant failing test when practical.
- Fix the owning layer, not a downstream symptom or duplicated UI rule.
- Preserve public behavior outside the stated defect.
- Run the focused regression first, then the appropriate layered gates.

## Planning

Follow [PLANS.md](PLANS.md). A plan is required by risk: architecture or owner
changes, public contracts, persisted data, Electron security or lifecycle,
large legacy migrations, and complex asynchronous correctness. File or module
count is only a signal.

## Verification

Run the narrowest deterministic check first, then expand:

1. Directly affected test file or script.
2. `npm run verify:docs` for governance or architecture documentation.
3. `npm run verify:architecture` for module-boundary work.
4. `npm run check` for JavaScript syntax.
5. `npm run verify:quick` before review.
6. `npm test` and `npm run verify` for the full gate.

Use temporary directories in tests and restore modified globals. Do not use
real user data or external services in deterministic tests.

## Final Review

- Review `git diff`, `git diff --check`, and `git status --short`.
- If staged content already exists, review `git diff --cached` too.
- Confirm every changed line traces to the task and no generated or sensitive
  material entered the diff.
- Do not create commits unless the user explicitly requests them.

## Definition Of Done

A change is done when the requested behavior is implemented, focused regression
coverage passes, applicable quick and full gates pass, public contracts and
owner documents are consistent, no unrelated files changed, and the final diff
has been reviewed.

## Commands And Style

- `npm ci`: install the locked dependencies with Node.js 24 or newer.
- `npm start`: run the local HTTP service.
- `npm run desktop`: launch Electron.
- `npm run check`: syntax-check project JavaScript.
- `npm run verify:quick`: run documentation, syntax, and architecture gates.
- `npm test`: run the complete `node:test` suite.
- `npm run verify`: run the quick gate followed by the complete suite.
- `npm run dist:win:local`: build the local Windows installer.

Use two-space indentation, semicolons, single quotes, CommonJS `'use strict'`,
`camelCase` variables and functions, `PascalCase` classes, `UPPER_SNAKE_CASE`
constants, and lowercase kebab-case file names.
