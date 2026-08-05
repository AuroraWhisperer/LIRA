# Feature: Danmaku Song Request Autocomplete

## Requirements

- When a normal danmaku song request exactly matches an enabled library song, the system shall preserve the existing exact-match behavior.
- When the requested text is contained in exactly one enabled library song name, the system shall enqueue that song using its complete library name.
- When no enabled song or multiple enabled songs contain the requested text, the system shall preserve the existing unmatched-request behavior.
- The original danmaku message shall remain unchanged in request history.

## Architecture

- Frontend: No change. Queue views already render the normalized `song_name` stored by the backend.
- Backend: `song-service` resolves exact matches first, then checks at most two literal substring matches. The Bilibili bridge applies this resolver only to normal song requests before queue insertion.
- Security: The lookup is parameterized and escapes SQL `LIKE` wildcard characters. Existing cooldown, queue limit, duplicate, and library-only checks remain authoritative.

## Implementation Plan

- [x] Add the unique enabled-song resolver.
- [x] Inject it into the Bilibili message bridge.
- [x] Add regression tests for exact, unique, ambiguous, and disabled matches.
- [x] Run static checks and the full test suite.
