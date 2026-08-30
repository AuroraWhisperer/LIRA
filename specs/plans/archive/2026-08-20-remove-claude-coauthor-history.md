# Remove Claude Co-author History Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in an isolated mirror clone. Do not rewrite history in the dirty primary worktree.

**Goal:** Remove Claude `Co-Authored-By` trailers from the five affected published commits and prevent Claude Code from adding them to future release commits.

**Architecture:** Configure Claude Code attribution locally and document the exact release-time check. Rewrite only `origin/main` and the annotated release tags whose targets descend from `v3.5.11`, using a separate mirror clone so current workspace changes remain untouched.

**Tech Stack:** Git, GitHub CLI, Claude Code JSON settings, PowerShell.

## Global Constraints

- Preserve every commit tree, author identity, author date, committer identity, and commit subject.
- Remove only the matching Claude co-author trailer from commit messages.
- Preserve GitHub releases and their uploaded assets.
- Do not touch current uncommitted workspace changes.
- Do not force-push until the rewritten graph and all affected tags pass verification.

---

## Goal

Remove `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` from the five commits tagged `v3.5.11` through `v3.5.15`, then prevent recurrence during future releases.

## Non-goals

- Do not remove legitimate human co-author trailers.
- Do not alter product references to the Claude model provider.
- Do not modify release assets or delete GitHub releases.
- Do not rewrite commits before `a6feeeea8aff4c9d3fcb3961d9daf53f1e05349a` (`v3.5.10`).

## Current Behavior

`origin/main` contains five commits with a Claude co-author trailer: `f066e04c`, `6e9b7193`, `59c18111`, `61db69ff`, and `311dc5e5`. Thirteen annotated tags from `v3.5.11` through `v3.6.4` point at those commits or descendants, so all thirteen tag objects and all thirteen descendant commits will receive new object IDs after the message rewrite. `RELEASE_GUIDE.md` currently contains only a prose warning, while Claude Code defaults to adding attribution.

## Ownership

- Remote history: `origin/main` and annotated tags `v3.5.11` through `v3.6.4`.
- Release workflow instructions: `RELEASE_GUIDE.md`.
- Local Claude Code behavior: `.claude/settings.json`, ignored by this repository.
- GitHub releases: `AuroraWhisperer/LIRA`, tags `v3.5.11` through `v3.6.4`.

## Compatibility Constraints

- The repository currently has no branch protection or active rulesets on `main`.
- Existing GitHub release names and uploaded assets must remain present.
- Annotated tag messages and tagger metadata must remain equivalent except for rewritten target object IDs.
- Collaborators with an old clone must rebase or reset onto the rewritten `origin/main` after the force-push.

## Proposed Changes

- Modify `RELEASE_GUIDE.md` to document Claude Code's supported `attribution.commit` setting and add a pre-push commit-message check.
- Modify ignored local `.claude/settings.json` to set both commit and PR attribution to empty strings.
- Rewrite the remote graph in an isolated mirror clone with `git filter-repo`, matching only the Claude co-author trailer.
- Force-update `main` and affected annotated tags with lease protection after verification.

## Milestones

### Milestone 1: Prevent Future Attribution

- [x] Add `"attribution": { "commit": "", "pr": "" }` to `.claude/settings.json`.
- [x] Replace the prose-only warning in `RELEASE_GUIDE.md` with the exact setting and this PowerShell release check:

```powershell
if (git log -1 --format=%B | Select-String -Quiet -Pattern '(?i)^Co-Authored-By:.*Claude') {
  throw 'Latest commit contains a Claude Co-Authored-By trailer.'
}
```

- [x] Parse `.claude/settings.json` with `Get-Content -Raw .claude/settings.json | ConvertFrom-Json` and confirm both attribution values are empty strings.

### Milestone 2: Create and Verify an Isolated Rewrite

- [x] Create a backup mirror at `D:\Work\Live\tmp\lira-history-backup.git`, then clone it to `D:\Work\Live\tmp\lira-history-rewrite.git`; the backup mirror retains the original branch and tag object IDs.
- [x] Run the following scoped rewrite in the rewrite mirror:

```powershell
git filter-repo --force --refs refs/heads/main refs/tags/v3.5.11 refs/tags/v3.5.12 refs/tags/v3.5.13 refs/tags/v3.5.14 refs/tags/v3.5.15 refs/tags/v3.5.16 refs/tags/v3.5.17 refs/tags/v3.5.18 refs/tags/v3.6.0 refs/tags/v3.6.1 refs/tags/v3.6.2 refs/tags/v3.6.3 refs/tags/v3.6.4 --message-callback "return re.sub(br'(?im)^Co-Authored-By: Claude[^\r\n]*(?:\r?\n)?', b'', message)"
```

- [x] Verify `git log main --regexp-ignore-case --grep=claude` returns no commit whose body contains a Claude co-author trailer.
- [x] Compare raw old and new commit objects using `filter-repo/commit-map`; verification confirmed 13 rewritten commits with only parent-ID substitutions and exactly 5 removed trailers.
- [x] Verify the five affected messages lost only the trailer, the remaining messages are byte-equivalent, and all thirteen tags remain annotated with the same tagger name, email, date, and subject.

### Milestone 3: Update Remote History

- [x] Re-fetch the remote state and confirm `main` still equals `ced2241bcee7485fdb43cef03bc6ca581bc96708` before pushing.
- [x] Atomically push rewritten `main` with an explicit lease against `ced2241bcee7485fdb43cef03bc6ca581bc96708`.
- [x] Atomically push each rewritten affected tag with an explicit lease against its recorded old tag object ID.
- [x] Fetch from the primary worktree and verify the remote contains zero Claude co-author trailers.
- [x] Verify releases `v3.5.11` through `v3.6.4` still exist and each retains its three uploaded assets.

## Verification

```powershell
git log origin/main --date=iso-strict --format='%H%n%B' --regexp-ignore-case --grep='Co-Authored-By:.*Claude'
git fsck --full
git diff --check
git status --short
gh release list --repo AuroraWhisperer/LIRA --limit 30
```

Expected: no matching commit output, `git fsck` reports no errors, documentation diff is clean, the user's pre-existing workspace changes remain present, and all affected releases remain listed.

## Rollback Or Failure Handling

Before any push, retain the original object IDs and create a Git bundle containing the original `main` and affected tags. If branch push succeeds but a later tag update fails, stop and use the recorded refs to restore only the partially updated remote refs with explicit leases. Do not use `git reset --hard`, blanket checkout, or broad deletion in the primary worktree.

## Done When

- `origin/main` contains no Claude co-author trailer.
- `v3.5.11` through `v3.6.4` point into the rewritten graph and remain annotated.
- GitHub releases and assets remain accessible.
- Claude Code commit and PR attribution are disabled locally and documented in `RELEASE_GUIDE.md`.
- The primary worktree's existing changes are untouched.
