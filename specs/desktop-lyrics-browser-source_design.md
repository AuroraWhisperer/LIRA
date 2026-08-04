# Feature: Desktop lyrics browser source

## Requirements

- While music is playing, when `/lyrics` is open in a browser source, the page shall show the current lyric without requiring Electron APIs.
- When no track, no lyric, or no connection is available, the page shall show a clear status instead of an empty canvas.
- While word timing is available, the current line shall show playback progress without reducing readability over video.

## Architecture

- Frontend: the playback page publishes a compact lyric state; `/lyrics` consumes it from the existing WebSocket and retains Electron IPC support.
- Backend: one authenticated playback endpoint normalizes the state, stores only the latest value in memory, and broadcasts a small `lyric-state` event.
- Security: the existing session token protects both the endpoint and WebSocket; all fields are length-limited and lyrics are inserted with HTML escaping.

## Verification

- Test state normalization and browser-source wiring.
- Test initial WebSocket snapshots include the latest lyric state.
- Run `npm run check` and the related Node test files.
