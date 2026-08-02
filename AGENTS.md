# Repository Guidelines

## Project Structure & Module Organization

Runtime code lives in `src/`: `server.js` starts the local service, `server/` contains HTTP and WebSocket routes, `electron/` owns desktop integration, and `bilibili/`, `music/`, and `storage/` contain domain logic. Browser pages, styles, scripts, and images are under `public/`. Tests are flat `test/*.test.js` files. Build helpers live in `scripts/`, installer resources in `build/`, design notes in `specs/`, and implementation documentation in `doc/`. Treat `data/`, `logs/`, `tmp/`, and `release/` as generated local output.

## Build, Test, and Development Commands

- `npm ci` installs the locked dependency set; use Node.js 24 or newer.
- `npm start` runs the local HTTP service from `src/server.js`.
- `npm run desktop` launches the Electron application.
- `npm run check` syntax-checks JavaScript in `src/`, `public/`, `scripts/`, and `test/`.
- `npm test` runs the full serial `node:test` suite with VM module support.
- `npm run dist:win:local` builds the Windows NSIS installer using the installed Electron runtime.

Run `npm run check && npm test` before submitting changes.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: two-space indentation, semicolons, single quotes, and `'use strict'` in CommonJS files. Use `camelCase` for functions and variables, `PascalCase` for classes, and `UPPER_SNAKE_CASE` for module constants. File names use lowercase kebab case, such as `message-deduplicator.js`. Keep modules focused and prefer existing Node APIs over new dependencies. There is no configured formatter or linter; `npm run check` is the required static validation.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name new files `<feature>.test.js` and write behavior-focused test descriptions. Add regression coverage for bug fixes, especially around API routes, WebSocket transport, playback state, provider integrations, and storage migrations. Tests must isolate temporary files and restore modified globals. No numeric coverage threshold is enforced.

## Commit & Pull Request Guidelines

Recent history uses release subjects such as `v2.0.0` and `v1.7.0: concise change summary`. For ordinary work, use a short imperative subject describing one logical change; reserve `vX.Y.Z` subjects for releases. Pull requests should explain the user-visible effect, list verification commands, link related issues, and include screenshots for changes under `public/`. Keep generated installers, databases, logs, cookies, session tokens, and analyzer captures out of commits.
