# Feature: 本地场景文档与组合来源

## Goal And Status

Implemented and verified. This specification defines P3 and local P4 of the user-approved component design. The output is a real local browser source for OBS and Bilibili Livehime. P2 remains a default-component tuning workspace; a scene is a separately owned document and publication target. Completion evidence is in [the archived implementation plan](plans/archive/2026-09-30-component-workspace.md).

The 2026-09-30 browser editor reuses these scene documents for a common canvas. Resolution presets and custom dimensions are shared by every layer; new layers are centered and selection/style changes do not resize the canvas. The desktop restores the last applied scene preset, or creates the first preset using loaded danmaku dimensions on first use. An existing empty canvas binding remains empty after all presets are explicitly deleted. Multiple presets retain separate draft controllers and documents; one owner-scoped canvas binding preserves the original first scene as the stable output. Selecting, creating, copying or saving a preset does not publish. Save and Apply atomically replaces that output and records the applied preset, checking both the preset revision and output publication version. Existing source credentials are retained. Copies use fresh item IDs and independent appearance snapshots. Browser recovery is isolated by preset, and refreshing an entry from another preset does not re-add its original selected component. Direct entry starts empty on first use and restores saved layouts later; component preview entry selects or adds its component. One Add Component dialog groups existing styles by category and creates independent appearance snapshots, allowing different styles of one type to coexist. Component-entry layers retain shared defaults and their original save owners.

The browser's Save and Apply waits for queued edits to be acknowledged, saves component owners and the bound scene, then publishes through the scene owner. Discard restores the scene and shared defaults involved in this editing session, including removed shared layers; unrelated component drafts remain untouched. Save failures, outstanding drafts and publication conflicts retain the previous live version. A canvas-only temporary capability grants bound publication and explicit source retrieval, plus desktop-mediated preset selection/creation/copying, never arbitrary scene management or rotation. Copy Live Source produces one persistent `127.0.0.1:<actual-port>/scene?id=…#token=…` address for the combined output; subsequent publication reuses it. The source capability is returned only on copy and never added to documents or templates.

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

Preset deletion requires explicit confirmation and the desktop-held expected revision. Only the currently selected, desktop-listed preset can be deleted through the canvas capability. Any preset, including the initial fixed-output preset, can be deleted. The selector and toolbar identify the last applied preset as “当前输出”, without claiming streaming-software visibility. Deleting it confirms the output impact and atomically applies the first remaining saved preset in ID order, or a transparent empty document. Other drafts are never implicitly saved or published. A failed delete keeps the selected draft and output; success selects the output preset or first remaining preset. With zero presets, the editor stays empty across reopening and offers explicit scene creation. An appended migration separates editable presets from the retained fixed-output record and permits a null active preset; existing source IDs and credentials remain unchanged.

## Ownership And Compatibility

- Scene service owns scene draft, publication, capability and bounded display-event buffer. Store owns SQLite transactions in existing songDb, through an appended migration. No new database process or framework.
- Trusted main provides the current authorized Server origin + streamerId and authorization generation. Browser-supplied owner or roomId never chooses scope. Anonymous standalone runtime cannot manufacture an authorized scene owner.
- Existing clock/queue/overtime/danmaku services retain business and default-configuration ownership. A scene creates display instances, never duplicate countdown or gift settlement services.
- Existing page URLs, runtime Host/Origin validation, WS principals, settings keys, login and shutdown order remain compatible.

## Scene Document

