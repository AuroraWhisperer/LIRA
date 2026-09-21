# Client/server reuse and modularity implementation plan

**Goal:** Resolve F01–F14 and the six secondary reuse opportunities in the
2026-09-21 audit, one independently verified change at a time.

**Architecture:** Keep the modular monolith and existing runtime owners. Move
storage representation behind stores, expose narrow domain capabilities, and
share pure rules without coupling independently deployed repositories at runtime.

**Tech stack:** Existing CommonJS Node backends, browser ES modules and native CSS.

## Constraints and completion

Preserve public HTTP/WS/IPC contracts, persistence formats, tenant isolation,
transaction ownership, Electron security, immutable game versions, and unrelated
working-tree changes. No commits, branches, dependencies or deployment. The audit's
excluded findings are constraints, not a request to merge intentionally different
behavior. The full goal is complete only when every row below has implementation
and focused verification evidence. Before each boundary change, inspect its owner,
consumers, normative contracts and tests, and refine that row's implementation.

## Work ledger

| Item | Implementation and verification | Status |
| --- | --- | --- |
| F01 | Broker active flag and collection identity guard; regression interleaving with same/different listener, other tenant and final cleanup. Server broker/device/public SSE tests: 22 passed; diff checked. | Complete |
| F02 | Inject gift query/maintenance stores; structured local/source/unavailable scope; move blind-box and recent-clear SQL into stores. Verify source isolation, selection, statistics, pending settlements and architecture boundaries. | Complete |
| F03 | Centralize cloud settings SQL/keys/revision mapping; retain service transaction/auth/post-commit orchestration and credential-reset transaction. | Complete |
| F04 | Public group lookup/cancel API owns timers and budgets; interaction/group tests. | Complete |
| F05 | Incrementally migrate Admin global module collaboration to explicit imports; preserve compatibility bridge and initialization behavior. | Complete |
| F06 | One underlying room-profile cache/request owner shared by Admin and public projections; credential/context invalidation and concurrent request-count tests. | Complete |
| F07 | Document authoritative shared source and explicit source-sync contract before implementation; independently deployable copies with cross-repo checks; retain feed policies. | Deferred by user |
| F08 | Share overlay theme/colour/font/power helpers and countdown formatting; preserve classic-script bridge and page-specific behavior. | Complete |
| F09 | Share pure Electron Cookie conversions, retaining platform login/storage policy. | Complete |
| F10 | One lottery synchronous transaction helper; retain original error and rollback diagnostics, store-owned transactions. | Complete |
| F11 | One in-transaction projection metadata reset; keep deletion scopes distinct and generation fences intact. | Complete |
| F12 | One QQ response reader/parser; preserve each request/signature/auth construction. | Complete |
| F13 | Share sensitive-name classifier; preserve log masking/URI decoding and response field removal. | Complete |
| F14 | Share current game manifest parser and update static allowlist; preserve immutable version directories. | Complete |
| S01 | Share music auth-state pure DTO mapping; provider/auth tests. | Complete |
| S02 | Share canonical song fields; retain Device aliases and bounded public projection. | Complete |
| S03 | Share Bilibili upstream error formatting; signer/API client tests. | Complete |
| S04 | Assess common protobuf byte-reading interface with source distribution from F07; retain different outer decoders, no runtime cross-repository import. | Deferred with F07 dependency |
| S05 | Share lyric pure cleaning/numeric bounds where semantics agree; preserve word/line whitespace differences. | Complete |
| S06 | Share gift-query HTTP error mapping; preserve route-specific auth errors. | Complete |

## F02 ownership and implementation

Owner: `src/storage/gift-query-store.js` and `gift-maintenance-store.js` own SQL;
`src/bilibili/gift/query-service.js`, `blind-box-analysis.js` and `source-scope.js`
own domain formatting/filter policy. `src/server/domain-services.js` constructs
stores; the existing gift constructor facade retains its legacy database adapter.
Contracts: `docs/architecture/backend/bilibili/gift.md`, storage rules and
`docs/architecture/engineering/legacy-boundaries.md`.

