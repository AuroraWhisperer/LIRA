# Feature: 本地场景文档与组合来源

## Goal And Status

Implemented and verified. This specification defines P3 and local P4 of the user-approved component design. The output is a real local browser source for OBS and Bilibili Livehime. P2 remains a default-component tuning workspace; a scene is a separately owned document and publication target. Completion evidence is in [the archived implementation plan](plans/archive/2026-09-30-component-workspace.md).

The 2026-09-30 browser editor reuses these scene documents for a common canvas. Resolution presets and custom dimensions are shared by every layer; new layers are centered and selection/style changes do not resize the canvas. The desktop loads the first existing scene or creates one using the loaded danmaku canvas dimensions when none exists. Direct entry starts empty on first use and restores saved layouts later; component preview entry selects or adds its component. One Add Component dialog groups existing styles by category and creates independent appearance snapshots, allowing different styles of one type to coexist. Component-entry layers retain shared defaults and their original save owners.

The browser's Save and Apply waits for queued edits to be acknowledged, saves component owners and the bound scene, then publishes through the scene owner. Discard restores the scene and shared defaults involved in this editing session, including removed shared layers; unrelated component drafts remain untouched. Save failures, outstanding drafts and publication conflicts retain the previous live version. A canvas-only temporary capability grants bound publication and explicit source retrieval, never arbitrary scene management or rotation. Copy Live Source produces one persistent `127.0.0.1:<actual-port>/scene?id=…#token=…` address for the combined output; subsequent publication reuses it. The source capability is returned only on copy and never added to documents or templates.

The desktop Browser Sources directory exposes that same bound source and a unified-preview launcher. Copying never publishes implicitly and clears its displayed credential when the account/source changes. Standalone component sources remain usable without creating or publishing a scene: `/clock`, `/queue`, `/overtime` and `/danmaku?source=component`. The latter reads the existing scoped cloud display buffer and saved default appearance through the danmaku-only display API; the legacy `/danmaku` path and online source remain compatible. Output pages use live data, a transparent canvas and no editor session; closing the editor does not interrupt output. Setup and dimensions are specified in [the component guide](../docs/guides/component-sources.md).

The 2026-10-01 requirement makes saved component dimensions authoritative for local
output ([implementation and verification](plans/archive/2026-10-01-component-output-size.md)).
Publishing shared defaults also saves their output width/height, scoped to
the current owner, in the scene store's publication transaction. Their original
standalone addresses consume those dimensions; appearance remains owned by the
existing component services. Shared references in one document must have matching
dimensions; the editor updates them together. Independently added components keep
their own dimensions and appearance. Removing a shared layer does not reset its
last saved default dimensions. Reopening from the component entry restores those
dimensions when adding its shared layer, constrained to the current canvas; only
components without saved dimensions use their original default size.
Old publications remain intact; inconsistent shared
sizes must be reconciled or converted to independent components before republishing.

Copy Component Source returns the original address for a shared default, or
`/scene?id=…&item=…#token=…` for an independent published instance. The latter projects
the same published item at (0,0), with its exact dimensions and configuration,
including when hidden in the complete scene. It is not a copy of the configuration.
An item selector does not narrow the scene capability's authority. Unpublished or
removed item IDs reject output; ordinary saves reuse the address and rotation
invalidates it with the scene source.

Output uses saved CSS pixels without fitting to the browser viewport: 800×400
remains 800×400 at 1080p, 2K and 4K. Larger viewports add transparent space; smaller
ones clip. Editor fit/zoom remains a viewing aid. Overtime keeps automatic height
measurement in the editor and saves that measured output rectangle. Original
sources without saved dimensions retain legacy behavior. Online server sources
and manual transforms in streaming software are outside this local output contract.

## Ownership And Compatibility

