import { createFontLibraryToast } from './admin/font-library-toast.js';
import { formatBytes } from './shared/display-format.js';

const status = document.getElementById('fontLibraryInitializationStatus');
const controller = createFontLibraryToast({
  onState(state = {}) {
    if (!status) return;
    status.hidden = !['downloading', 'error'].includes(state.status) || !state.total;
    const progress = state.totalBytes
      ? `${formatBytes(state.downloadedBytes || 0)} / ${formatBytes(state.totalBytes)}`
      : `${state.completed || 0} / ${state.total || 0}`;
    status.textContent = state.status === 'error'
      ? '部分字体和图片暂未下载，进入后可重试；已缓存资源仍可使用。'
      : `正在准备字体和图片 ${progress}，进入后将在后台继续。`;
  },
});
void controller.init();
