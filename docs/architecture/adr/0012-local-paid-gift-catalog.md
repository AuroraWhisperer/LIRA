# ADR-0012: Local Paid Gift Catalog After Authorization

- Status: Accepted
- Date: 2026-09-05

## Context

The overtime picker previously shipped a static Bilibili artwork tree, then
moved to downloading only room and server-search matches. That reduced the
installer but left global search and historical gift artwork dependent on a
network request at the moment of use. A bundled JSON snapshot would become
stale independently of the server catalog and would reintroduce release-owned
catalog maintenance.

## Decision

The desktop keeps a runtime-owned local mirror of the server's active paid gift
catalog. A paid gift is an item whose `coinType` is `gold` and whose `priceRaw`
is greater than zero. The server's public flat catalog adds a validated
Bilibili `sourceUrl`; the client downloads artwork from trusted `hdslb.com`
hosts and may fall back to the existing same-origin server image when a legacy
row has no source URL.

After authorization, Electron main process is the sole owner of navigation to
the Admin page. If no completed local asset scan exists, the license page shows
catalog and image progress and navigation waits for that scan. A missing
catalog is retryable and blocks first entry; individual image failures are
recorded but do not block forever. Later launches with a usable completed mirror
enter immediately and refresh changed catalog versions in the background.

Authorized launches check once, and open runtimes repeat every 12 hours. A 304
still checks local image availability. The validated source/server image URL
pair identifies an artwork revision, and an atomic last-good image index keeps
old images through replacement failures. CDN failure does not trigger server
image fallback; server-only rows remain supported. Asset-ready local events
refresh visible artwork, while subsequent actual downloads use one progress
toast. Unchanged checks remain silent. Blind-box mapping and ledger data are
not part of catalog publication.

The configured room panel and blind-box configuration remain the source of
truth for the overtime room catalog. Global search, historical high-value gift
artwork, blind-box artwork, and persisted rule artwork resolve by exact gift ID
from the local mirror. Personal backpack data remains out of scope.

## Consequences

### Positive

- Search and normal artwork lookup no longer depend on a live server request.
- Same-name gifts retain independent IDs and image resolution.
- Installers contain no stale Bilibili gift catalog or image tree.
- Interrupted first-time initialization resumes from valid files already on
  disk.

### Negative

- First authorization downloads roughly one thousand paid gift images before
  entering the application.
- The client owns a versioned runtime cache and an initialization state file.
- The public server catalog exposes validated upstream image URLs.

### Neutral

- The server remains authoritative for catalog membership and synchronization.
- Room gift membership, gift settlement, authorization credentials, and local
  session boundaries do not change.

## Alternatives Considered

**Bundle a paid-only JSON snapshot**

- Rejected because it becomes stale between releases and duplicates the server
  catalog's ownership.

**Continue downloading only search and room matches**

- Rejected because it cannot provide global local search or dependable artwork
  for historical gifts while offline.

**Proxy every image through LIRA Server**

- Retained only as a compatibility fallback because it doubles server bandwidth
  for assets already available from the validated Bilibili CDN.

## References

- `specs/local-gift-catalog-bootstrap_design.md`
- `specs/remote-gift-catalog-sync_design.md`
- `src/bilibili/gift/remote-catalog-cache.js`
- `src/bilibili/gift/remote-gift-image-cache.js`
- `src/electron/main.js`