- Scene service owns scene draft, publication, capability and bounded display-event buffer. Store owns SQLite transactions in existing songDb, through an appended migration. No new database process or framework.
- Trusted main provides the current authorized Server origin + streamerId and authorization generation. Browser-supplied owner or roomId never chooses scope. Anonymous standalone runtime cannot manufacture an authorized scene owner.
- Existing clock/queue/overtime/danmaku services retain business and default-configuration ownership. A scene creates display instances, never duplicate countdown or gift settlement services.
- Existing page URLs, runtime Host/Origin validation, WS principals, settings keys, login and shutdown order remain compatible.

## Scene Document

Version 1 contains a scene ID, title, canvas width/height and ordered items. Each item has a stable ID, component type (danmaku/clock/queue/overtime/songlist/lyrics/games/wheel/interactions/gift-feed/blindbox/gift-wishes), display name, x/y/width/height, visible/locked and appearance target. Array order is layer order. Canvas uses integer logical pixels, 320–7680 per axis; items are bounded to the canvas, at least 32 pixels; at most 32 items. Schema validation rejects unknown top-level/item fields, duplicate IDs, invalid types, nonfinite geometry and excessive payloads.

The eight added types are independent-only appearance instances. Their geometry and settings are persisted in the existing scene document, not in default-component size/settings storage. The original four shared-default owners, their preview sessions and database constraints remain unchanged. The picker groups games into live interaction (number-bomb/gomoku/draw-guess), wheel, and poll/rating. Wish variants are card/text/circle. Every instance exposes its own allowlisted appearance parameters. Game configuration only selects the displayed current session; it never starts a session or changes game rules, prizes, wish targets or accounting.

Existing overlay renderers consume config/data through the sandboxed component protocol without API credentials or their normal HTTP/WS clients. Real output projects existing local domain services through their overlay field allowlists. Slow gift/profile reads are shared for five seconds per owner epoch, gift revision and date; owner and source capability are rechecked after asynchronous output reads. Samples exist only in the editor provider. Unavailable gift sources clear the affected display; no business state or sample data is stored in the scene.

Appearance target is either shared default or scene-independent configuration. The editor labels this target explicitly. Shared edits use the existing default controller and its separate save action; independent edits belong to the scene draft. Switching to independent takes an explicit current appearance copy.

The complete publish action explicitly freezes every item's effective appearance, including shared defaults, into the published version. Later default changes affect references in the editor but require another scene publication to alter the complete output. The legacy scene editor calls this “发布整套（固定当前外观）”; the browser canvas uses “保存并应用” after saving the affected owners. Neither claims live shared defaults are atomically versioned.

The editor requires referenced shared defaults to be loaded and saved before publication. It sends their appearance snapshots for equality checking against the owner's normalized defaults. A delayed cloud appearance update or concurrent default change rejects the publication without replacing the previous version; it never silently publishes an older cached appearance.

Selected IDs, viewport zoom, pointer gesture state and history are session data. Real queue entries, countdown authority, gift records, cloud live-session state and all credentials are excluded from scene documents and templates.

## Persistence And Publishing

Store scene draft with optimistic revision; stale save/publish returns conflict without overwriting newer data. Publish checks expected draft revision and validates/resolves the complete snapshot, then atomically commits published document + monotonically increasing publication version. A failed validation or commit preserves the previous publication. Saving a draft alone never changes live output.

The same store transaction commits shared default output sizes with the scene
publication. A failed size write rolls back both. A read-only component-size route
returns only width/height (or null) for the authenticated overlay's own scope;
query parameters cannot select another component or owner.

Output prepares all visible item renderers for a new version offscreen. Only after every instance confirms preparation does it replace the old layer container in one operation. Timeout, invalid config or load failure keeps the old version; disposal cancels callbacks and destroys staged frames. Data updates continue independently of version changes. Repeated same-version responses do not reload instances.

## Capability And HTTP

Create one random 256-bit capability per scene. Store only hash plus a safeStorage-encrypted package containing schema version, owner scope, scene ID, capability version and token. No plaintext fallback. Decode verifies all fields and digest. Encryption/decryption failure never replaces an existing capability. Reuse the existing secret-codec interface through a narrow injected port; do not expose cryptography IPC.

