import { mountSceneExtraClient } from './scene-extra-client.js';
import { createRankingsView } from '../shared/live-rankings-view.js';
import { rankingDefaults } from '../shared/live-rankings.js';

const host = document.getElementById('rankings');
let view = createRankingsView(host, { scrollable: true });
const status = document.getElementById('rankingStatus');
let config = rankingDefaults();
let data;
let timer;
function render() {
  view.update(data, config);
  status.textContent = data?.boards?.length ? '' : data?.message || '等待当前账号的直播榜单…';
}
const component = mountSceneExtraClient('live-rankings', {
  onConfig(value) {
    if ((value.range === 'all') !== (config.range === 'all')) {
      view.dispose();
      view = createRankingsView(host, { scrollable: value.range === 'all' });
    }
    config = value; render();
  },
  onData(value) { data = value; render(); },
  onScroll({ x, y, deltaY }) {
    if (config.range !== 'all' || ![x, y, deltaY].every(Number.isFinite)) return;
    const body = document.elementFromPoint(x, y)?.closest('.ranking-body');
    if (body) body.scrollTop += deltaY;
  },
  onDispose() { clearInterval(timer); view.dispose(); },
});
if (component) timer = setInterval(() => view.tick(), 1000);
else status.textContent = '请从组件 → 实时榜单，点击对应榜单的「配置直播画面」，保存并复制独立地址。';
