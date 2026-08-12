# Streamer Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the empty “每日待做” toolbox panel into a beginner-friendly local planner for a streamer’s today, this week, and this month work, including song-learning progress.

**Architecture:** Keep the feature inside the existing toolbox tab shell. Add static semantic markup to `admin.html`, feature-scoped styles to `other-features.css`, and one independent browser module that owns task state, rendering, event delegation, and `localStorage` persistence; no server route or database migration is needed.

**Tech Stack:** Existing HTML/CSS design system, vanilla browser JavaScript, `localStorage`, Node.js `node:test` and `vm`.

## Global Constraints

- Use the existing two-space JavaScript indentation, semicolons, single quotes, and CommonJS test style.
- Add no dependencies and no account/cloud synchronization.
- Store planner data only in the current browser/Electron profile under one versioned `localStorage` key.
- Keep the UI understandable without project-management terminology: “今天 / 本周 / 本月”, plain category names, and explicit progress wording.
- Preserve all existing toolbox navigation and feature panels.
- Support keyboard focus, semantic labels, narrow layouts, and reduced-motion preferences.

---

### Task 1: Planner shell and focused regression coverage

**Files:**
- Modify: `public/pages/admin.html:1331`
- Modify: `public/pages/admin.html:1738`
- Test: `test/toolbox-todo.test.js`

**Interfaces:**
- Consumes: existing `data-other-feature="otherDailyTodoFeature"` tab-to-panel mapping from `public/js/admin/other.js`.
- Produces: DOM IDs `streamerPlanner`, `plannerTaskForm`, `plannerTaskTitle`, `plannerTaskPeriod`, `plannerTaskCategory`, `plannerSummary`, `plannerTodayList`, `plannerWeekList`, and `plannerMonthList` for the feature module.

- [ ] **Step 1: Write the failing markup test**

```js
test('streamer planner provides beginner-friendly periods and task controls', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'admin.html'), 'utf8');

  assert.match(html, /<strong>主播计划<\/strong>\s*<small>安排今天、本周与本月<\/small>/);
  assert.match(html, /id="plannerTaskForm"[\s\S]*id="plannerTaskTitle"[\s\S]*id="plannerTaskPeriod"[\s\S]*id="plannerTaskCategory"/);
  assert.match(html, /id="plannerTodayList"[\s\S]*id="plannerWeekList"[\s\S]*id="plannerMonthList"/);
  assert.match(html, /开播准备[\s\S]*内容发布[\s\S]*直播复盘/);
});
```

- [ ] **Step 2: Run the test and verify the empty panel fails it**

Run: `node --test test/toolbox-todo.test.js`

Expected: FAIL because the renamed copy, form controls, and three lists do not exist.

- [ ] **Step 3: Add the semantic planner markup**

Replace the empty `otherDailyTodoFeature` section with a `.streamer-planner` body containing:

```html
<form id="plannerTaskForm" class="planner-quick-add">
  <input id="plannerTaskTitle" maxlength="80" required>
  <select id="plannerTaskPeriod"><option value="today">今天</option></select>
  <select id="plannerTaskCategory"><option value="song">学歌</option></select>
  <button class="primary" type="submit">添加安排</button>
</form>
<div class="planner-timeline">
  <section data-planner-period="today"><div id="plannerTodayList"></div></section>
  <section data-planner-period="week"><div id="plannerWeekList"></div></section>
  <section data-planner-period="month"><div id="plannerMonthList"></div></section>
</div>
```

Include full options for `today`, `week`, `month` and `song`, `prep`, `content`, `review`, plus a visible local-storage note and task-template buttons.

- [ ] **Step 4: Run the markup test**

Run: `node --test test/toolbox-todo.test.js`

Expected: PASS for the markup test.

### Task 2: Local task behavior and persistence

**Files:**
- Create: `public/js/admin/todo.js`
- Modify: `public/js/admin/index.js:20`
- Modify: `public/js/admin/app.js:47`
- Test: `test/toolbox-todo.test.js`

**Interfaces:**
- Consumes: the DOM IDs from Task 1 and `window.localStorage`.
- Produces: `window.AdminApp.todo.init()`, `addTask(input)`, `updateTask(id, patch)`, `removeTask(id)`, and `getTasks()`.
- Task object: `{ id: string, title: string, period: 'today'|'week'|'month', category: 'song'|'prep'|'content'|'review', progress: 0|25|50|75|100 }`.

