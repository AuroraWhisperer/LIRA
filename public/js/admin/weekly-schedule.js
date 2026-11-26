import { createWeeklyScheduleEditor } from './weekly-schedule/editor.js';
import { toast } from '../shared/toast.js';

let editor;

export function flushWeeklySchedule() {
  return editor?.flush() ?? true;
}

export function initWeeklySchedule() {
  const root = document.getElementById('weeklyScheduleEditor');
  if (!root) return;
  let disposed = false;
  window.addEventListener('pagehide', () => {
    disposed = true;
    editor?.dispose();
    editor = null;
  }, { once: true });
  void createWeeklyScheduleEditor(root).then(instance => {
    if (disposed) instance.dispose();
    else editor = instance;
  }).catch(error => toast(error.message || '周表加载失败，请重新打开管理页。', { type: 'error' }));
}
