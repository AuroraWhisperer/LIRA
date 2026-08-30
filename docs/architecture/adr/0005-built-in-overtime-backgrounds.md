# ADR-0005: V1 Restricts Overtime Backgrounds to Built-In Images

- Status: Accepted
- Date: 2026-08-10
- Original ID: ADR-OT-004

## Context

Allowing arbitrary local file uploads as overlay backgrounds would introduce a writable directory in installed deployments, file-type validation, path-traversal risks, and a cleanup policy. The V1 goal is to complete the core countdown and gift settlement chain with a configurable, OBS-friendly look. This ADR was extracted from the overtime machine design specification (accepted 2026-08-10) and verified implemented in the v3.3.14 codebase (`src/overtime/overtime-contract.js` `validateBackground`, `public/img/overtime-machine/`).

## Decision

V1 supports a transparent background or built-in images under `public/img/overtime-machine/`, with three fit modes: `cover` (default), `contain`, and `fill`. Server-side validation accepts only an empty string or a relative site path matching `/img/overtime-machine/...`; paths containing `..`, backslashes, protocol prefixes, or absolute URLs are rejected, and no arbitrary upload endpoint exists. When a background fails to load, the overlay falls back to transparency without hiding the foreground, and the shade overlay is drawn only when a background image is configured (so transparent mode composites cleanly into OBS).

## Consequences

### Positive

- No new security surface: no install-directory writes, no file-type validation, no local-file protocol paths, no cleanup policy.
- The core timing and gift settlement chain shipped first; the background model is a pure configuration value.

### Negative

- V1 administrators cannot upload custom backgrounds.

### Neutral

- Custom background import into a dedicated data directory (for example `data/overtime-assets/`) remains a possible separate iteration with its own design.

## Alternatives Considered

**Arbitrary local file upload in V1**

- Rejected: it adds a new security and maintenance surface without contributing to the core timing and gift chain.

**No background configuration at all**

- Rejected: the overlay needs a configurable look so it can be composited into live streams.

## References

- ../backend/overtime.md
- `src/overtime/overtime-contract.js` (`validateBackground`, `isAllowedImagePath`)
- `public/img/overtime-machine/`
