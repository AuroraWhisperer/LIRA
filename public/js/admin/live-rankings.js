import { createRankingsView } from '../shared/live-rankings-view.js';
import { LIVE_RANKING_COMPONENT, RANKING_FLAGS, rankingDefaults, rankingSelection, singleRankingId } from '../shared/live-rankings.js';
import { subscribeLiveRankings } from './live-rankings-client.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { prepareComponentPreviews } from './component-preview-registry.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { toast } from '../shared/toast.js';
import { createSharedSceneSettingsController } from './shared-scene-settings-controller.js';
import { syncComponentFieldValue, subscribeComponentFields } from './component-preview-panel.js';

export function initLiveRankings() {
  const root = document.getElementById('liveRankingsFeature');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const get = name => root.querySelector(`[data-rankings="${name}"]`);
  const settings = createSharedSceneSettingsController('live-rankings');
  const view = createRankingsView(get('boards'), { onConfigure: configureBoard });
  let snapshot;
  let stop;
  let clock;
  let paused = false;
  const appearance = () => ({ ...rankingDefaults(), ...Object.fromEntries(Object.values(RANKING_FLAGS).map(flag => [flag, true])),
    columns: '2', ...settings.controller.getState().draft, fontSize: 15, theme: 'inherit' });
  function render() {
    const boards = LIVE_RANKING_COMPONENT.variants.map(({ value, label }) => snapshot?.boards?.find(board => board.id === value)
      || { id: value, title: label, unit: value.startsWith('hot') ? '热度值' : '助力值', rows: [], current: null,
        status: !snapshot || snapshot.status === 'loading' ? 'loading' : 'unavailable',
        message: snapshot?.message || '正在连接榜单…' });
    view.update({ ...snapshot, boards }, appearance());
  }
  async function configureBoard(id) {
    try {
      const entries = await prepareComponentPreviews();
      const canvas = entries.find(entry => entry.id === 'canvas');
      if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
      await getActiveComponentPreview('browser-preview')?.syncCanvas();
      const document = canvas.controller.getState().draft.document;
      let item = document.items.find(item => item.type === 'live-rankings' && singleRankingId(item.appearance.config) === id);
      if (!item) {
        if (document.items.filter(item => item.type !== 'text-box').length >= 32) throw new Error('当前场景已满，请在画布中新建场景。');
        const [sourceWidth, sourceHeight] = LIVE_RANKING_COMPONENT.size;
        const scale = Math.min(1, document.canvas.width / sourceWidth, document.canvas.height / sourceHeight);
        const width = Math.round(sourceWidth * scale); const height = Math.round(sourceHeight * scale);
        item = { id: crypto.randomUUID(), type: 'live-rankings', name: LIVE_RANKING_COMPONENT.variants.find(board => board.value === id).label,
          x: Math.round((document.canvas.width - width) / 2), y: Math.round((document.canvas.height - height) / 2),
          width, height, visible: true, locked: false,
          appearance: { mode: 'independent', config: { ...rankingDefaults(), ...rankingSelection(id) } } };
        document.items.push(item); canvas.controller.edit({ document });
      }
      openComponentPreview({ id: 'live-rankings', selectedItemId: item.id });
    } catch (error) { toast(error.message, { type: 'error' }); }
  }
  function receive(data) {
    snapshot = data;
    get('room').textContent = data.room ? `${data.room.name || '当前直播间'} · ${data.room.roomId}` : '跟随当前账号配置的直播间';
    get('status').textContent = data.message || '';
    render();
  }
  function sync() {
    const visible = !paused && !document.hidden && root.getClientRects().length > 0;
    if (visible && !stop) {
      stop = subscribeLiveRankings(receive);
      clock = setInterval(() => view.tick(), 250);
    } else if (!visible && stop) {
      stop(); stop = null; clearInterval(clock);
    }
  }
  const renderSettings = () => {
    const state = settings.controller.getState();
    syncComponentFieldValue(get('range'), state.draft.range);
    get('settings-status').textContent = state.error ? '显示设置未保存，修改已保留，请重试。'
      : state.saving ? '正在保存显示设置…' : state.dirty ? '等待保存…' : '';
    get('settings-retry').hidden = !state.error;
    render();
  };
  const stopSettings = subscribeComponentFields(root, settings.controller, renderSettings);
  get('range').addEventListener('change', () => {
    settings.controller.edit({ range: get('range').value });
    void settings.save();
  });
  get('settings-retry').addEventListener('click', () => { void settings.save(); });
  get('pause').addEventListener('click', () => {
    paused = !paused;
    get('pause').textContent = paused ? '继续刷新' : '暂停查看';
    get('pause').setAttribute('aria-pressed', String(paused));
    if (paused) get('status').textContent = '当前查看已暂停，直播画面的订阅继续运行';
    sync();
  });
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
  observer.observe(document.getElementById('liveComponentsPage'), { attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { observer.disconnect(); stop?.(); clearInterval(clock); view.dispose(); stopSettings(); settings.dispose(); document.removeEventListener('visibilitychange', sync); }, { once: true });
  render(); sync();
}
