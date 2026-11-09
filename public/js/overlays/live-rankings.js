import { mountSceneExtraClient } from './scene-extra-client.js';
import { createRankingsView } from '../shared/live-rankings-view.js';
import { rankingDefaults } from '../shared/live-rankings.js';

const view = createRankingsView(document.getElementById('rankings'));
const status = document.getElementById('rankingStatus');
let config = rankingDefaults();
let data;
let timer;
function render() {
  view.update(data, config);
  status.textContent = data?.boards?.length ? '' : data?.message || '等待当前账号的直播榜单…';
}
const component = mountSceneExtraClient('live-rankings', {
  onConfig(value) { config = value; render(); },
  onData(value) { data = value; render(); },
  onDispose() { clearInterval(timer); view.dispose(); },
});
if (component) timer = setInterval(() => view.tick(), 250);
else status.textContent = '请从组件 → 实时榜单，点击对应榜单的「配置直播画面」，保存并复制独立地址。';
