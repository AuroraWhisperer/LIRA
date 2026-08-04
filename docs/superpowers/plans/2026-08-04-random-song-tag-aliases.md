# Random Song Tag Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept common viewer terms while matching the unchanged standard tags stored in the song library.

**Architecture:** A pure CommonJS module owns one-way mappings from viewer aliases to library tags and exposes `matchesLibraryTag(libraryTag, viewerTerm)`. The random filter calls that interface only while reading candidates; no save, import, migration, or database-write path uses the mapping.

**Tech Stack:** Node.js 24+, CommonJS, `node:test`, `node:assert/strict`.

## Global Constraints

- Never change tags stored in the song library.
- Preserve strict AND matching for multiple random-song terms.
- Match complete tags only; do not use substrings or inferred similarity.
- Keep the alias module independent from databases, danmaku, queues, and random selection.
- Add no dependency and make no database-schema change.

---

### Task 1: One-Way Alias Module

**Files:**
- Create: `src/music/tag-aliases.js`
- Create: `test/tag-aliases.test.js`

**Interfaces:**
- Consumes: `libraryTag` and `viewerTerm` string-like values.
- Produces: `matchesLibraryTag(libraryTag, viewerTerm): boolean`.

- [ ] Test direct matches, viewer aliases, reverse-direction rejection, partial terms, and empty values.
- [ ] Implement explicit mappings whose keys are existing library tags.
- [ ] Run `node --test test/tag-aliases.test.js` and expect all tests to pass.

### Task 2: Random Filter Integration

**Files:**
- Modify: `src/music/random-song-filter.js`
- Modify: `test/random-song-filter.test.js`

**Interfaces:**
- Consumes: `matchesLibraryTag(libraryTag, viewerTerm)` from Task 1.
- Produces: unchanged `filterRandomSongCandidates(songs, scopeText)` with input-only alias handling.

- [ ] Add a regression where viewer input `情歌+周杰伦` matches a song stored with tag `抒情`.
- [ ] Add a reverse-direction regression where a nonstandard stored tag does not masquerade as the standard tag.
- [ ] Verify through `song-service` that querying an alias leaves the database value `抒情` unchanged.
- [ ] Run `node --test test/tag-aliases.test.js test/random-song-filter.test.js` and expect all tests to pass.

### Task 3: Documentation and Repository Verification

**Files:**
- Modify: `specs/random-song-multi-tag_design.md`

- [ ] Document the one-way mapping and initial viewer vocabulary.
- [ ] Run `npm run check` and expect success.
- [ ] Run `npm test`; distinguish unrelated pre-existing failures from alias regressions.