- [x] Replace `{sql, params}` domain scope with `{kind: 'local'}`, `{kind: 'source', sourceId}` or `{kind: 'unavailable'}`. Only storage translates to predicates; invalid scope fails closed.
- [x] Inject `queryStore` and `maintenanceStore` into query contexts; production composition creates both once. Remove domain storage imports and database access.
- [x] Add `queryStore.listBlindBoxRows({sourceScope, from, to, boxName})`; retain existing dates, eligibility, ordering and domain aggregation.
- [x] Add `maintenanceStore.clearRecent({updatedAt})`; preserve local-only eligible latest 3000 deletion and pending-settlement handling in existing transaction owner.
- [x] Update fixtures to supply stores, protect SQL-free query modules, reduce old SQL debt budget and update ownership documentation.
- [x] Run focused query/statistics/analysis/maintenance/import/display/optimization tests, then architecture gates and final diff/status checks.

Verification command (client): `node --test test/gift-query-service.test.js test/gift-statistics-service.test.js test/gift-analysis-service.test.js test/gift-ledger-maintenance.test.js test/processed-gift-import.test.js test/gift-display-query.test.js test/gift-display-profile.test.js test/query-optimization.test.js test/remote-gift-owner-isolation.test.js test/module-boundaries.test.js`.

## Failure handling

### F03 implementation boundary

Create server `src/storage/cloud-settings-store.js` to own tenant settings reads,
default/metadata mapping, writes, takeover archive persistence, boolean readers
and credential-driven interaction reset. `cloud-state.js` continues to own its
immediate transaction, async authorization revalidation, related-settings writer,
identity mirror and post-commit events/monitor changes. `credential-service.js`
calls the storage reset inside its existing credential transaction; the lib file
retains only pure setting names. `monitor-manager.js` consumes boolean readers.
Preserve legacy initialization, revision floors, optional omission, source labels,
raw true representation, absent-vs-empty room and blind-box archive behavior.
Verify with server cloud-state sync/atomicity/read-reuse, gift-interaction settings,
blind-box sync, credential and monitor tests; protect the tenant SQL boundary.
No HTTP behavior or accepted ADR changes; update owning architecture description.

F03 evidence: cloud-state sync/atomicity/read-reuse, gift interaction settings,
blind-box sync and admin compatibility: 48/48 passed. Credentials, monitor login/
startup isolation, settings (including new rollback injection) and architecture:
54/54 passed. Source review confirms transaction/auth/post-commit ordering remains
in the same services; the new store owns tenant settings representation.

F04 evidence: `GiftThanksGroups.has(id)` and `cancel(id)` replace consumer access
to its Map/private removal. Two public API regressions cover duplicate cancel,
same-key re-registration/stale timer, unaffected groups, budget release and both
single-aggregation timers. Groups/interaction/construction: 25/25 passed.

Stop the current milestone if its invariant fails; repair using isolated fixtures.
Inspect task-owned hunks before undoing anything. Do not reset or restore whole
files containing pre-existing user changes. No real user database or running app
is part of verification. Record exact results and remaining work here.

F02 evidence: focused 11-file suite 57/57 passed; added invalid-scope test 5/5 query tests passed after fixture correction. Maintenance/composition/smoke run passed 30 non-query tests; architecture 22/22. Contract fixtures read from existing pinned checkout `C:/Users/Tom/AppData/Local/Temp/lira-interactions-server-contract` via `LIRA_SERVER_ROOT`; sibling worktree is intentionally not the pinned revision. Final diff/check/status reviewed; unrelated cloud-song changes preserved.

## F05 gift composition slice

Export named gift module objects from notification/detection/sprint/recent/blindbox/analysis; `gifts/index.js` directly imports its collaborators and history functions. Route legacy publication through the bridge. Replace blindbox cross-module lookups with imports. Preserve initialization and old public methods; retain legacy state access until its owning migration. Verify blindbox, toast, gift history, entry composition and module boundaries. Songs and other Admin globals remain outstanding.

