# Admin Frontend Change Rules

The root [repository constitution](../../../AGENTS.md) applies. These rules
specialize it for `public/js/admin/`.

- New code uses named ESM imports and exports.
- Do not add `window.AdminApp` dependencies outside
  `legacy-admin-bridge.js`. Existing text debt may decrease but must not expand.
- The Admin page is composed from `public/pages/admin/` fragments by
  `src/server/admin-page.js`; there is no `public/pages/admin.html`.
- Render untrusted values with `textContent`, DOM node APIs, or established
  escaping helpers. Do not interpolate untrusted HTML.
- Do not duplicate server-side validation, authorization, settlement, matching,
  or other business decisions in UI code.
- Preserve fragment order, page URLs, accessibility behavior, and the existing
  no-build ESM loading model.
