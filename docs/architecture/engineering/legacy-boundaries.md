# Legacy Boundary Registry

This registry describes qualitative legacy boundaries and their migration
direction. It does not own numeric baselines. When a numeric debt budget exists,
the named test and test case are the only numeric authority.

## Admin Global State

- **Current shape:** Legacy browser modules read or write `window.AdminApp`
  across `public/js/`. `public/js/admin/legacy-admin-bridge.js` is the intentional
  compatibility boundary for new Admin ESM consumers.
- **New-code rule:** Do not add a `window.AdminApp` dependency outside the bridge.
  Use named ESM imports and explicit narrow interfaces.
- **Task-scoped migration:** A touched module may move calls behind the bridge or
  explicit imports while preserving behavior. Do not rewrite unrelated Admin
  modules.
- **Target architecture:** Admin dependencies are explicit ESM imports and
  exports; the bridge remains only while legacy producers or consumers exist.
- **Enforcement:** Incrementally enforced by `test/module-boundaries.test.js`,
  test `Admin legacy global usage is frozen and can only decrease`. That test is
  the only numeric authority.

## Domain SQL Outside Storage

- **Current shape:** Selected domain and server files issue SQL through known
  database receivers outside `src/storage/`.
- **New-code rule:** New domain behavior depends on a narrow store or repository;
  it does not call SQLite statement APIs.
- **Task-scoped migration:** Move only the SQL needed by the current change into
  an owning store, preserve return shapes and transaction behavior, and add a
  focused regression test.
- **Target architecture:** SQL, table knowledge, and transaction ownership live
  under `src/storage/`.
- **Enforcement:** Incrementally enforced by `test/module-boundaries.test.js`,
  test `receiver-aware domain SQL usage is frozen and can only decrease`. That
  test is the only numeric authority and uses receiver-aware raw-text scanning.

## Shared Utility Aggregation

- **Current shape:** `src/shared/utils.js` is a high-fan-in aggregation point.
- **New-code rule:** Add domain-neutral helpers to a focused, single-topic shared
  module; domain or protocol behavior stays with its owner.
- **Task-scoped migration:** Extract a coherent helper only when the current task
  needs to change it, then update direct consumers and focused tests.
- **Target architecture:** Small stable shared modules expose pure utilities with
  clear subjects and no runtime resource ownership.
- **Enforcement:** N/A - prose boundary. Selected regression assertions in
  `test/module-boundaries.test.js` prevent known spreadsheet and ZIP codecs from
  returning to the aggregation point; review covers other topics.

## Mutable Behavior In Composition Roots

- **Current shape:** Composition roots historically mixed dependency wiring with
  mutable subsystem behavior.
- **New-code rule:** Entrypoints create components, connect callbacks, start
  resources, and close them in reverse order. Mutable policy belongs to the
  owning runtime or service.
- **Task-scoped migration:** Extract only behavior directly involved in the
  current change and preserve lifecycle ordering.
- **Target architecture:** Composition roots contain wiring and lifecycle only.
- **Enforcement:** Nonnumeric boundary assertions in
  `test/module-boundaries.test.js` plus code review.

## Empty Catch Blocks

- **Current shape:** `src/` and `public/js/` contain empty or comment-only catch
  bodies, including matches inside embedded native-source strings.
- **New-code rule:** A catch performs recovery, reporting, cleanup, or explicit
  propagation. New empty or comment-only catches are not allowed.
- **Task-scoped migration:** Improve a catch only when the task establishes the
  correct behavior; do not invent logging or error propagation for unrelated
  paths.
- **Target architecture:** Failure behavior is explicit and owned by the layer
  that can recover or report safely.
- **Enforcement:** Incrementally enforced by `test/module-boundaries.test.js`,
  test `empty catch text debt is frozen and can only decrease`. That test is the
  only numeric authority. Comments do not exempt a match.

## Classic-Script Global Registration

- **Current shape:** Some browser code registers globals from classic scripts
  outside the target ESM architecture.
- **New-code rule:** New frontend modules use explicit named ESM imports and
  exports. A classic-script exception requires an existing compatibility need.
- **Task-scoped migration:** Convert a coherent producer-consumer slice only when
  the current task touches it, keeping load order and page behavior intact.
- **Target architecture:** Browser dependencies are statically visible through
  ESM boundaries, with narrow compatibility adapters for remaining classic
  scripts.
- **Enforcement:** `test/esm-module-boundaries.test.js` checks declared and
  imported identifiers in public ES modules. Classic-script exceptions and
  explicit exports remain review-enforced.

Migration Target entries intentionally have no artificial numeric baseline.
