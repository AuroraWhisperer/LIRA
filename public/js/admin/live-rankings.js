import { createRankingsView } from '../shared/live-rankings-view.js';
import { rankingDefaults } from '../shared/live-rankings.js';
import { subscribeLiveRankings } from './live-rankings-client.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { createSceneExtraPreview } from './scene-extra-preview.js';

export function initLiveRankings() {
  const root = document.getElementById('liveRankingsFeature');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const get = name => root.querySelector(`[data-rankings="${name}"]`);
  const view = createRankingsView(get('boards'), { scrollable: true });
  let snapshot;
  let stop;
  let clock;
  let paused = false;
  const appearance = () => ({ ...rankingDefaults(), range: get('range').value, nearby: Number(get('nearby').value), fontSize: 15, theme: 'inherit' });
  function receive(data) {
    snapshot = data;
    get('room').textContent = data.room ? `${data.room.name || '当前直播间'} · ${data.room.roomId}` : '跟随当前账号配置的直播间';
    get('status').textContent = data.message || '每秒查询 2 次 · 分区随房间自动匹配';
    view.update(data, appearance());
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
  function updateRange() {
    get('neighbors').hidden = get('range').value !== 'nearby';
    if (snapshot) view.update(snapshot, appearance());
  }
  get('range').addEventListener('change', updateRange);
  get('nearby').addEventListener('change', () => {
    if (get('nearby').checkValidity()) updateRange();
  });
  get('pause').addEventListener('click', () => {
    paused = !paused;
    get('pause').textContent = paused ? '继续刷新' : '暂停查看';
    get('pause').setAttribute('aria-pressed', String(paused));
    if (paused) get('status').textContent = '当前查看已暂停，直播画面的订阅继续运行';
    sync();
  });
  get('display').addEventListener('click', () => openComponentPreview(createSceneExtraPreview('live-rankings')));
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
  observer.observe(document.getElementById('liveComponentsPage'), { attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => { observer.disconnect(); stop?.(); clearInterval(clock); view.dispose(); document.removeEventListener('visibilitychange', sync); }, { once: true });
  updateRange(); sync();
}