Version 1 contains a scene ID, title, canvas width/height and ordered items. Each item has a stable ID, component type (danmaku/clock/queue/overtime/songlist/lyrics/games/wheel/interactions/gift-feed/blindbox/gift-wishes/text-box/browser), display name, x/y/width/height, visible/locked and appearance target. Array order is layer order (bottom to top). The bottom horizontal strip renders the reverse order, with the leftmost item highest. Pointer dragging previews only strip order; release inside the strip commits one undoable edit. Outside release, Escape, pointer cancellation and blur restore the original order. Every added item, including a background, is appended on top. Canvas uses integer logical pixels, 320–7680 per axis; item dimensions range from 32 pixels through the corresponding canvas dimension. Non-text-box items retain a combined limit of 32; text boxes have no numerical count limit, subject to the existing 256 KiB UTF-8 scene document limit. Items may extend beyond any edge, including negative x/y, but must intersect the canvas by at least 24 logical pixels on each axis. Group movement preserves spacing and this minimum for every unlocked item. Resizing, automatic height and shared-size updates preserve valid positions and clamp only when needed to retain that intersection. Editor and published output clip content at the canvas boundary. Both document validators share `public/js/shared/scene-geometry.js`; the existing version 1 fields and fully contained documents remain compatible. Schema validation rejects unknown top-level/item fields, duplicate IDs, invalid types, nonfinite geometry and excessive payloads.

The eight added types use independent scene instances for geometry and style selection. Shared display fields resolve through their existing desktop owner; scene-only fields remain in the document. The original four preview sessions and database constraints remain unchanged. The picker groups games into live interaction (number-bomb/gomoku/draw-guess), wheel, and poll/rating. Wish variants are card/text/circle. Every instance exposes allowlisted appearance parameters. Game configuration only selects the displayed current session; it never starts a session or changes game rules, prizes, wish targets or accounting.

The 2026-10-05 browser-source extension adds an independent-only `browser` item through the picker's `+更多` entry. Its exact configuration is `{ url, viewportWidth, viewportHeight }`: an absolute HTTP(S) URL without URL userinfo or control characters, at most 8192 characters, and integer viewport dimensions from 32 to 7680. The default viewport is 800×600. Item width/height are the displayed rectangle; dragging its resize handles scales the fixed webpage viewport without changing its resolution. Browser items retain normal movement, visibility, locking, layer order, dimension labels and publication. They expose no component appearance or third-party provider settings.

Existing overlay renderers consume config/data through the sandboxed component protocol without API credentials or their normal HTTP/WS clients. Real output projects existing local domain services through their overlay field allowlists. Slow gift/profile reads are shared for five seconds per owner epoch, gift revision and date; owner and source capability are rechecked after asynchronous output reads. Samples exist only in the editor provider. Unavailable gift sources clear the affected display; no business state or sample data is stored in the scene.

The persisted appearance target remains either shared default or independent configuration. Under the 2026-10-08 requirement, both forms use the existing owner for shared display parameters. Desktop saved values win over existing scene copies on first read. Native clock profiles, opening settings/media and imported resource-style IDs identify separate shared settings; instances retain their layout and selected style. Local extra-component fields use explicit settings/domain allowlists. Business records and scene-only fields never enter this sharing boundary. Imported media/CSS and external browser content retain their existing instance/provider contracts.

Publication freezes layout, style identity and scene-only configuration. The output includes live shared appearances even when the publication version is unchanged. Saved shared parameters update existing renderer frames without publishing unsaved geometry or replaying events. A failed later layout publication retains the old layout but does not roll back already saved shared parameters. Existing scene JSON is not rewritten in bulk.

The editor requires referenced shared defaults to be loaded and saved before publication. It sends their appearance snapshots for equality checking against the owner's normalized defaults. A delayed cloud appearance update or concurrent default change rejects the publication without replacing the previous version; it never silently publishes an older cached appearance.

Selected IDs, viewport zoom, pointer gesture state and history are session data. Real queue entries, countdown authority, gift records, cloud live-session state and LIRA credentials are excluded from scene documents and templates. A user-supplied browser URL is the only scoped exception for third-party URL capabilities: it is available to its authorized editor/output and encrypted at rest, and it never relaxes credential checks for other configuration fields. Templates omit every external browser URL and require explicit rebinding; persistent editor recovery also omits browser URLs. Empty URLs are allowed in editable/recovered drafts, but scene validation, save and publication require a complete URL.

## Component Suites

The canvas component picker also groups explicitly registered styles into suites. Selecting
月渡花汀 lists background, opening, clock, danmaku and gift-wish components; each adds one independent
layer with that suite's style, using the existing add flow. Opening appearances accept
`style: original | moonlit-fan`; legacy empty appearances default to `original` and continue
following the client. A fixed opening style overrides only rendering style in editor and
published output; text, media, enabled state and unavailable-data behavior retain their
existing owner. Suite selection never changes global component settings.

