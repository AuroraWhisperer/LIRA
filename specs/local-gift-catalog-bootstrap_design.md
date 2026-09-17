# Local Paid Gift Catalog Bootstrap

Current catalog identity and image rules follow
[Gift identity across catalogs and overtime](gift-identity-overtime.md) and the
server's current public catalog protocol. They supersede this specification's
original schema-v2, ID-only image index and server-image fallback promises.

## Goal

After the first successful desktop authorization, keep the login window visible
with a centered initialization card until the paid global gift catalog has been
saved locally and every catalog image has been checked or downloaded. Normal
gift lookup then uses this local mirror rather than an interactive server
search.

## Context

The current runtime persists `data/overtime-gift-catalog-v2.json`, containing the
validated official gold metadata and blind-box relation package. Earlier cache
formats could include free gifts and downloaded artwork only for room or search matches. Both the
license renderer and Electron main process currently navigate immediately after
authorization. Recent-gift artwork reads the room catalog, so historical gifts
outside the current room can remain unresolved.

## Constraints

- The server catalog remains authoritative and is fetched dynamically; no
  catalog snapshot or Bilibili gift artwork is packaged.
- Local metadata membership is limited to `coinType === "gold"` and known
  `priceRaw >= 0`; positive-price active rows form the paid search/settlement
  view. ID `13000` and guard aliases remain excluded.
- Base room membership still comes from the configured room panel and
  `giftConfig`; official outputs expand only from a box ID present in that room.
- Images are joined by frozen gift identity/`variantId`; a numeric gift ID alone
  cannot select among multiple identities. Legacy history uses only the unique
  ID/name match allowed by the identity specification.
- No Bilibili cookie, device token, activation code, or password reaches the
  renderer, catalog file, image request, or log.

## Non-goals

- Restoring personal backpack gifts or the removed Markdown/static artwork
  tree.
- Changing gift event ingestion, settlement, overtime duration rules, or OBS
  contracts.
- Requiring every image download to succeed before the application can ever
  open.

## Architecture

`GET /api/public/gifts/catalog?schemaVersion=3` returns the content-versioned
gift identity and official relation package. The client validates its identities,
business digest and relations before retaining the gold mirror. `sourceUrl` is
nullable and restricted to the validated upstream image source; `imageUrl` is
always `null`. The current protocol provides no same-origin server-image fallback.

Each authorized desktop launch performs one conditional check even if the
persisted check time is recent. While the runtime remains open it checks every
12 hours; closing the runtime clears the timer. A 304 still checks local image
availability and retries missing or previously failed revisions.

The Electron-owned local runtime validates and atomically persists gifts and
relations together in `data/overtime-gift-catalog-v2.json`. A shared gift-catalog initializer refreshes that snapshot, downloads or
validates each image with bounded concurrency, and atomically writes a separate
`data/overtime-gift-assets-state-v2.json` schema-v2 completion state. It emits sanitized progress through a narrow IPC
bridge. Electron main process owns the authorization-to-Admin navigation gate;
the license renderer only presents login, progress, warning, and retry states.

The local runtime exposes two distinct views:

- `/api/overtime/gifts` remains the current-room catalog.
- `/api/overtime/gifts/catalog` and local search read the paid global mirror and
  never perform a request while handling the renderer action.

## Security

- `sourceUrl` must be HTTPS on `hdslb.com` or a subdomain, without credentials
  or a non-default port. Redirects are rejected.
- Network downloads use only the current package's validated Bilibili source.
  Failures and missing sources retain a same-identity last-good local image or
  the placeholder; neither triggers a server-only image download.
- Downloads enforce a 15-second timeout, 5 MiB limit, raster signature check,
  bounded concurrency, safe generated filenames, and atomic writes.
- Remote JSON remains size-limited and normalized to an explicit field
  allowlist before persistence.
- Initialization IPC accepts no URL, path, ID, tenant, or token from the
  renderer.

## Compatibility

- A valid completed supported catalog cache can seed initialization when refresh
  fails. Legacy metadata cannot prove schema-3 identity completeness. Existing
  local files may be retained, but the current package cannot advertise a
  server-image fallback.
- A catalog failure with no local snapshot stays on the initialization card and
  offers retry. A completed scan with individual failures enters Admin, uses
  placeholders for missing files, and retries missing assets later.
- A later catalog version does not re-block a previously initialized launch;
  it synchronizes incrementally in the background.
- Image revisions include the source URL and gift identity. Changed artwork
  requires a changed source URL; catalog version changes alone do not invalidate
  a same-identity image. Same-ID different identities never share fallback state.
- `data/overtime-gift-images/index.json` stores schema version 2 and an `images`
  object mapping `variantId` to validated last-good local basenames. It is
  written atomically after a batch; an invalid or missing index is ignored.
  Old images remain usable until replacement succeeds, including after restart.
- Local `gift-catalog:update` notifications follow the asset scan and carry
  local image paths plus `assetsUpdatedAt` (ISO string or empty). Renderer
  deduplication includes image paths and this local asset timestamp so same
  catalog-version recovery is observable.
- Subsequent downloads show a single Admin toast for start/progress/completion
  or partial failure, using existing sanitized initialization IPC. No toast
  appears for first initialization or metadata-only/unchanged checks.
  Later progress totals count only images requiring downloads, while the
  persisted completion file continues to summarize the full catalog.
  Entries without a usable source keep their placeholder/last-good image and
  do not trigger repeated download toasts until a usable URL is published.
  The sanitized IPC adds `background` and `completedAt` so a renderer that
  subscribes after a short update finishes can show its result once; restored
  disk state and first initialization never count as background results.
- Catalog JSON is data (ID/name/price/type/image URLs and official ID relations),
  never executable code. It does not replace tenant-private
  `giftBlindBoxCustomConfigV2`, saved duration rules, or historical ledger
  names/prices, and relation metadata alone never reclassifies an ordinary event.
- The legacy `/api/overtime/gifts/server/search` route may remain as a local-only
  compatibility alias, but the Admin UI must use the local search route.

## Acceptance Criteria

- Successful first authorization clears secret inputs, replaces the login form
  with a centered progress card, reports catalog and image progress, and enters
  Admin only after the first complete asset scan.
- An already initialized authorized launch enters Admin immediately and starts
  a non-blocking conditional refresh.
- The open runtime checks every 12 hours; unchanged checks perform no image
  downloads and no user notification. Changed/missing images update visible
  artwork without restarting Admin, with incremental progress and old-image
  fallback on failure. Bilibili outages do not cause bulk server downloads.
- The persisted package contains validated gold identities including known
  zero-price rows and inactive relation references, and preserves ID, name,
  price, category, identity, source URL, and official relations atomically.
- Schema-3 records with non-null `imageUrl` are rejected; missing/unavailable
  Bilibili sources do not cause same-origin image downloads. Image index schema 2
  keeps same-ID different identities separate across restart and refresh.
- All valid cached images are served from `data/overtime-gift-images/`; an
  interrupted run reuses them rather than downloading them again.
- Global picker search performs no remote fetch. Recent gifts above the existing
  high-value threshold, blind-box bodies/outputs, and saved rules resolve images
  from the global local mirror by exact ID.
- Same-name different-ID entries both remain searchable and resolve their own
  local image mapping.
- A CLI script runs the same catalog/image initializer and reports progress.
- Source and packaged artifacts contain no removed static gift image tree,
  manifest, or mapping Markdown.

## Done When

The server wire contract and tests, client initializer/cache tests, Electron
navigation/IPC tests, overtime frontend tests, focused static checks, final diff
review, and fresh Windows package inspection all pass.
