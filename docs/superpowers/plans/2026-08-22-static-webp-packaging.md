# Static WebP Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep PNG assets in the source tree while shipping lossless WebP equivalents in the Windows installer, reducing packaged asset size without changing rendered pixels.

**Architecture:** Generate WebP siblings for static PNG assets only. Update renderer references to use the WebP siblings, while electron-builder excludes only those converted PNGs from the packaged app and retains the unconverted Bilibili gift PNG. Animated WebP gift assets and build-time icon PNGs remain unchanged.

**Tech Stack:** Electron 43, electron-builder 26, Vanilla HTML/CSS/ES modules, `cwebp -lossless`, Node test/check scripts.

## Global Constraints

- Preserve the existing Electron desktop experience and OBS overlay URLs.
- Keep source PNG files in the repository for editing and fallback purposes.
- Do not delete or rewrite unrelated user changes in the dirty worktree.
- Do not alter animated gift WebP files, audio assets, persisted paths, or public API contracts.
- Verify packaged paths, decoded image dimensions/alpha, JavaScript syntax, and focused frontend tests before delivery.

---

### Task 1: Generate lossless WebP siblings

**Files:**

- Create: `public/img/**/*.webp` for every static PNG under `public/img/`, excluding `public/img/bilibili-gifts/31140.png`.
- Preserve: Existing `public/img/**/*.png` files.

**Interfaces:**

- Consumes: Existing static PNG assets.
- Produces: Same-path WebP siblings with identical dimensions and pixel data.

- [ ] **Step 1: Convert only non-gift static PNGs**

  Run `cwebp -lossless` for each PNG outside `public/img/bilibili-gifts/`, writing the sibling `.webp` path. Do not overwrite the PNG source.

- [ ] **Step 2: Verify conversion output**

  Decode each generated WebP and compare dimensions, alpha presence, and all visible RGBA pixels against the source PNG. Differences are allowed only in RGB values of fully transparent pixels, which cannot be rendered.

### Task 2: Switch renderer references and package filters

**Files:**

- Modify: `public/pages/`, `public/js/`, and `public/css/` references to converted static PNGs.
- Modify: `package.json:48-52` electron-builder `files` patterns.

**Interfaces:**

- Consumes: WebP siblings from Task 1.
- Produces: Renderer URLs ending in `.webp`; packaged app excludes only converted static PNGs.

- [ ] **Step 1: Update local static asset references**

  Change only local static asset URLs in HTML, CSS, and JavaScript from `.png` to `.webp`. Leave remote Bilibili URLs, `public/img/bilibili-gifts/31140.png`, and `src/electron/main.js` build icon references unchanged.

- [ ] **Step 2: Add explicit electron-builder exclusions**

  Add exclusion patterns for the converted static PNG groups (`admin/queue/*`, `admin/gifts/bilibili-guard-*`, `admin/gifts/gift-section-icon`, `shared/live-refresh-icon`, `admin/nav-icons/*`, opening avatar, song-board frames/entries, `playback/player-turntable-chassis`, `playback/qqmusic-icon`, and usage-guide screenshots). Keep `public/img/bilibili-gifts/**/*.png` included.

- [ ] **Step 3: Verify source/package path parity**

  Check every changed `.webp` URL resolves to a file and every excluded PNG has a WebP sibling. Check that the gift mapping's `31140.png` remains present.

### Task 3: Build and regression verification

**Files:**

- Modify: None beyond Tasks 1–2.
- Verify: `release/win-unpacked/resources/app.asar` and the generated installer.

**Interfaces:**

- Consumes: Updated assets and packaging patterns.
- Produces: A verified Windows package with no missing static images.

- [ ] **Step 1: Run focused checks**

  Run `npm run check`, the relevant frontend overlay/admin tests, and a repository scan for stale local `.png` references.

- [ ] **Step 2: Build the local Windows package**

  Run `npm run dist:win:local` and inspect the resulting `app.asar` contents.

- [ ] **Step 3: Confirm size and runtime assets**

  Confirm converted PNGs are absent from `app.asar`, WebP siblings are present, `31140.png` remains present, and the installer is smaller than the previous 3.6.18 artifact.

- [ ] **Step 4: Review the final diff**

  Run `git diff --check` and `git status --short`; ensure unrelated pre-existing changes remain untouched and no generated release output is staged.
