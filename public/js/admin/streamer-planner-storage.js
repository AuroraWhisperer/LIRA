'use strict';

import {
  STORAGE_KEY,
  PREVIOUS_STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  createDefaultState,
  normalizeState,
  normalizeTasks,
} from './streamer-planner-model.js';

export function createPlannerStorage(getStorage) {
  let readFailed = false;
  let saveFailed = false;

  function readStoredJson(key) {
    const stored = getStorage().getItem(key);
    return stored === null || stored === undefined ? undefined : JSON.parse(stored);
  }

  function read() {
    try {
      const current = readStoredJson(STORAGE_KEY);
      if (current !== undefined) {
        if (
          current.version !== 3 ||
          !Array.isArray(current.tasks) ||
          !Array.isArray(current.notes) ||
          !Array.isArray(current.events)
        ) {
          throw new Error('Invalid workbench data');
        }
        return normalizeState(current);
      }
      const previous = readStoredJson(PREVIOUS_STORAGE_KEY);
      if (previous !== undefined) {
        if (!Array.isArray(previous.tasks) || !Array.isArray(previous.notes)) {
          throw new Error('Invalid previous workbench data');
        }
        return normalizeState(previous);
      }
      const legacy = readStoredJson(LEGACY_STORAGE_KEY);
      if (legacy !== undefined && !Array.isArray(legacy)) {
        throw new Error('Invalid legacy workbench data');
      }
      const state = createDefaultState();
      if (legacy) state.tasks = normalizeTasks(legacy, 'migrated-task', true);
      return state;
    } catch {
      // Do not replace unreadable records with an empty workbench.
      readFailed = true;
      return createDefaultState();
    }
  }

  function write(planner) {
    if (readFailed) return false;
    try {
      getStorage().setItem(STORAGE_KEY, JSON.stringify(planner));
      saveFailed = false;
      return true;
    } catch {
      saveFailed = true;
      return false;
    }
  }

  return {
    read,
    write,
    getStatus: () => ({ readFailed, saveFailed }),
  };
}