`background` is an independent-only built-in wallpaper, also available in the
picker's 背景 category. Its allowlisted `style` is `moonlit` (static, default) or
`moonlit-animated` (independent looping elements); it
uses the existing version 1 scene document. Adding it fills the current canvas and
inserts it above existing layers; drag it to the right end of the layer strip to use it as a backdrop. The
1920×1080 image covers the item proportionally, with centered cropping at other aspect
ratios. `/background` uses the existing sandboxed component handshake and confirms
readiness after image decoding; it has no business API/WS client or token bootstrap.
Templates retain its built-in preset without source or media rebinding. The suite
offers separate static and animated background cards. Existing static configurations
remain static. The animated version uses newly painted, pale silver-blue artwork
with a fixed camera. Separate moon, willow leaves, lanterns, mist and petal assets
are animated independently; water crests, reflections and expanding ripples are
rendered from time-based paths. The result is pre-rendered into a silent 2560×1440,
60fps, 24-second seamless WebM loop; playback does not warp the static wallpaper.
The movie loads only when animation is visible and enabled. The original image
remains visible until playback starts and on failure. Hiding pauses playback and
preserves position; disposal releases the decoder. Reduced motion displays the
original static image. No scene contract, authentication or media binding changes.

## Text Box Components

Implementation and verification: [2026-10-05 text-box plan](plans/archive/2026-10-05-text-box.md).

`text-box` is an independent-only scene component available above Games in the desktop toolbox and in the canvas picker. Each instance owns its content, name and geometry. Desktop and canvas use the same structured editor, draft/publish controller and sandboxed renderer; opening a specific instance carries its validated `selectedItemId` into the existing canvas session instead of selecting the first matching type. A deleted or wrong-type instance invalidates that specific entry.

The canvas picker offers a new text box and live thumbnails of the current scene's configured text boxes. Adding an existing choice creates an independent, visible, unlocked copy with a new ID, preserving its latest content, media, formatting and dimensions; it selects the copy and opens its editable inspector. Existing desktop-created instances already belong to this same scene. Reusing them does not create another library, settings store or shared mutable configuration.

Configuration version 1 contains default fontSize/color/align/lineHeight and ordered text, gift or image nodes. Text supports bold, italic, underline, fontSize and color overrides, plus optional boolean `stroke` and `shadow` flags (omitted means disabled). Effects use fixed dark, font-relative styles shared by desktop, canvas and published output. The editor exposes a selection-only toolbar, Ctrl+B/I/U, native undo/redo and plain-text paste. Its color palette offers common colors, six distinct recently used colors stored as local UI preferences, and custom colors; palettes are not part of scene configuration. The More panel toggles stroke/shadow and clears selected text formatting back to the configured defaults in one undo step without altering media or unselected text. Gift/image nodes are indivisible editor chips; output renders only their images. Gifts use room/all cached catalogs and built-in guard images. Kaomoji and emoji are bundled choices. Arbitrary HTML and unapproved image URLs are rejected.

The design width is 640 pixels with an initial 640×180 component. Resizing component width scales text and images together; height controls the visible area. Gift images default to 1.3em and uploads to 2em, with preserved aspect ratio and a 4em width cap. PNG, JPEG, GIF and WebP uploads preserve original bytes, including animation, and are limited to 5 MiB with MIME/signature validation. Files use UUID names in the local data directory. Template import explicitly confirms retaining each original image reference or removes that whole image node; text boxes have no business source to rebind.

Text media management retains desktop authorization. External canvas access is restricted to the current loaded canvas attachment's capability, owner and TTL, checked again after asynchronous work; media operations do not renew the lease. Uploaded media is served through a fixed read-only UUID path, without directory or arbitrary-file access. See the [API contract](../docs/reference/backend/api.md) and [storage contract](../docs/reference/backend/storage.md).

## Persistence And Publishing

Store scene draft with optimistic revision; stale save/publish returns conflict without overwriting newer data. Publish checks expected draft revision and validates/resolves the complete snapshot, then atomically commits published document + monotonically increasing publication version. A failed validation or commit preserves the previous publication. Saving a draft alone never changes live output.