F05 progress: gift module objects and cross-module calls are named ESM imports;
legacy publication is isolated in the bridge, seven side-effect entry imports
removed. `createSongs({state, utils})` owns song UI dependencies; app and category
renderer import the song capability directly. Gift regression replaces the legacy
registry and still renders via imports. Tests: gift/history/toast/runtime/boundary
51 passed, song/form/runtime/boundary 34 passed, state renderer/startup 5 passed,
final gift composition/AI 7 passed, architecture 22 passed. Gift modules still read
legacy utils/state through the bridge; other Admin producers/consumers remain.
F05 is not complete. No UI layout or privileged desktop behavior changed; no live
Electron check run. Existing unrelated frontend-test edits preserved.

F05 next slice: the application composition root now injects the gift renderer
into `createAdminStateRenderer`; the state renderer no longer reads the global
gift registry. Blindbox subscribes directly to the existing catalog-update event,
so recent artwork no longer forwards to blindbox through that registry. Keep the
existing snapshot guard, independent initialization and no circular import.
Regression replaces the legacy registry before a catalog event and verifies the
blindbox view still updates. Focused renderer/startup/runtime/mapping/composition
tests: 31/31 passed; architecture: 22/22 passed. Remaining F05 work includes gift
utility/state reads and other legacy Admin consumers; do not mark F05 complete.

F05 gift dependencies completed: all gift modules now import utilities directly;
blindbox imports `stateService`, and notification exposes a factory with an
explicit toast capability. No gift module or songs/state renderer reads the
legacy registry; boundary gate protects this migrated surface. Legacy publication
remains in the bridge. Converted affected source-stripping tests to the existing
real ESM loader and exercised actual money/HTTP parsing plus state hydration.
Focused gift/mapping/notification/AI tests: 37/37; artwork/recent/panel/toast tests:
26/26 (including the existing isolated Playwright toast test). Architecture:
22/22. Other Admin legacy modules remain for the next F05 scope review; F06–F14
and S01–S06 remain pending. No desktop app or real data was used.

F05 toolbox slice: metrics, todo and gift-effects export named module objects;
app imports and initializes them directly, removing three side-effect imports
from index. Utility imports are explicit; compatibility publication is in bridge.
StateService's existing bound legacy methods are now published by the bridge.
Removed the four completed debt baselines and extended the no-registry-read gate.
Toolbox/startup/todo/gift-effect/boundary tests: 42/42; state ordering/rendering/
blindbox: 25/25; architecture: 22/22. Existing todo storage error and migration
tests use isolated memory. Forms/theme/display/import/other, desktop lyric,
danmaku and AI Admin legacy paths remain to migrate. F05 remains in progress.

F05 danmaku/AI slice: both modules now export their named public capability and
import shared notification utilities. AI initialization accepts a notification
sink for isolated tests; danmaku initialization accepts its reconnect capability,
passed from app through toolbox options. Bridge retains the legacy no-argument
danmaku initialization fallback. Removed both debt baselines; boundary tests
forbid registry reads in these modules. AI autosave/secrets, danmaku (including
existing isolated browser checks), startup and boundaries: 49/49 passed.
Toolbox still consumes these capabilities via its old registry and remains a
pending F05 consumer migration alongside forms/theme/display/import/desktop lyric.

F05 toolbox consumer completed: `other` exports its navigation API and accepts
danmaku/AI capabilities and main-page navigation explicitly at initialization.
App imports all three modules and supplies these capabilities; index no longer
relies on their side-effect imports. Bridge adapts the old toolbox initialization
signature for legacy callers. New regression clears the old registry and checks
navigation, reconnect callback wiring and both feature refreshes. Sidebar,
toolbox, AI, danmaku browser, startup and boundary tests: 51/51 passed. Remaining
F05 scope is forms/theme/display/import, desktop lyrics and settings composition
(including aliases of AdminApp not counted by the old raw-text debt gate).

F05 desktop-lyric slice: preview imports state and notification capabilities;
settings exposes `createDesktopLyric` with explicit utilities/forms/state/preview
dependencies and an imported production singleton. App imports that singleton;
two redundant entry side-effect imports are removed. Bound form calls retain the
FormsService receiver. Legacy publication stays in bridge, both debt entries
removed and boundary gate extended. Runtime tests use injected dependencies and
clear the global registry before initialization; font loading and autosave still
pass. Settings/runtime/surface/startup/boundary tests: 32/32; architecture: 22/22.
No Electron IPC, privileged integration or renderer behavior changed. F05 remains
in progress for forms/theme/display/import and settings composition.

