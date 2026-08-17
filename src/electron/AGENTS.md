# Electron Change Rules

The root [repository constitution](../../AGENTS.md) applies. These rules
specialize it for `src/electron/`.

- Never expose cookies, tokens, API keys, arbitrary file access, or unrestricted
  privileged operations to a renderer.
- Preserve context isolation, `safeStorage`, session partitions, and exact
  `local-media://` origin checks.
- Treat IPC channel names and argument, result, and public error shapes as public
  contracts.
- The creator of a window, listener, timer, protocol handler, or shutdown hook
  owns idempotent cleanup.
- Preserve login restoration and playback-flush ordering unless an accepted
  specification and plan explicitly change them.
- Keep renderer bridges narrow and validate inputs in the privileged process.
- Verify lifecycle and security changes with focused Electron tests before the
  full gate.