The same store transaction commits shared default output sizes with the scene
publication. A failed size write rolls back both. A read-only component-size route
returns only width/height (or null) for the authenticated overlay's own scope;
query parameters cannot select another component or owner.

Output prepares all visible item renderers for a new version offscreen. Only after every instance confirms preparation does it replace the old layer container in one operation. Timeout, invalid config or load failure keeps the old version; disposal cancels callbacks and destroys staged frames. Data updates continue independently of version changes. Repeated same-version responses do not reload instances.

If the visible instance identities/types, owned appearance and external browser URLs are unchanged, a publication instead updates geometry, names, layer order and external viewport sizes synchronously in the existing container. Frames are neither moved nor reloaded, preserving their connections and animations; the displayed version and projection receipt advance together. Changing the visible instance set, an owned appearance or a browser URL still uses complete-version preparation and failure retention.

External browser frames use the iframe load event as their available preparation signal. They never receive or control the owned component message protocol, and scene/domain data is not projected to them. This signal does not prove that a third-party application rendered its content or that it permits embedding. The existing opaque `sandbox allow-scripts` remains in force, with no-referrer navigation. Provider `frame-ancestors`/X-Frame-Options restrictions, login requirements and dependence on ordinary same-origin storage or origins may prevent a source from working; LIRA does not weaken browser security or proxy the page to bypass them.

Browser URLs are sealed through the existing scene secret codec before writing either draft or publication JSON. The encrypted package binds schema version, owner scope, scene ID and item ID. Reads verify all bindings; encryption/decryption failure has no plaintext fallback and a failed save/publication preserves the previous stored version. Existing version-1 documents without browser items retain their stored representation and require no database migration.

## Capability And HTTP

Create one random 256-bit capability per scene. Store only hash plus a safeStorage-encrypted package containing schema version, owner scope, scene ID, capability version and token. No plaintext fallback. Decode verifies all fields and digest. Encryption/decryption failure never replaces an existing capability. Reuse the existing secret-codec interface through a narrow injected port; do not expose cryptography IPC.

The scene URL uses a fragment token: `/scene?id=<sceneId>#token=<secret>`. The page is a credential-free static shell with opaque sandbox, no existing overlay bootstrap. The token stays in the parent renderer and authorizes only `GET /api/scene/output` and `GET /api/scene/events` for that scene. It is not recognized by common HTTP/WS principal resolution, admin APIs or old overlay scopes. Exact-path GET/Authorization preflight is allowed for opaque origin on these two routes; actual reads still require the scene credential and current owner.

Management endpoints live under `/api/scenes/` and keep the existing admin authorization. They expose list/document/save/publish/source/rotate operations through a narrow scenes facade. Ordinary DTOs exclude token, hash and encrypted package; only the explicit source action returns the capability URL. Rotation invalidates old capability on the next output read or stream revalidation without deleting the scene.

Every response is no-store. Logging must redact fragment tokens as well as query/header secrets. Child renderers receive neither scene nor cloud credentials. Component preview/scene frames must not be injected with independent overlay tokens.

The existing configurable local listener remains. A same-port restart restores documents, publication and capability; a port conflict retains the existing runtime fallback behavior and requires copying the actual new address. This feature does not promise an invariant URL across a changed listener address.

## Real Data And Cloud Stream

One non-overlapping local output read returns the publication when changed, only required component display projections and cloud stream epoch/cursor/reset/gap information. Runtime updates notify a dedicated fetch SSE connection through `/api/scene/events`; 40ms server coalescing and a 100ms minimum output request-start interval bound bursts. A healthy stream uses a five-second output health check. Missing or disconnected notifications restore 750ms polling with bounded reconnect backoff. Countdown rendering interpolates its authoritative time; reads never write business data.

