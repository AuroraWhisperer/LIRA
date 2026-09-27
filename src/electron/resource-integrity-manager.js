'use strict';

const { SCOPE, readManifest, inspectFile } = require('./resource-integrity-files');
const ISSUE_CODES = new Set(['FILE_MISSING', 'SIZE_MISMATCH', 'HASH_MISMATCH']);
const BASELINE_CODES = new Set([
  'MANIFEST_MISSING',
  'MANIFEST_INVALID',
  'MANIFEST_UNSUPPORTED',
  'MANIFEST_VERSION_MISMATCH',
  'PATH_INVALID',
  'PATH_UNSAFE',
]);

function createResourceIntegrityManager({
  fs,
  resourcesDir,
  appVersion,
  isPackaged,
  platform,
  arch,
  onStateChange = () => {},
  writeLog = () => {},
  timeoutMs = 120000,
}) {
  const unavailable = !isPackaged ? 'DEV_MODE' : platform !== 'win32' || arch !== 'x64' ? 'PLATFORM_UNSUPPORTED' : null;
  let state = {
    revision: 0,
    status: unavailable ? 'unavailable' : 'idle',
    appVersion,
    scope: SCOPE,
    startedAt: null,
    finishedAt: null,
    totalFiles: null,
    checkedFiles: 0,
    complete: false,
    issueCount: 0,
    unresolvedCount: 0,
    details: [],
    reasonCode: unavailable,
  };
  let task = null;
  let stoppedReason = null;
  let lastProgress = 0;

  function getState() {
    return { ...state, details: state.details.map((detail) => ({ ...detail })) };
  }

  function log(value) {
    try {
      writeLog('resource-integrity', value);
    } catch (_) {
      return;
    }
  }

  function update(patch, notify = false) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    if (notify || Date.now() - lastProgress >= 250) {
      lastProgress = Date.now();
      try {
        onStateChange(getState());
      } catch (_) {
        return;
      }
    }
  }

  function finish(current, reasonCode = null, cancelled = false) {
    if (task !== current || current.finished) return;
    current.finished = true;
    clearTimeout(current.timer);
    const remaining = state.totalFiles == null ? 0 : state.totalFiles - state.checkedFiles;
    const unresolvedCount = state.unresolvedCount + remaining;
    const complete = !reasonCode && unresolvedCount === 0 && state.totalFiles != null;
    const status = cancelled ? 'cancelled' : state.issueCount ? 'issues' : complete ? 'passed' : 'inconclusive';
    update({ status, reasonCode, unresolvedCount, complete, finishedAt: new Date().toISOString() }, true);
    log({
      event: 'finished',
      status,
      reasonCode,
      appVersion,
      scope: SCOPE,
      durationMs: Date.now() - current.started,
      totalFiles: state.totalFiles,
      checkedFiles: state.checkedFiles,
      issueCount: state.issueCount,
      unresolvedCount,
      details: current.diagnostics,
      truncated: state.issueCount + state.unresolvedCount > current.diagnostics.length,
    });
  }

  async function run(current) {
    const signal = current.controller.signal;
    try {
      const manifest = await readManifest(fs, resourcesDir, { appVersion, platform, arch }, signal);
      if (current.finished) return;
      update({ totalFiles: manifest.files.length });
      for (const file of manifest.files) {
        const reasonCode = await inspectFile(fs, resourcesDir, file, signal);
        if (current.finished) return;
        const detail = { path: file.path, reasonCode };
        if (reasonCode && current.diagnostics.length < 200) current.diagnostics.push(detail);
        update({
          checkedFiles: state.checkedFiles + 1,
          issueCount: state.issueCount + (ISSUE_CODES.has(reasonCode) ? 1 : 0),
          unresolvedCount: state.unresolvedCount + (reasonCode && !ISSUE_CODES.has(reasonCode) ? 1 : 0),
          details: reasonCode && state.details.length < 20 ? [...state.details, detail] : state.details,
        });
      }
      finish(current);
    } catch (error) {
      if (!current.finished) finish(current, BASELINE_CODES.has(error.code) ? error.code : 'CHECK_FAILED');
    } finally {
      clearTimeout(current.timer);
      if (task === current) task = null;
    }
  }

  function check() {
    if (task) return getState();
    const reasonCode = stoppedReason || unavailable;
    if (reasonCode) {
      if (state.status !== 'unavailable' || state.reasonCode !== reasonCode)
        update({ status: 'unavailable', reasonCode, complete: false }, true);
      return getState();
    }
    const current = { controller: new AbortController(), started: Date.now(), finished: false, diagnostics: [] };
    task = current;
    update(
      {
        status: 'checking',
        reasonCode: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        totalFiles: null,
        checkedFiles: 0,
        issueCount: 0,
        unresolvedCount: 0,
        complete: false,
        details: [],
      },
      true,
    );
    log({ event: 'started', appVersion, scope: SCOPE });
    current.timer = setTimeout(() => {
      finish(current, 'CHECK_TIMEOUT');
      current.controller.abort();
    }, timeoutMs);
    current.promise = Promise.resolve().then(() => run(current));
    return getState();
  }

  function cancel() {
    if (task && !task.finished) {
      finish(task, 'CHECK_CANCELLED', true);
      task.controller.abort();
    }
    return whenIdle();
  }

  function stop(reasonCode = 'CHECK_CANCELLED') {
    stoppedReason = reasonCode;
    return cancel();
  }

  function whenIdle() {
    return task?.promise || Promise.resolve();
  }

  return { getState, check, cancel, stop, whenIdle };
}

module.exports = { createResourceIntegrityManager };
