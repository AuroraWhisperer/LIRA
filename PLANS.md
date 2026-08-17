# Implementation Planning Standard

## Purpose

A specification defines what behavior is required. An implementation plan
defines how a risky change will be delivered and verified. A plan cannot change
requirements, public contracts, or accepted architecture decisions.

A complex bug may need a plan even when it does not need a new specification.
Module or file count is a useful risk signal, not a hard threshold.

## When A Plan Is Required

Write a plan before implementation when a change includes any of the following:

- An architecture-boundary or dependency-direction change.
- A public HTTP, WebSocket, IPC, page, authentication, or updater contract
  change.
- A database schema, migration, settings-key, or persisted-format change.
- An Electron security, renderer-privilege, session, lifecycle, or shutdown
  change.
- A state-owner, transaction-owner, or resource-owner change.
- A large legacy migration or removal of a compatibility boundary.
- Complex asynchronous, retry, recovery, concurrency, idempotency, or ordering
  behavior.

A small local change may still require a plan when failure risk or ambiguity is
high. A broad mechanical change may not require one when behavior and rollback
are simple and deterministic.

## Locations And Lifecycle

- Active plans live in `specs/plans/`.
- Completed or superseded plans live in `specs/plans/archive/`.
- Plans are living documents. Record material discoveries, scope changes,
  deviations, and verification results while the work proceeds.
- Mark a plan complete only after its Done When conditions and final verification
  pass.

## Required Information

Every plan must provide the following information. The headings are recommended
but are not machine-enforced. A section that genuinely does not apply may contain
`N/A` with a short reason.

### Goal

State the user-visible or engineering outcome in one concise paragraph.

### Non-goals

Name adjacent work that is intentionally excluded.

### Current Behavior

Describe the relevant runtime evidence, failure mode, and existing tests.

### Ownership

Identify the owning source, contract documents, consumers, and tests. Resolve
uncertainty through the architecture fact map and route table before editing.

### Compatibility Constraints

List public contracts, persisted data, security properties, platform constraints,
and user changes that must remain intact.

### Proposed Changes

List the minimum files and responsibilities that will change. Do not include
speculative flexibility or unrelated cleanup.

### Milestones

Split work into reviewable, independently verifiable deliverables. Each milestone
must state its focused verification.

### Verification

List exact commands and expected results, from focused tests through the full
gate. Include final diff and status review.

### Rollback Or Failure Handling

Explain how to stop safely, inspect the scoped diff, and reverse only task-owned
changes without destructive repository operations.

### Done When

Define observable completion conditions, including tests, documentation,
compatibility, and diff scope.

## Execution Rules

- Keep the plan aligned with accepted specifications and ADRs.
- Record discovered deviations instead of silently changing the intended design.
- Stop and surface conflicts when ownership or intended behavior remains unclear.
- Do not treat passing tests as automatic proof that current behavior is intended.
- Do not create commits automatically unless the user explicitly requests them.
