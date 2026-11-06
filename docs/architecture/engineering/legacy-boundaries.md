# Legacy Boundary Registry

This registry describes qualitative legacy boundaries and their migration
direction. It does not own numeric baselines. When a numeric debt budget exists,
the named test and test case are the only numeric authority.

## Admin Global State

- **Current shape:** Retired on 2026-11-06. Admin composition directly creates the
  desktop UI and initializes playback; feature modules, shared utilities, theme,
  logging and events use named imports or explicit callbacks. The final
  fullscreen-close consumer receives a callback through playback composition.
  The bridge and publishers have no remaining production consumers and are removed;
  tests load the actual module owners instead of preserving a test-only registry.
- **New-code rule:** Do not reintroduce `window.AdminApp` dependencies or a
  replacement global service registry. Use named ESM imports and narrow interfaces.
- **Enforcement:** `test/engineering/module-boundaries.test.js`, test
  `frontend modules use explicit dependencies without an Admin registry`, scans
  all frontend modules. The former numeric debt budget is removed; computed
  property access and other implicit dependency mechanisms still require review.

## Domain SQL Outside Storage

Song service migration is complete: the composition root creates
`src/storage/song-store.js`, and song domain functions receive that store rather
than a database. Its old SQL debt budget is removed and a strict no-SQL assertion
protects the boundary. Gift projection and statistics now receive narrow stores
from the composition root; SQL and the statistics delivery transaction live in
`gift-projection-store.js` and `gift-statistics-store.js`. Gift queries and
blind-box analysis now receive `queryStore`; recent clearing receives
`maintenanceStore`. Structured local/source/unavailable scopes are translated
to SQL only inside `gift-query-store.js`.

The database-context fallback in `src/bilibili/gift/index.js` is retired on
2026-11-06. Production composition and isolated test fixtures explicitly create
the four gift stores. The facade only assembles domain capabilities and owns
active-source/view-epoch state. Domain directories are checked for imports of
storage, transport and desktop implementations; gift projection/import tests
protect transaction, retry and idempotency behavior.

AI configuration receives `src/storage/ai-state-store.js` from `server/ai-runtime.js`; the domain retains codec, persona, TTL and key-origin rules. AI quota now receives `ai-api-usage-store` from the same runtime and retains reservation/refund/month rules. Overtime receives `src/storage/overtime-store.js` from `server/domain-services.js`, preserving the same gift database and transaction boundaries. These former SQL/implicit storage-construction exceptions are removed.

- **Current shape:** Known database receivers no longer issue SQL outside `src/storage/`; the text scan is not a complete semantic dependency analysis.
- **New-code rule:** New domain behavior depends on a narrow store or repository;
  it does not call SQLite statement APIs.
- **Task-scoped migration:** Move only the SQL needed by the current change into
  an owning store, preserve return shapes and transaction behavior, and add a
  focused regression test.
- **Target architecture:** SQL, table knowledge, and transaction ownership live
  under `src/storage/`.
- **Enforcement:** Incrementally enforced by `test/engineering/module-boundaries.test.js`,
  test `domain SQL receivers stay inside storage`, with no allowlist. It uses receiver-aware raw-text scanning; directory-wide domain import guards and behavioral tests complement it.

## Shared Utility Aggregation

- **Current shape:** `src/shared/utils.js` remains a high-fan-in aggregation point for domain-neutral utilities. Bilibili SC prices and guard levels live in the pure `src/shared/bilibili-value-contract.js`; room parsing lives in `src/bilibili/room-input.js`, and public error wording lives in `src/bilibili/api-error.js`. Storage consumes the shared value contract without depending on platform runtimes.
- **New-code rule:** Add domain-neutral helpers to a focused, single-topic shared
  module; domain or protocol behavior stays with its owner.
- **Task-scoped migration:** Extract a coherent helper only when the current task
  needs to change it, then update direct consumers and focused tests.
- **Target architecture:** Small stable shared modules expose pure utilities with
  clear subjects and no runtime resource ownership.
- **Enforcement:** N/A - prose boundary. Selected regression assertions in
  `test/engineering/module-boundaries.test.js` prevent known spreadsheet/ZIP codecs and Bilibili rules from
  returning to the aggregation point; review covers other topics.

### Frontend pure helpers and compatibility

`public/js/shared/html-escape.js` owns HTML/attribute escaping; `display-format.js` owns display formatting. Direct consumers, including playback helpers, import these modules without loading dialogs, toast, requests or legacy global publication. The original falsy-input semantics remain unchanged; classic overlays and confirmation-dialog escaping retain their separate contracts.

`shared/utils.js` retains its named exports for existing explicit UI/request consumers. Its unused aggregate object and global publication are removed; playback provider operations use the already injected utility capability for logout confirmation. `module-boundaries.test.js` prevents named pure-helper imports from returning to the UI/request entry; `test/ui/frontend-pure-utils.test.js` exercises real ESM imports without UI globals or network access.

## Mutable Behavior In Composition Roots

- **Current shape:** Composition roots historically mixed dependency wiring with
  mutable subsystem behavior. Desktop close/deadline and window state now belong
  to `desktop-lifecycle` and `desktop-main-window`; logger and updater own their
  state. The former cross-domain `desktop-state` bag is removed. Server message
  decisions and maintenance recovery belong to application owners.
- **New-code rule:** Entrypoints create components, connect callbacks, start
  resources, and close them in reverse order. Mutable policy belongs to the
  owning runtime or service.
- **Task-scoped migration:** Extract only behavior directly involved in the
  current change and preserve lifecycle ordering.
- **Target architecture:** Composition roots contain wiring and lifecycle only.
- **Enforcement:** Nonnumeric boundary assertions in
  `test/engineering/module-boundaries.test.js` plus code review.

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
- **Enforcement:** Incrementally enforced by `test/engineering/module-boundaries.test.js`,
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
- **Enforcement:** `test/engineering/esm-module-boundaries.test.js` checks declared and
  imported identifiers in public ES modules. Classic-script exceptions and
  explicit exports remain review-enforced.

## Bilibili Identity Cache Compatibility

- **Current shape:** `IdentityCache` historically combined UID/name indexing,
  recent/online audience lists, and field merge policy; message handlers and
  pollers used those merge methods directly.
- **New-code rule:** `UserInfoService` is the only production merge owner.
  Parsers and pollers submit `IdentityHint` values through explicit sinks;
  games and runtime consumers use the facade or its injected narrow resolver.
- **Task-scoped migration:** the cache remains in place as an exact storage/index
  compatibility primitive while all touched producers/consumers move behind the
  facade. Keep legacy methods only for existing compatibility tests until their
  direct consumers are gone.
- **Target architecture:** no production code imports or calls cache merge
  policy, profile providers, or avatar proxy internals across the facade boundary;
  implicit `onMessage()` avatar hydration is removed.
- **Enforcement:** focused tests in
  `test/bilibili/bilibili-user-info-service.test.js`,
  `test/bilibili/bilibili-user-info-pollers.test.js`, and the existing Bilibili client,
  parser, and runtime suites, plus architecture review.

Migration Target entries intentionally have no artificial numeric baseline.