- [ ] **Step 1: Write the failing persistence test**

```js
test('streamer planner adds, updates, and removes locally persisted tasks', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'todo.js'), 'utf8');
  const stored = new Map();
  const sandbox = createTodoSandbox(stored);
  vm.runInNewContext(source, sandbox);

  const task = sandbox.window.AdminApp.todo.addTask({ title: '学《晴天》', period: 'week', category: 'song' });
  sandbox.window.AdminApp.todo.updateTask(task.id, { progress: 75 });
  assert.equal(sandbox.window.AdminApp.todo.getTasks()[0].progress, 75);
  assert.match(stored.get('admin.streamerPlanner.v1'), /学《晴天》/);

  sandbox.window.AdminApp.todo.removeTask(task.id);
  assert.equal(sandbox.window.AdminApp.todo.getTasks().length, 0);
});
```

- [ ] **Step 2: Run the persistence test and verify it fails**

Run: `node --test test/toolbox-todo.test.js`

Expected: FAIL because `public/js/admin/todo.js` does not exist.

- [ ] **Step 3: Implement the smallest local task store and renderer**

In `todo.js`, define constants for the storage key, valid periods/categories/progress values, category labels, normal progress labels, and song-specific progress labels. Sanitize loaded records, persist after every mutation, render each period with escaped text via `textContent`, and use event delegation for progress changes and deletes. Seed a concise beginner checklist only when the storage key has never existed; a stored empty array stays empty.

- [ ] **Step 4: Wire module loading and initialization**

Add:

```js
import './todo.js';
```

to `public/js/admin/index.js`, and call:

```js
if (window.AdminApp.todo) window.AdminApp.todo.init();
```

before the toolbox shell initializes in `public/js/admin/app.js`.

- [ ] **Step 5: Run focused JavaScript tests**

Run: `node --test test/toolbox-todo.test.js test/toolbox-sidebar.test.js`

Expected: PASS.

### Task 3: Timeline visual system and responsive behavior

**Files:**
- Modify: `public/css/admin/other-features.css`
- Test: `test/toolbox-todo.test.js`

**Interfaces:**
- Consumes: `.streamer-planner`, `.planner-quick-add`, `.planner-timeline`, `.planner-period-card`, and `.planner-task-card` markup/classes rendered by Tasks 1 and 2.
- Produces: a three-column desktop rundown that becomes one column below 1100px, with visible focus states and no motion under `prefers-reduced-motion`.

- [ ] **Step 1: Extend the failing style test**

```js
assert.match(styles, /\.planner-timeline\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.planner-timeline\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(styles, /\.planner-task-progress\s*select:focus-visible/);
```

- [ ] **Step 2: Run the test and verify the style assertions fail**

Run: `node --test test/toolbox-todo.test.js`

Expected: FAIL because planner styles do not exist.

- [ ] **Step 3: Implement the focused visual direction**

Use the current white/shell surfaces, coral primary, teal completion color, dark ink, and amber monthly accent. Use the project CJK font for body copy and `Segoe UI` for date/count utilities. Make the signature element a single horizontal broadcast-rundown line connecting the Today, Week, and Month headers; keep the rest quiet, with compact task cards, 10–14px radii, and one subtle completion transition.

- [ ] **Step 4: Add narrow and reduced-motion rules**

At `max-width: 1100px`, stack the time periods; at `max-width: 600px`, stack the quick-add controls and template buttons. Disable card/progress transitions under `prefers-reduced-motion: reduce`.

- [ ] **Step 5: Run focused and repository validation**

Run: `node --test test/toolbox-todo.test.js test/toolbox-sidebar.test.js`

Expected: PASS.

Run: `npm run check`

Expected: all JavaScript syntax checks pass.

Run: `npm test`

Expected: the full serial Node test suite passes.

## Self-Review

- Spec coverage: left label/help text, today/week/month periods, song-learning progress, additional streamer categories, local persistence, empty/delete behavior, accessibility, and responsive layout are each assigned above.
- Placeholder scan: the plan contains no deferred implementation or unspecified validation step.
- Type consistency: all tasks use the same `period`, `category`, `progress`, DOM ID, storage key, and public method names.
