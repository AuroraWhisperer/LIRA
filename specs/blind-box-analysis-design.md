# Feature: Blind Box Analysis Workspace

## Requirements

- While an operator is watching the gift page, when blind-box data arrives, the system shall show one row per viewer, ordered by viewer profit from high to low.
- While an operator opens blind-box details, the system shall replace the area below the desktop top bar, including the player area, with a focused analysis workspace.
- While the analysis workspace is open, when the operator chooses a viewer, a blind-box type, or a view, the system shall show matching totals and results using plain Chinese labels.
- While the analysis workspace is open, when the operator clicks the close icon or presses Escape, the system shall return to the gift page without stopping audio playback.
- While record results exceed one page, the system shall paginate without silently truncating the data.

## Architecture

### Frontend

- `public/js/admin/gifts/blindbox.js` remains responsible only for the compact gift-page summary and opening the workspace.
- `public/js/admin/gifts/blindbox-analysis.js` owns analysis state, fetching, rendering, filtering, pagination, focus management, and cleanup.
- `public/css/admin/blindbox-analysis.css` owns the full analysis workspace visual system and responsive behavior.
- The workspace is an in-page secondary workspace, not a browser window, modal, or side drawer. It is fixed below the 58px top bar and above the player while the top bar remains usable.
- Default view is “按观众”; advanced views are visible but do not require configuration before use.

### Backend

- `GET /api/gifts/blind-box-stats` continues serving the compact summary and per-viewer aggregation.
- `GET /api/gifts/blind-box-analysis` accepts `viewer`, `box`, `view`, `page`, `limit`, `sort`, and `direction`.
- The service returns filtered summary, viewer and box options, the requested result rows, and pagination metadata.
- All grouping and pagination are performed server-side so totals and displayed records share the same filter definition.
- `num` is the number of boxes. `blind_box_price`, `total_price`, and `blind_profit` are totals for the complete stored event and must not be multiplied by `num` again.
- Viewer filters use a stable `viewerKey` (`uid:<uid>` when available, otherwise `name:<name>`); the displayed viewer name is never used as an implicit UID.

### Security

- The application is a local admin service and existing gift endpoints have no separate authentication boundary; the new read-only endpoint follows that boundary.
- Query values are bounded and allow-listed. Viewer and box filters are bound parameters, never interpolated into SQL.
- API responses expose only gift statistics already available to the admin UI.
- Viewer and gift names are encoded before insertion into HTML.

## Decisions

### Use a secondary workspace instead of a modal or route

The workspace preserves the desktop top bar and current admin state while giving the table enough room. It uses region semantics because the top bar remains interactive. It closes back to the exact page state and does not add browser navigation concepts for novice users.

### Use one filter model across three views

Viewer and blind-box filters apply to “按观众”, “按盲盒”, and “开盒记录”. A separate overview tab is omitted because the persistent totals already provide the overview.

### Keep compact and detailed APIs separate

The compact panel refreshes frequently and must remain small. The detailed endpoint is fetched only while the workspace is open and owns pagination, which avoids coupling the main admin snapshot to analysis-only fields.

## Failure Modes

- Loading failure: keep the workspace open and show a retry action in the results area.
- Empty filter result: show a plain empty-state message and retain filters so the operator can change them.
- Incoming gift while open: the normal snapshot refresh triggers a lightweight reload of the active analysis view.
- Competing overlays: opening analysis closes gift/playback drawers, the queue popup, and player fullscreen before showing the workspace.

## Verification

- Unit tests cover filtered aggregation, sort allow-lists, record pagination, and event quantities.
- Frontend regression tests cover required markup, separate module/style loading, accessible dialog semantics, and the compact per-viewer table.
- `npm run check` and `npm test` pass.
- Desktop screenshots are checked at 1440x900 and 1024x768 with non-empty data.
