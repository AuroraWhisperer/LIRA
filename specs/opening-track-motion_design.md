# Opening Track Motion Design Specification

**Status:** Implemented

**Date:** 2026-08-23

## Goal

Allow the opening-animation waveform to use one of three intentional, mutually
exclusive motion treatments while preserving the current heart animation as the
default: `heart` (心形巡航), `barber` (灯带循环), or `progress` (流光进度).
The Admin editor must preview the selected treatment immediately and persist it
for the fixed `/opening` Browser Source URL.

## Context

The opening scene already uses a stable SVG waveform and a small heart that moves
along it. Streamers need visual variety without editing the Browser Source URL by
hand. The setting must therefore travel through the existing Admin settings flow,
the public read-only opening configuration endpoint, and the overlay renderer.

## Requirements

- When no motion setting exists, the system shall render `heart` so existing
  installations keep their current appearance.
- When the Admin user selects a track motion, the preview shall update immediately
  and `POST /api/settings` shall persist `openingTrackMotion`.
- When `/opening` loads without a `trackMotion` query parameter, it shall consume
  the sanitized `trackMotion` returned by `GET /api/opening/config`.
- When `/opening` has a valid `trackMotion` query parameter, the query value shall
  override the saved setting for that page instance.
- If a persisted, submitted, remote, or query value is outside
  `heart|barber|progress`, the setting endpoint shall reject submissions and the
  read/render paths shall fall back to `heart`.
- Each mode shall reuse the same waveform geometry, display only one foreground
  motion treatment, and respect paused, low-quality, and reduced-motion states.

## Interaction And Visual Design

The Admin editor adds one native select directly below “画质”:

```text
[画质      普通 · 推荐        ▾]
[轨道动效  心形巡航           ▾]
[漂浮音符                  ●]
[音乐律动                  ●]
```

The native select matches the established form controls and keeps the editor
compact; the live preview is the visual explanation of each choice. The scene's
existing night, pink, cream, and gold palette and its typography remain unchanged.

- `heart`: the existing gold heart follows the waveform with a gentle pulse.
- `barber`: short warm-gold dashes move continuously over a quieter pink waveform,
  evoking a looping barber-pole light without adding another bright panel.
- `progress`: one soft pink luminous segment travels around the whole waveform as
  a seamless infinite progress indicator.

The distinctive moment is the waveform itself changing character while the
composition, copy, character, and music layers remain stable.

## Architecture

### Frontend

`public/pages/admin/toolbox/start-animation.html` owns the labeled select.
`public/js/admin/start-animation.js` validates the selection, includes
`trackMotion` in preview URLs, persists `openingTrackMotion`, and hydrates the
control. `public/js/overlays/opening.js` resolves the query/config value and writes
the validated mode to `data-track-motion`. The opening HTML exposes one shared SVG
path, and CSS selects the applicable heart, dash, or progress layer.

### Backend And Storage

`DEFAULT_SETTINGS.openingTrackMotion` is `heart`. The existing settings store
inserts missing default rows with `INSERT OR IGNORE`, so this adds no schema or DDL
migration. A shared backend contract validates the enum for both
`POST /api/settings` and `GET /api/opening/config`; the latter returns `trackMotion`.
No new endpoint, process, dependency, or port is introduced.

### Security

- The existing authenticated `POST /api/settings` route remains the only write
  path; the public opening-config route stays read-only.
- Client validation provides immediate feedback behavior, while server validation
  is authoritative.
- Values are a fixed enum. User input never becomes a CSS selector, style string,
  HTML fragment, file path, or executable animation definition.
- Responses contain no credentials or new sensitive fields. The existing local
  settings rate and audit behavior is unchanged because this adds no privileged
  operation or high-volume route.

## Public Contracts

- Persisted setting: `openingTrackMotion = heart|barber|progress`.
- Public opening config response: `data.trackMotion` with the same enum.
- Overlay query parameter: `trackMotion=heart|barber|progress`.
- Invalid settings submissions return the existing `400` invalid-setting shape;
  invalid stored, remote, or query values render as `heart`.

## Non-goals

- No arbitrary colors, speeds, SVG paths, CSS, HTML, or user-authored animations.
- No changes to opening music, copy limits, character artwork, or the fixed
  Browser Source address.
- No additional motion modes or Admin card gallery in this change.

## Acceptance Criteria

- All three labels appear in Admin and selecting each visibly changes the preview.
- The fixed `/opening` source reflects the persisted selection after refresh.
- Existing installations and malformed values render the current heart treatment.
- Barber and progress movement loop without a full-width white flash or hard seam.
- Low-quality and reduced-motion modes stop the new continuous animations.
- Focused overlay/settings tests, JavaScript syntax checks, documentation checks,
  and the quick verification gate pass.
