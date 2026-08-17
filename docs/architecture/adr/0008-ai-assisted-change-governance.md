# ADR-0008: Govern AI-Assisted Changes With Layered Repository Rules

## Status

Accepted

## Context

LIRA has detailed architecture documents and selected module-boundary tests, but
AI-assisted changes previously lacked a concise authority hierarchy, task routing,
specification lifecycle, scoped safety rules, and deterministic checks for the
governance documents themselves. Putting volatile contract inventories into a
single instruction file would create a competing source of truth and drift
quickly. Rewriting legacy Admin or storage code in one pass would also create an
unacceptable regression surface.

## Decision

Adopt layered repository governance:

- The root `AGENTS.md` defines project-wide authority, priorities, compatibility,
  scope, workflow, and verification.
- Scoped `AGENTS.md` files specialize storage, Electron, and Admin rules without
  weakening root safety guarantees.
- `docs/architecture/README.md` remains the architecture fact map, while
  `docs/architecture/engineering/ai-workflow.md` routes tasks to owners,
  contracts, consumers, and tests.
- `PLANS.md` defines risk-based planning and `specs/README.md` records
  evidence-backed specification lifecycle status.
- Deterministic `node:test` checks validate marked tables, paths, required files,
  and legacy text-debt budgets.
- Legacy migrations remain incremental. Numeric baselines live only in their
  enforcing tests; prose documents describe direction and enforcement status.

## Consequences

### Positive

- Contributors can locate the correct owner and verification path before editing.
- Authority conflicts and contract changes are handled explicitly.
- Governance documents and selected legacy boundaries fail deterministically when
  they drift or expand.
- Scoped instructions stay concise and close to high-risk code.

### Negative

- Governance tables and specification statuses require maintenance when files or
  accepted behavior change.
- Raw-text debt budgets can include comments or embedded source and may produce
  false positives that require explicit review.
- The full test gate intentionally repeats focused governance checks after the
  quick gate.

### Neutral

- Runtime behavior, processes, ports, dependencies, packaging, public contracts,
  and persisted data do not change.
- Release pipeline hardening remains a separate planning concern.

## Alternatives Considered

**A giant root `AGENTS.md` containing volatile contract details**

- Rejected because it would duplicate the architecture fact map and drift with
  endpoints, IPC channels, storage facts, and runtime inventories.

**Permanent role-agent persona documents**

- Rejected because ownership belongs to repository paths and contracts, not
  persistent personas or a new process framework.

**Documentation-only governance without deterministic gates**

- Rejected because path, index, and legacy-boundary drift would remain invisible
  until manual review.

**A big-bang Admin or storage rewrite**

- Rejected because the regression surface is too large and existing behavior can
  be protected while debt decreases incrementally.

**A duplicate contract registry that competes with the architecture fact map**

- Rejected because each volatile fact family must have one owner. Routing should
  link to owner documents, not copy their inventories.

## References

- `../../../AGENTS.md`
- `../../../PLANS.md`
- `../README.md`
- `../engineering/ai-workflow.md`
- `../engineering/legacy-boundaries.md`
- `../engineering/modularity-standard.md`
- `../../../specs/README.md`
- `0007-explicit-module-boundaries.md`