Notifications contain only `ready`, `change` or `revoked`, with comment heartbeats. They contain no scene identity, component data, provider URL or business event identifier. The stream authenticates the same scene/item and optional active projection receipt as output reads, so failed replacement preparation keeps old component types subscribed. Only committed renderer version/receipt changes reopen the subscription. Owner/epoch, capability, item and license/lifecycle are revalidated before notifications and every second; revocation clears output, while stream unavailability alone retains authenticated output. There are at most four open streams per local runtime; excess streams receive 429 and fall back to polling. Slow readers and shutdown close streams and release all timers/listeners before inflight drain. Page disposal aborts the browser's reads, notification stream and retry timers.

Scenes containing only self-contained browser, clock or text-box layers do not read a business-state snapshot for their output projection. When display ports are needed, they share one snapshot per read. External browser pages receive their provider data directly inside the streaming application's browser; their live updates do not wait for the scene output read.

Main gets the cloud overlay URL from authorized getOverlaySettings(). It validates that trusted response and opens the same-origin public overlay SSE with no Device Bearer/Cookie, redirect disabled, bounded parsing and abortable reads. No renderer chooses the URL. One current-account connection is shared across all scenes and instances; logout/account/server changes abort, clear state and reject late callbacks. Display/default-appearance reads renew a shared demand lease; after 15 seconds without a read, main releases the upstream connection and clears live events. New demand reconnects automatically. Authorized settings reads/saves also update the owner-fenced appearance cache, so saving before opening a live source does not depend on an existing SSE connection.

Standalone `/danmaku?source=component` uses the same notification/read client as scene output, through the danmaku-scoped `/api/danmaku/events` and existing display route. Healthy notifications replace idle 750ms polling with five-second checks; missing/disconnected notifications retain the original polling fallback. Source URLs, saved dimensions, rendering and local Bilibili business input remain compatible.

Cloud `overlay-state` must precede events. Preserve liveSessionId, live start/end and reconnect reset semantics. Gift and SC events enter display only, never local settlement/reply pipelines. The local cursor refers only to the bounded events main received; it is not a Server replay cursor. A gap is reported, never filled by synthetic or local Bilibili feed data.

Shared cloud appearance updates may refresh the editor default cache, but cannot mutate a frozen published version. The component renderer's scene mode disables sample generation and consumes real parent-projected events. Child readiness/config acknowledgement uses exact parent source; opaque-parent acceptance is restricted to explicit scene mode.

## Local Editing Efficiency

Support multiple instances, layer order, visibility, lock, logical geometry, multi-selection, group move, align and snap. A pointer gesture is one undo entry; cancel restores its starting document. Undo/redo tracks document edits only, not business events, saved confirmations or viewport selection.

Templates export only the validated display document. Import validates before changing draft, generates fresh scene/item identity and does not import publication or capabilities. Machine-specific fonts/assets and logical sources must be presented for explicit rebinding; missing references cannot be silently claimed ready. Browser URLs are always removed on export and import, including URLs without an obvious token parameter, and one browser URL binding is required for every such item. After binding, the scene owner's read-only validation operation normalizes the complete document and each appearance before the editor creates or switches to a new scene. No cross-device synchronization, cloud output or OBS control in this scope.

## Acceptance Evidence

- Isolated migration/restart and stale-revision tests prove data integrity and capability persistence; no real database read or migration.
- Exact HTTP authorization matrix proves scene-only access, cross-scene denial, rotation, owner change/logout, opaque CORS and old principal compatibility.
- Synthetic cloud SSE tests prove first-frame validation, bounded parsing, redirects/no credential forwarding, generation fencing and cleanup; cross-check locked public fixtures.
- Real renderer integration proves simultaneous actual data, two distinct instances, atomic publication, failed staging retaining old output, reconnect reset and no child API credentials.
- Text-box tests prove structured-config rejection, more than 32 independent instances, the document byte boundary, image rebinding, selection formatting/undo, indivisible chips, media authorization and unchanged animation bytes. Isolated Electron checks cover desktop editing, same-instance canvas navigation, proportional resizing and save/restart persistence.
- Isolated Electron proves editor save/reopen, publication visible through its copied source, default vs independent target, drag/align/group/lock/history/template behavior and lifecycle cleanup.
- Docs, proportional full gates and final diff review are required. Deployment or real live-account evidence is not claimed by synthetic tests.
