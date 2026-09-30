import { localOverlayOrigin } from '../shared/utils.js';
import { cloneComponentPanel, componentField } from './component-preview-panel.js';
import { bindQueueTheme } from './queue-theme-view.js';
import { pickQueueSettings } from './queue-theme-config.js';

export function createQueuePreview({ controller, source = document }) {
  return { id: 'queue', title: '点歌板', controller,
    url: new URL('/queue?componentPreview=1', localOverlayOrigin()).href,
    size: () => [480, 800], projectConfig: pickQueueSettings,
    createPanel: (host, targetController = controller) => {
      const panel = cloneComponentPanel(source.querySelector('#themeForm'), 'preview-queue');
      componentField(panel, 'queueThemeActions').remove();
      componentField(panel, 'queueThemeSaveState').remove();
      host.append(panel);
      return bindQueueTheme(panel, targetController);
    },
    startData: ({ emit }) => {
      emit({ queue: { current: { song_name: '当前演唱 · 示例歌曲', requester_name: '示例观众' },
        waiting: Array.from({ length: 12 }, (_, index) => ({ song_name: `待唱歌曲 ${index + 1}`,
          requester_name: `示例观众 ${index + 1}`, is_pinned: index === 0 })) },
        superChats: [{ message: '这是一条示例留言', price: 30 }] });
    },
  };
}
