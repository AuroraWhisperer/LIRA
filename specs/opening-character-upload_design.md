# Opening Character Upload Design

## Goal

Make the opening overlay's right-side character image configurable from the
existing Admin opening-animation editor, while fixing the heart track so its
first visible cycle starts moving immediately instead of spending a cycle out
of sync with its visibility animation.

## Scope and acceptance criteria

- The heart motion and visibility share one SVG timeline, are reset when the
  enabled scene starts, and move from the first cycle without the old endpoint
  holds.
- Admin accepts one PNG, JPEG, or WebP character image up to 16 MiB, shows the
  saved display name, reloads the preview after upload, and can clear the
  selected image. With no upload, the character is hidden and has no src.
- Opening music likewise has no bundled default: no selection or a missing
  selected file returns empty URL/name fields and does not start audio playback.
- Original music and character samples live in `test/fixtures/opening/` for
  manual upload tests, outside the public root and release package allowlist.
- The selected character survives reload and is returned by the public,
  read-only opening configuration used by the fixed `/opening` source.
- Unsupported, empty, oversized, or extension/signature-mismatched uploads are
  rejected without changing the selected image.

## Frontend

`public/pages/admin/toolbox/start-animation.html` adds a character media card
beside the existing opening controls. `public/js/admin/start-animation.js`
performs early extension and size checks for feedback, uploads with
`multipart/form-data`, and reloads the existing preview URL after success or
clear. `public/js/overlays/opening.js` accepts only the dedicated local
character-media prefix before assigning `img.src`; an empty or unsupported URL
hides the image and removes src. Audio uses the dedicated music-media prefix
and never loads or plays an empty source.

The heart's opacity animation moves from CSS to the same inline SVG as
`animateMotion`. The motion has no initial endpoint hold. The overlay resets the
SVG clock when an enabled scene starts so asynchronous configuration loading
cannot offset the first cycle.

## Backend and persistence

`POST /api/opening/character` stores a validated upload under the data
directory's `opening-character/` folder using a generated basename, then saves
that basename and the cleaned display name in the existing key/value settings
store. `DELETE /api/opening/character` clears those settings and leaves no
character selected. The existing music DELETE follows the same empty-state
rule. Neither operation deletes previously uploaded files. `GET
/api/opening/config` returns the selected safe URL and display state, or empty
URL/name fields with the corresponding hasUploaded flag false.

The explicit `/opening-character/<generated-name>` media route serves only the
single basename currently selected in settings. No database schema migration,
new process, dependency, or public page URL is introduced.

## Security

- State-changing API calls remain behind the server's existing local session
  token authentication and same-origin validation.
- The server enforces the 16 MiB content limit, a PNG/JPEG/WebP extension
  allowlist, matching file signatures, a generated stored filename, and
  basename-only resolution under the dedicated data directory.
- The public media route is GET/HEAD-only and serves only the current configured
  filename. SVG and other active image formats are not accepted.
- Original filenames are cleaned and rendered with `textContent`; uploaded
  bytes are never interpolated into HTML.

## Verification

- Focused opening-overlay tests cover heart timing markup, config fallback,
  upload success, signature mismatch rejection, and media-path confinement.
- Admin composition/static assertions cover the upload/reset controls and
  preview integration.
- Run the focused test file, syntax checks through the test loader, visual
  inspection of the enabled preview, `git diff --check`, and final diff/status
  review.