F05 imports slice: `createSongImports({state, utils})` owns explicit dependencies,
exports `songImports`, retains its parser/file/cloud/background APIs and existing
singleton initialization. App and settings composition import it directly;
legacy publication is in bridge. Import success paths call the injected state
reload; cloud sync reads songs from that same capability. Boundary gate forbids
legacy reads. Toast/cloud-sync/import-update/startup/boundary suite: 40/40;
import UI/parser suite: 6/6; architecture: 22/22. Notification test clears registry
and verifies one reload per completed import. Forms/theme/display and remaining
settings composition are still pending within F05.

F05 settings composition completed: settings imports state, forms, queue's existing
renderState, blindbox and import capabilities directly; existing operation/form
factories keep their getter interfaces. Settings exports a named public object;
app imports it for initialization and reconnect callbacks, while bridge publishes
the unchanged legacy method set. Removed redundant settings side-effect import;
contextual help still precedes app initialization. Migrated-surface boundary
checks now reject any AdminApp identifier, including windowRef aliases. Settings/
profile/startup/runtime/boundary tests: 36/36; contextual-help/edit-state/room-refresh
UI tests: 36/36; architecture: 22/22. No auth, IPC or settings persistence changes.
Remaining F05 modules: forms, theme and display, plus final consumer review.

F05 display completed: display imports utilities, shared theme data, state,
forms and blindbox URL generation explicitly; app initializes the named export.
The existing preset-card renderer moved unchanged in behavior into
`theme-preset-cards.js`, consumed by both theme and display, avoiding a new
dependency on the legacy theme registry. Bridge preserves display API publication;
form range bindings retain their receiver. New actual-module regression clears
the registry and verifies local overlay/legacy blindbox URLs and unavailable
server-overlay copying. Display/songboard/theme/startup/runtime/boundary tests:
44/44; architecture: 22/22. Forms and theme plus final consumer review remain.

F05 completed: forms and theme now use named ESM dependencies. The shared
`theme-style-view.js` owns style visibility/labels without importing the form
service, so the migration introduces no forms/theme import cycle. Forms receives
a getter for the existing playback popup close capability at workspace startup;
legacy initialization receives the same dynamic fallback from the bridge.
Theme/form publication and existing fullscreen globals remain in the bridge.
App imports theme and shared preset data, removing its theme registry lookup and
the redundant index side-effect import. No raw AdminApp references remain in
Admin code outside the bridge; only app's existing desktop/playback lifecycle
adapter still obtains legacy external producers through the bridge. Those
external shared/desktop/playback surfaces retain their separate debt budgets;
this does not claim the entire browser legacy registry has been removed.
Regression checks clear the registry while exercising theme sync and late-loaded
popup closure. Focused form/theme/startup/edit-state tests: 78/78; architecture:
22/22. No live Electron session was launched for this dependency migration.
Next: F06 shared server room-profile cache; F07-F14 and S01-S06 remain pending.

## F06 implementation boundary

Room-profile service owns the single room cache and normalized internal details
(owner, room ID, title); public consumers retain their exact owner/room projection.
Admin composes these details with its separately cached account lookup. Share the
bounded context-keyed cache lifecycle between those two different resources:
streamer key, room + credential fingerprint, in-flight coalescing, TTL and late
context fence. No public account lookup and no upstream raw data in cache/DTOs.
Successful components expire in five minutes; failed components in thirty seconds,
so an account failure no longer forces successful room I/O. Update normative cache
wording for this per-component behavior without changing wire schema. Verify
cross-consumer concurrent counts, failure recovery, context changes/deletion,
old completion versus replacement, TTL, tenant isolation and existing HTTP tests.

