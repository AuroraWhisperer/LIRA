import { createWeeklyScheduleEditor } from './weekly-schedule/editor.js';
import { toast } from '../shared/toast.js';

export function initWeeklySchedule() {
  const root = document.getElementById('weeklyScheduleEditor');
  if (!root) return;
  let editor;
  let disposed = false;
  window.addEventListener('beforeunload', () => {
    disposed = true;
    editor?.dispose();
  }, { once: true });
  void createWeeklyScheduleEditor(root).then(instance => {
    if (disposed) instance.dispose();
    else editor = instance;
  }).catch(error => toast(error.message || '周表加载失败，请重新打开管理页。', { type: 'error' }));
}
