# Gift identity and overtime rules

Status: Complete (2026-09-13; local changes, not released)

## Goal

Keep gifts that reuse a Bilibili ID separate throughout catalog selection,
artwork, event delivery, and overtime settlement. Existing settlements stay
immutable; a newly listed gift cannot inherit another gift's rule.

## Non-goals

No deployment, installation, historical recalculation, authentication redesign,
or unrelated cleanup. Preserve existing installer and catalog-refresh edits.

## Current behavior and ownership

LIRA Server owns archived schema 3 identities and freezes their IDs on events,
but delivers the legacy event projection. The desktop remote catalog consumes
schema 2. Its overtime store and editor select and deduplicate rules by gift ID,
and its artwork resolver overwrites images by ID. The owning modules are
`src/bilibili/gift`, `src/shared/processed-gift-contract.js`,
`src/electron/license/remote-license-client.js`, `src/storage`, `src/overtime`,
and `public/js/admin/overtime*`; server owners are gift detection/event/history
services and the Device protocol. Accepted catalog and ledger specs govern sync.

## Compatibility constraints

Keep the default server wire projection for installed strict clients. New clients
explicitly negotiate frozen identity fields. Preserve schema 2 cache fallback,
guard aliases, cursor transactions, history bootstrap isolation, and settlement
idempotency. Migrate rules without losing settings; unresolved legacy platform
rules require reselection because their original list price was never saved.

## Proposed changes

1. Negotiate nullable event identity fields and document/test both wire shapes.
2. Consume validated schema 3 catalogs while preserving full identities through
   room/catalog merging, media lookup, and frontend selection.
3. Append a rules/event storage migration. Bind platform rules to a full catalog
   identity, match frozen event identities, and retain pending legacy bindings.
4. Permit separate same-ID rules and reselection without resetting their effects.
5. Audit dependent artwork, blind-box, and effect lookups for ID-only substitution.

## Milestones and verification

- Protocol: server focused event/history/detector tests cover opt-in, defaults,
  frozen identity, and unresolved events.
- Catalog: desktop focused cache, hybrid catalog, image, and picker tests cover
  same ID with changed name or price, malformed snapshots, and refresh/restart.
- Settlement: desktop migration, processed event, and overtime tests cover two
  same-ID rules, legacy reselection, guard aliases, and exactly-once history.
- Final: `npm run verify:quick` and focused/full `npm test` as warranted in Live;
  `npm run docs:check` and focused Node tests in lira-server. Inspect `git diff
  --check` and status in both repositories. Record exact results below.

## Failure handling

Reject invalid catalogs atomically, keep the previous snapshot, and never guess
an unresolved event identity. Tests use temporary databases. Reverse only this
task's patches if necessary; do not reset or migrate user data.

## Done when

Same-ID gifts can be selected independently and only their exact frozen identity
triggers the corresponding rule. Old rule settings survive migration with clear
reselection UI. Related media/pools do not substitute another identity. Required
contracts and checks agree, with no unrelated dirty files overwritten.

## Results

Implemented negotiated frozen event identities, validated schema 3 catalogs,
identity-specific images/pools, v10 storage migration, exact overtime rule
settlement, and reselection preserving existing effects and quantity settings.
Unknown identities do not inherit platform rules; guard aliases remain supported.

The related-path audit also found an ID-only recent-gift artwork index and
source-box styling. These now use frozen identities, with ID/name uniqueness
required for legacy artwork. Same-name repricing stays ambiguous without an
identity. A server regression exposed an old assumption that renamed gifts in
the same platform batch should collapse; grouping now checks identity evidence.
The picker truncated prices, so its options and legacy binding notice now wrap,
and reselection has an explicit heading.

Final verification:

- Live `npm test`: 1694 tests, 1693 passed, 1 skipped, 0 failed.
- Live `npm run verify:quick`: docs 5 passed, syntax checked 607 JavaScript files,
  architecture 13 passed. The later fixture-only correction passed the full suite.
- Server `npm test`: 1091 passed, 0 failed.
- Server `npm run docs:check`: 33 passed, including protocol and architecture gates.
- Both repositories: `git diff --check` passed; unrelated installer, song page,
  and management changes were preserved.
- Browser QA with actual overtime HTML/CSS/JS and an isolated temporary database:
  cancellation kept the old binding; reselection saved subtract 45 seconds and
  item quantity mode; two same-ID identities were independently saved; unknown
  candidates were disabled. At 1440×1000 and 390×844, prices and binding notices
  were readable without clipping or horizontal overflow; no page errors.

UI evidence is under `output/gift-identity-ui/`, including `results.json`,
`qa-inventory.md`, and screenshots. Catalog images in this preview are synthetic
placeholders; image isolation is verified by cache and recent-artwork tests.
The unrelated overlay preview was excluded. Preview resources were closed.
No production database was migrated, and neither application was deployed.
