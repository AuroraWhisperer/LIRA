# Admin Frontend Change Rules

The root [repository constitution](../../../AGENTS.md) applies. These rules
specialize it for `public/js/admin/`.

- New code uses named ESM imports and exports.
- Do not add `window.AdminApp` dependencies or global registration. The former
  legacy bridge has been retired; composition uses explicit imports and callbacks.
- The Admin page is composed from `public/pages/admin/` fragments by
  `src/server/admin-page.js`; there is no `public/pages/admin.html`.
- Render untrusted values with `textContent`, DOM node APIs, or established
  escaping helpers. Do not interpolate untrusted HTML.
- Do not duplicate server-side validation, authorization, settlement, matching,
  or other business decisions in UI code.
- Preserve fragment order, page URLs, accessibility behavior, and the existing
  no-build ESM loading model.
