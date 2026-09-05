# Local Paid Gift Catalog Bootstrap

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
- Local v2 metadata membership is limited to `coinType === "gold"` and known
  `priceRaw >= 0`; positive-price active rows form the paid search/settlement
  view. ID `13000` and guard aliases remain excluded.
- Base room membership still comes from the configured room panel and
  `giftConfig`; official outputs expand only from a box ID present in that room.
- Images are joined by exact normalized gift ID, never by name.
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

`GET /api/public/gifts/catalog?schemaVersion=2` returns one content-versioned
package with gold `gifts`, official `blindBoxes`, and nullable `sourceUrl`. The
server reads it from the already validated catalog image source column while
retaining `imageUrl` as a compatibility fallback.

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
- The configured LIRA Server fallback retains its existing exact-origin and
  `/gift-media/images/<safe-basename>` checks.
- Network downloads use the validated Bilibili source when present; failures
  do not automatically fall back to LIRA Server. Rows without a usable source
  can still download their same-origin server-only image.
- Downloads enforce a 15-second timeout, 5 MiB limit, raster signature check,
  bounded concurrency, safe generated filenames, and atomic writes.
- Remote JSON remains size-limited and normalized to an explicit field
  allowlist before persistence.
- Initialization IPC accepts no URL, path, ID, tenant, or token from the
  renderer.

## Compatibility

- A valid completed v2 catalog cache can seed initialization even when the first
  refresh fails; a legacy cache cannot prove v2 relation completeness. Existing
  same-origin server image URLs remain downloadable.
- A catalog failure with no local snapshot stays on the initialization card and
  offers retry. A completed scan with individual failures enters Admin, uses
  placeholders for missing files, and retries missing assets later.
- A later catalog version does not re-block a previously initialized launch;
  it synchronizes incrementally in the background.
- Image identity includes the source URL and validated server image URL. To
  publish changed artwork, the server must change one of those URLs, even if
  the gift ID is unchanged. Catalog version/name/price changes alone do not
  invalidate image files. A server-only correction must have no Bilibili source.
- `data/overtime-gift-images/index.json` stores schema version 1 and an `images`
  object mapping exact gift IDs to validated last-good local basenames. It is
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
- The persisted v2 package contains validated gold metadata including known
  zero-price rows and inactive relation references, and preserves ID, name,
  price, active/box flags, image URLs, and official relations atomically.
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