F06 completed: the production Admin singleton consumes the same room-profile
service as public/Streamer callers. Internal room details add normalized title;
public and cached projections still expose only roomId/owner. Account lookup
remains Admin-only and separately cached. A shared domain-local profile cache
owns the 100-tenant bound, request coalescing, component TTL and context fence.
Admin also rechecks context after both components settle. Requirement and
acceptance wording plus both profile protocols now describe independent component
TTLs; wire DTOs, authorization and existing error codes remain unchanged.
New shared-room tests cover both consumers, identical-context distinct tenants,
independent failures/recovery, TTL, old completion after replacement, deletion,
and slow-account context changes. Existing HTTP test confirms production Admin
and Streamer avatar reads share cached room I/O. Focused profiles/avatar/QR/gift-
chat plus architecture/documentation checks: 86/86 passed. Reviewed server diff
and status; git diff --check passed. No live upstream calls or user data used.
F07 is next; remaining F07-F14 and S01-S06 are pending.

F07 deferred by explicit user selection on 2026-09-21. Proposed source ownership,
snapshot/hash checks and compatibility policies are reviewable in
`docs/architecture/adr/0020-shared-danmaku-source.md`; design is not accepted and
no F07 source distribution changes are implemented. Continue F08-F14/S01-S06.
Do not mark F07 complete or silently count the entire original audit as resolved.

F08 completed: existing classic-script `overlay-utils.js` is the sole overlay
owner of color conversion, multilingual fonts, escaping, low-power selection and
scroll travel. A small named ESM adapter imports that owner before publishing its
functions to module consumers. Queue's exported utility API remains compatible;
blindbox imports the same helpers. `overlay-theme.js` applies shared color/font/
blur/glow/gradient tokens, while page backgrounds, queue styles and animations
remain in their owning modules. Admin and OBS overtime now import the same pure
clock/finished-label/calendar-tier helper; distinct signed labels stay local.
Existing text-bundle tests gained side-effect-import and named-export-list support;
new true ESM tests prove adapter/classic function identity and theme token behavior.
Focused overlay/queue/blindbox/typography/overtime checks: 50/50; architecture:
22/22; documentation: 5/5. Diff reviewed; no live Electron session needed for
these pure helper changes. F09 is next; F07 remains explicitly deferred.

## F10 implementation boundary

Extract only the existing synchronous BEGIN IMMEDIATE/COMMIT/ROLLBACK wrapper
from the three lottery stores. Each store still chooses its transaction boundary
and connection. A BEGIN failure propagates without invoking the operation or
rolling back somebody else's transaction. Operation/COMMIT failures attempt one
ROLLBACK and rethrow the original Error object (including code and existing cause).
A failed rollback is attached as `rollbackError`, never overwriting the primary
error's cause. No async callbacks, nested transactions, retries or schema changes.
Verify injected BEGIN/operation/COMMIT/ROLLBACK failures, real in-memory SQLite
rollback, and the existing store/collection/scheduler/results suites.

F09 completed: `src/electron/cookie-details.js` contains the two unchanged pure
converters, imported by music and Bilibili authentication modules. Domain/path,
secure/httpOnly, finite expiry coercion and existing field omission stay identical;
no partition, safeStorage, login window or Bilibili legacy export policy changes.
Synthetic converter fixtures plus auth/profile/window/diagnostics tests: 23/23.

F10 completed: all three lottery stores import the same synchronous transaction
helper. Rollback errors are retained as `rollbackError`; the original error object,
code and existing cause survive. Store-owned transaction scopes remain unchanged.
In-memory SQLite and injected BEGIN/operation/COMMIT/ROLLBACK cases, plus lottery
store/collection/scheduler/results tests: 16/16. Architecture: 22/22. Storage owner
doc records the diagnostic policy. Both diffs reviewed; no generated/user data
added. F11 is next; F07 remains deferred by user.

## F11 implementation boundary

Create a storage-only `resetGiftProjectionMetadataInTransaction` operation that
updates only the chosen gift_sync_state row, increments generation, clears all
epoch/cursor/bootstrap/validation anchors and returns the new generation. It does
not open/commit a transaction, delete events or validate caller-owned scope.
Manual clear and rebuild call it within their existing transactions and preserve
their current operation order and different event deletion predicates. Verify
complete reset fields, unchanged other sources/local rows, differing source-owned
non-server rows, stale-generation rejection and injected mid-transaction failure.

