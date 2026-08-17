# Storage Change Rules

The root [repository constitution](../../AGENTS.md) applies. These rules
specialize it for `src/storage/`.

- Evolve schema only through migrations. Never edit an established schema path
  as if existing user databases were new installations.
- Existing user databases must upgrade without data loss. Repeated startup and
  repeated migration execution must be idempotent.
- Stores own transaction boundaries and return stable domain-facing shapes. Do
  not leak `DatabaseSync`, statements, or SQLite-specific result objects.
- A schema change updates migration code, affected stores, regression tests, and
  the [storage owner document](../../docs/architecture/backend/storage.md).
- Preserve retention, data-directory, and database ownership contracts unless an
  accepted specification and plan explicitly change them.
- Tests use isolated temporary directories and databases. Never read, mutate, or
  migrate real user data.