The scene URL uses a fragment token: `/scene?id=<sceneId>#token=<secret>`. The page is a credential-free static shell with opaque sandbox, no existing overlay bootstrap. The token stays in the parent renderer and authorizes only `GET /api/scene/output` for that scene. It is not recognized by common HTTP/WS principal resolution, admin APIs or old overlay scopes. Exact-path preflight is allowed for opaque origin; actual reads still require the scene credential and current owner.

Management endpoints live under `/api/scenes/` and keep the existing admin authorization. They expose list/document/save/publish/source/rotate operations through a narrow scenes facade. Ordinary DTOs exclude token, hash and encrypted package; only the explicit source action returns the capability URL. Rotation invalidates old capability on the next output read without deleting the scene.

Every response is no-store. Logging must redact fragment tokens as well as query/header secrets. Child renderers receive neither scene nor cloud credentials. Component preview/scene frames must not be injected with independent overlay tokens.

The existing configurable local listener remains. A same-port restart restores documents, publication and capability; a port conflict retains the existing runtime fallback behavior and requires copying the actual new address. This feature does not promise an invariant URL across a changed listener address.

## Real Data And Cloud Stream

One local output poll, approximately every 750 ms and never overlapping, returns the publication when changed, only required component display projections and cloud stream epoch/cursor/reset/gap information. Countdown rendering interpolates its authoritative time; no business data is written by polling.

Main gets the cloud overlay URL from authorized getOverlaySettings(). It validates that trusted response and opens the same-origin public overlay SSE with no Device Bearer/Cookie, redirect disabled, bounded parsing and abortable reads. No renderer chooses the URL. One current-account connection is shared across all scenes and instances; logout/account/server changes abort, clear state and reject late callbacks.

Cloud `overlay-state` must precede events. Preserve liveSessionId, live start/end and reconnect reset semantics. Gift and SC events enter display only, never local settlement/reply pipelines. The local cursor refers only to the bounded events main received; it is not a Server replay cursor. A gap is reported, never filled by synthetic or local Bilibili feed data.

Shared cloud appearance updates may refresh the editor default cache, but cannot mutate a frozen published version. The component renderer's scene mode disables sample generation and consumes real parent-projected events. Child readiness/config acknowledgement uses exact parent source; opaque-parent acceptance is restricted to explicit scene mode.

## Local Editing Efficiency

Support multiple instances, layer order, visibility, lock, logical geometry, multi-selection, group move, align and snap. A pointer gesture is one undo entry; cancel restores its starting document. Undo/redo tracks document edits only, not business events, saved confirmations or viewport selection.

Templates export only the validated display document. Import validates before changing draft, generates fresh scene/item identity and does not import publication or capabilities. Machine-specific fonts/assets and logical sources must be presented for explicit rebinding; missing references cannot be silently claimed ready. After binding, the scene owner's read-only validation operation normalizes the complete document and each appearance before the editor creates or switches to a new scene. No cross-device synchronization, cloud output or OBS control in this scope.

## Acceptance Evidence

- Isolated migration/restart and stale-revision tests prove data integrity and capability persistence; no real database read or migration.
- Exact HTTP authorization matrix proves scene-only access, cross-scene denial, rotation, owner change/logout, opaque CORS and old principal compatibility.
- Synthetic cloud SSE tests prove first-frame validation, bounded parsing, redirects/no credential forwarding, generation fencing and cleanup; cross-check locked public fixtures.
- Real renderer integration proves simultaneous actual data, two distinct instances, atomic publication, failed staging retaining old output, reconnect reset and no child API credentials.
- Isolated Electron proves editor save/reopen, publication visible through its copied source, default vs independent target, drag/align/group/lock/history/template behavior and lifecycle cleanup.
- Docs, proportional full gates and final diff review are required. Deployment or real live-account evidence is not claimed by synthetic tests.