F11 completed: `gift-projection-reset.js` owns the shared UPDATE and generation
read inside the calling store's existing transaction. Manual source clear and
remote-only rebuild retain their predicates and reset/delete ordering. Regression
fixtures cover all nonempty partial-bootstrap anchors, source-owned non-server
rows, another source, and trigger failures after reset/before deletion or after
deletion/before reset. Existing complete-bootstrap reset and stale generation
checks remain passing. Sync-store/ledger-maintenance/clear-all/maintenance/recovery:
33/33 passed. Storage owner documentation updated; no schema changes.

F12 completed: `qq-provider-client.js` has one internal response reader used by
all four audited JSON request methods plus the existing playlist-write request's
identical parsing stage. Plain text requests and all headers/signatures/auth/body
construction remain untouched. Tests cover JSON and JSONP, one text read, HTTP
error precedence, parse error wording, stream failures and playlist post-parse
handling. QQ response/provider/encrypted-stream suite: 27/27; architecture: 22/22.
Both diffs reviewed; no network/user data used. F13 is next; F07 remains deferred.

F13 completed: one pure sensitive-field classifier is shared by log redaction and
license response sanitization. Log URI decoding, masking and response field removal
stay with their consumers; encoded response property behavior is unchanged.
Classifier/log/background/license-operation/remote-client tests: 44/44 passed.

F14 completed: current game shells load the same classic-script manifest parser
and slug validator before their loaders. Public helper exports remain compatible.
Static allowlist, no-cache/ETag checks and both transfer-budget inventories include
the new resource. No versioned game assets changed. Game page/catalog/storage/
offline/constellation and architecture checks: 80/80 passed. Both diffs reviewed;
existing unrelated test refactors preserved. F07 remains deferred; S01 is next.

S01 completed: three music auth DTO copies now use src/music/auth-state.js;
provider helper exports remain compatible. Default coercion and allowed fields
are unchanged; credential omission has explicit regression coverage. Music auth,
QQ/Netease providers, provider manager and auth manager: 47/47 passed (ESM flag).

S02 completed: song-library owns serializeCanonicalSongRow, used by Admin and
Device projections. Device still appends legacy aliases; public projection keeps
its independent allowlist. Explicit projection tests plus validation/sync/Admin
tenant/read-compatibility/public-profile checks: 41/41 passed. No wire change.

S03 completed: WBI signer and local danmaku API client import the same Bilibili
error formatter. Code coercion, message fallback, extra hints and 220-character
data bound remain unchanged. Formatter/signer/send/room/avatar/client: 22/22.

S04 assessed and deferred with F07 source-distribution dependency. Both readers
share varint and wire-type byte handling, but the server also accepts a known-
string-field schema to prevent UUID bytes from becoming guessed nested messages.
A common byte reader must preserve both outer decoding policies. No cross-repo
runtime import, duplicated new helper or unapproved source-sync system added.
This is an unresolved reuse opportunity, not a completed implementation.

S05 completed: lyric-normalization owns identical line cleaning and finite numeric
bounds. Word text keeps its separate untrimmed behavior; timeline ordering, text
budgets and state sequence policy stay local. Whitespace/fractional time/nonfinite
regression plus lyric publication/recovery/parsing checks: 28/28 passed.

S06 completed: both management routes compose the shared gift-query error status
table from src/lib/gift-query-error-status.js. Actor-specific mappings, auth,
Retry-After, abort handlers and response bodies are unchanged. Admin/Streamer
gift HTTP, management authorization and architecture checks: 29/29 passed.

## Current delivery status

18 of 20 audit items implemented and individually verified. F07 is deferred by
explicit user choice; S04 remains deferred on the same source-distribution
decision. These two are not counted as implemented. No other item is pending.
Unrelated working-tree edits were preserved; no commits, branches or deployment.

Final verification: client verify:quick passed (documentation 5/5, all JavaScript
syntax checks, architecture 22/22). Server architecture passed with S06 HTTP
checks. Both repositories passed git diff --check and final status review; newly
added source/test files were inspected directly. No live desktop, real credentials
or user data were used. Full repository suites and live UI QA were not run for
this final set of pure helper extractions. Keep this ledger available for the
two deferred items instead of archiving it as fully resolved.
