# Contextual Dropdown Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the OS-owned option popup for project selects with keyboard-accessible, context-aware option panels while preserving native select values and change events.

**Architecture:** A shared renderer enhances native selects in place and keeps the original select as the form/data contract. The renderer owns trigger, listbox, focus, and synchronization behavior; each select declares a semantic `data-dropdown-variant` so CSS can express page-specific surfaces without coupling the shared module to business modules.

**Tech Stack:** Vanilla JavaScript ES modules, native HTML select as the data contract, CSS custom properties, `node:test`.

## Global Constraints

- Preserve existing select IDs, values, options, form submission, and `change` listeners.
- Do not use a UI framework, positioning dependency, or business import in shared dropdown code.
- Keep `normal`, `filter`, `settings`, `toolbox`, `overtime`, and `onboarding` visual variants restrained and distinct.
- Support keyboard navigation, focus-visible, Escape/Tab close, disabled options, reduced motion, and long option lists.

### Task 1: Shared Select Renderer

**Files:**

- Create: `public/js/shared/select-menu.js`
- Create: `public/css/components/select-menu.css`
- Modify: `public/js/admin/app.js`
- Modify: `public/css/styles-admin.css`
- Modify: `public/js/admin/onboarding.js`

**Interfaces:**

- Produces `enhanceSelects(root)` and `refreshEnhancedSelect(select)`.
- Consumes only native DOM select/option APIs and `data-dropdown-variant` attributes.

- [x] Add the shared enhancement module and style import.
- [x] Keep the native select in the DOM with `tabindex=-1`, synchronize programmatic values and option mutations, and dispatch the original `change` event after a user chooses an option.
- [x] Implement listbox keyboard behavior: Arrow keys, Home/End, Enter/Space, Escape, Tab, outside click, disabled options, and focus restoration.
- [x] Add CSS for trigger/panel/option states and context variants without relying on OS native popup styling.
- [x] Initialize from the admin application entry and expose a safe refresh hook for dynamically populated selects.

### Task 2: Context Markup And Dynamic Synchronization

**Files:**

- Modify: native select fragments under `public/pages/admin/`
- Modify: `public/js/admin/games.js`
- Modify: `public/js/admin/todo.js`

**Interfaces:**

- Each select declares `data-dropdown-variant` or inherits a variant from its nearest semantic container.
- Dynamic option rendering remains unchanged except for an explicit `refreshEnhancedSelect(select)` call where options are replaced.

- [x] Mark song/library filters, song settings, desktop lyric, toolbox, game, overtime, and onboarding selects with semantic variants.
- [x] Refresh enhanced panels after dynamic option replacement and preserve current values through observation of the retained native select.
- [x] Keep the onboarding focus trap on the visible custom trigger rather than its hidden native select.

### Task 3: Regression Tests And Runtime Checks

**Files:**

- Modify: `test/ui-surface.test.js`

- [x] Assert the shared select contract, listbox roles, keyboard markers, variant hooks, and native value preservation.
- [x] Run `node --test test/ui-surface.test.js`, `npm.cmd run check`, `npm.cmd run verify:quick`, and `npm.cmd test`.
- [x] Inspect the workspace admin page at desktop dimensions: open `overlayShowIndex` and verify the styled options panel, keyboard focus, selected state, and Escape restore.
- [x] Review `git diff --check` and preserve unrelated user changes.
