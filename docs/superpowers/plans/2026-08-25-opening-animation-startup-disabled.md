# Opening Animation Startup Disabled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the opening-animation master switch starts disabled for every new LIRA application process while preserving all other saved opening-animation settings and in-session switch behavior.

**Architecture:** Treat `openingEnabled` as a startup-reset setting at the existing server settings bootstrap boundary. After migrations and store creation, overwrite only this key with `'false'`; page reloads reuse the current in-session value, while a new application process runs bootstrap again and disables it.

**Tech Stack:** Node.js 24+, CommonJS, SQLite settings store, `node:test`.

## Global Constraints

- Change only the startup state of `openingEnabled`.
- Preserve every other opening-animation setting and existing frontend behavior.
- Do not add dependencies, schema changes, migrations, commits, or unrelated cleanup.
- Use an isolated temporary database for verification.

---

### Task 1: Reset the opening-animation master switch during settings bootstrap

**Files:**

- Modify: `src/server/settings-bootstrap.js`
- Test: `test/opening-overlay.test.js`

**Interfaces:**

- Consumes: `settingsStore.setSetting(key, value)` from `src/storage/settings-store.js`.
- Produces: `prepareSettingsBootstrap(...)` returns a settings store whose `openingEnabled` value is `'false'` at the start of every application session.

- [x] **Step 1: Add the failing startup regression test**

```js
test('opening animation starts disabled for every application session', () => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-opening-startup-'),
  );
  const databases = createDatabases({
    dataDir,
    defaultSettings: DEFAULT_SETTINGS,
  });

  try {
    const firstSession = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    ).settingsStore;
    firstSession.setSetting('openingEnabled', 'true');

    const nextSession = prepareSettingsBootstrap(
      databases.songDb,
      settingsStoreModule,
    ).settingsStore;
    assert.equal(nextSession.getSettings().openingEnabled, 'false');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: Run the focused test and confirm the new assertion fails**

Run: `node --experimental-vm-modules --test test/opening-overlay.test.js`

Expected: the new test reports `'true' !== 'false'` before the implementation.

- [x] **Step 3: Reset only `openingEnabled` at the existing bootstrap boundary**

```js
runMigrations();
settingsStore.setSetting('openingEnabled', 'false');
return { settingsStore };
```

- [x] **Step 4: Run focused and static verification**

Run: `node --experimental-vm-modules --test test/opening-overlay.test.js`

Expected: all opening-animation tests pass.

Run: `npm run check`

Expected: JavaScript checks pass.

Run: `git diff --check`

Expected: no whitespace errors.

- [x] **Step 5: Review scope**

Confirm the diff changes only `openingEnabled` startup initialization, its regression test, and this plan; preserve all pre-existing working-tree changes.
