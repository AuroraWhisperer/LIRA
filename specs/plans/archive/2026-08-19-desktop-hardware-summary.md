# Desktop Hardware Summary Implementation Plan

**Status:** Completed.

**复核日期：** 2026-09-28。按原文完成/执行及验证记录归档；原测试结果仅代表记录时点，本次未重跑历史任务。

当前依据：[所属规格或参考](../../../docs/reference/frontend/app.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-overhead hardware summary to the existing desktop
performance panel without changing the current five-second resource metrics.

**Architecture:** The existing server metrics owner will obtain immutable host
details once and cache them in memory. The renderer requests that snapshot at
initialization; only the user-triggered performance sample requests dynamic
temperatures. A hidden short-lived PowerShell process reads Windows CIM device
metadata, and `nvidia-smi` is invoked only for detected NVIDIA GPUs.

**Tech Stack:** Node.js 24 CommonJS, native `node:os` and `child_process`,
Windows PowerShell CIM, Vanilla JavaScript ES modules, native CSS, `node:test`.

## Global Constraints

- Preserve `GET /api/system/metrics` method, path, and response shape.
- Do not add a dependency, persistent monitor, driver, or scheduled poller.
- Do not return serial numbers, credentials, or user-controlled shell output.
- Support non-Windows and unavailable sensors with explicit unavailable values.
- Keep all UI output text-only and preserve the Electron-first desktop layout.

## Current Behavior And Ownership

- Owner: `src/server/system-metrics.js`; route: `src/server/routes/system-routes.js`;
  consumer: `public/js/admin/metrics.js`.
- Contracts: `docs/reference/backend/api.md`,
  `docs/reference/backend/server-core.md`, and
  `docs/reference/frontend/app.md`.
- Existing manual sampling runs `GET /api/system/metrics?windowMs=5000` and
  launches a hidden PowerShell GPU-counter read for the same five-second window.

### Task 1: Cover and implement server hardware reads

**Files:**

- Modify: `src/server/system-metrics.js`
- Modify: `src/server/api-context.js`
- Modify: `src/server/routes/system-routes.js`
- Test: `test/server/system-metrics.test.js`

- [x] Write focused tests for CPU and RAM normalization, cached static metadata,
      NVIDIA-only temperature probing, and unsupported-platform fallback.
- [x] Add `getHardwareSummary(includeTemperatures)` and narrow PowerShell
      helpers. Cache only static CPU, RAM, and GPU metadata; sanitize all command
      output and never expose module serial numbers.
- [x] Register `GET /api/system/hardware`; accept temperatures only when the
      query string is exactly `true`.
- [x] Run `node --experimental-vm-modules --test test/server/system-metrics.test.js`.

### Task 2: Render the hardware summary in the performance panel

**Files:**

- Modify: `public/pages/admin/toolbox/performance.html`
- Modify: `public/js/admin/metrics.js`
- Modify: `public/css/admin/toasts/gifts.css`
- Test: `test/admin/frontend-admin-shell.test.js`

- [x] Add a compact hardware summary below the six existing utilization cards,
      with semantic labels for model, capacity, and temperature states.
- [x] Fetch static data once at monitor initialization. During an explicit
      five-second sample, refresh hardware temperatures in parallel with the
      existing metrics request and render using `textContent`.
- [x] Add only the CSS needed for readable desktop summary rows; no animation or
      responsive redesign.
- [x] Run `node --experimental-vm-modules --test test/admin/frontend-admin-shell.test.js`.

### Task 3: Document and verify the public contract

**Files:**

- Modify: `docs/reference/backend/api.md`
- Modify: `docs/reference/backend/server-core.md`
- Modify: `docs/reference/frontend/app.md`

- [x] Document endpoint schema, short-lived sensor reads, cache lifetime, and
      unavailable-temperature behavior.
- [x] Run the focused tests, `npm run verify:docs`, `npm run check`, and
      `npm run verify:architecture`.
- [x] Review `git diff --check`, `git diff`, and `git status --short`, ensuring
      the pre-existing untracked interactive-tour plan remains untouched.

## Rollback Or Failure Handling

If a command is unavailable or its output is malformed, resolve that field as
unavailable and retain the resource sample. Roll back only task-owned files by
reviewing their scoped diff; do not reset or remove unrelated user work.

## Done When

The performance panel shows static CPU/RAM/GPU information, refreshes only
available temperatures on explicit sampling, keeps monitoring off otherwise,
and all focused and applicable verification gates pass.
