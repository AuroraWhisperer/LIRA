import { toast } from '../../shared/utils.js';
import { rosterUpdateNotices } from './view.js';

export function initFanProfileAutoUpdate({ windowRef = window, notify = toast } = {}) {
  if (!windowRef.fanProfiles) return;
  let disposed = false;
  let pending = false;

  async function poll() {
    if (disposed || pending) return;
    pending = true;
    try {
      const result = await windowRef.fanProfiles.invoke({ action: 'auto-update-status' });
      if (disposed || !result.ok || !result.data) return;
      const update = result.data;
      const label = update.reason === 'startup' ? '启动补更新' : '12:10 定时更新';
      if (update.status === 'error') {
        notify(`粉丝档案${label}失败：${update.error}`, { type: 'error', duration: 5000 });
      } else {
        for (const { message, ...options } of rosterUpdateNotices(update, `粉丝档案${label}完成。`)) {
          notify(message, options);
        }
      }
    } catch (_) {
      // Login/navigation may temporarily make the desktop bridge unavailable.
      return;
    } finally {
      pending = false;
    }
  }

  const timer = windowRef.setInterval(() => void poll(), 15000);
  function dispose() {
    disposed = true;
    windowRef.clearInterval(timer);
    windowRef.removeEventListener('pagehide', dispose);
  }
  windowRef.addEventListener('pagehide', dispose, { once: true });
  void poll();
  return { poll, dispose };
}
