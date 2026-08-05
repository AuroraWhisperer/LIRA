# Feature: Bilibili Danmaku Sender

## Requirements

- The toolbox danmaku entry shall open its detail panel without leaving the toolbox.
- The panel shall show the current Bilibili login and configured room state.
- A logged-in account shall be able to send a validated message to the configured room.
- When automatic reply is enabled, the message shall mention the latest random-song requester using the captured UID and user name.

## Design

- Frontend: keep the sender in the existing toolbox panel and load one combined sender-state endpoint.
- Backend: refresh Electron cookies for every send, resolve the configured room, and call the Bilibili web danmaku endpoint.
- Security: local session-token authentication remains mandatory; validate message, UID, and name server-side; never return cookies or CSRF values.

## Architecture Decision

- Status: accepted.
- Decision: use dependency-injected local modules instead of direct cross-domain access. The requester target store owns SQL, the mention policy owns formatting, the sender service owns orchestration, routes own HTTP, and the browser module owns DOM behavior.
- Trade-off: the modules still communicate through explicit contracts; literal zero coupling is impossible for a working feature, but no module reads another module's private state.
- Automatic behavior: rejected random-song requests do not trigger an automatic reply. Sending remains a deliberate action in the toolbox.

## Verification

- Test state lookup, input validation, Bilibili request construction, and reply mention formatting.
- Run `npm run check` and the related Node test files.
