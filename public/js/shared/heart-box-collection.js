import { HEART_COLLECTION_BACKGROUNDS } from './heart-box-collection-appearance.js';

const views = new WeakMap();

function createView(root) {
  const doc = root.ownerDocument;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (path) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    node.append(shape);
    return node;
  };
  const artwork = (className, name) => {
    const image = element('img', className);
    image.alt = '';
    image.src = `/img/heart-box-collection/${name}.webp`;
    return image;
  };
  root.classList.add('heart-collection');
  const heading = element('div', 'heart-collection-heading');
  const image = artwork('heart-collection-image', 'heart-box');
  const title = element('span', 'heart-collection-title', '收集心动盲盒');
  const total = element('span', 'heart-collection-total');
  const count = element('strong', 'heart-collection-count');
  const target = element('span', 'heart-collection-target');
  const state = element('span', 'heart-collection-state');
  total.append(count, target);
  heading.append(image, title, total, state);
  const milestones = element('div', 'heart-collection-milestones');
  const track = element('div', 'heart-collection-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', '本期心动盲盒收集进度');
  const fill = element('div', 'heart-collection-fill');
  track.append(fill);
  const collected = element('span', 'heart-collection-collected', '已收集');
  const stages = element('ol', 'heart-collection-stages');
  const entries = Array.from({ length: 4 }, () => {
    const entry = element('li', 'heart-collection-stage');
    const node = element('div', 'heart-collection-node');
    const threshold = element('strong', 'heart-collection-threshold');
    const lock = element('span', 'heart-collection-lock');
    lock.append(icon('M6 10h12v11H6Zm3 0V6a3 3 0 0 1 6 0v4'));
    const check = element('span', 'heart-collection-check');
    check.append(icon('m5 12 4 4L19 6'));
    node.append(threshold, lock, check);
    const reward = element('div', 'heart-collection-reward');
    const castle = artwork('heart-collection-castle', 'castle');
    const multiplier = element('strong', 'heart-collection-multiplier');
    const limit = element('span', 'heart-collection-limit');
    const rewardTitle = element('div', 'heart-collection-reward-title');
    rewardTitle.append(castle, multiplier);
    reward.append(rewardTitle, limit);
    entry.append(node, reward);
    stages.append(entry);
    return { entry, threshold, reward, multiplier, limit };
  });
  milestones.append(track, collected, stages);
  root.replaceChildren(heading, milestones);
  return { count, target, state, track, entries };
}

export function renderHeartBoxCollection(root, data, { displayStyle = 'task', backgroundStyle = 'white', showRewards = true } = {}) {
  root.hidden = !data;
  if (!data) return;
  let view = views.get(root);
  if (!view) {
    view = createView(root);
    views.set(root, view);
  }
  const compact = displayStyle === 'compact';
  root.dataset.background = Object.hasOwn(HEART_COLLECTION_BACKGROUNDS, backgroundStyle) ? backgroundStyle : 'white';
  root.classList.toggle('is-compact', compact);
  root.classList.toggle('is-ended', data.status === 'ended');
  root.classList.toggle('is-complete', data.completed);
  view.count.textContent = String(data.count);
  view.target.textContent = ` / ${data.target}`;
  view.state.textContent = data.status === 'ended' ? '收集已结束' : data.completed ? '全部解锁' : '收集中';
  view.track.setAttribute('aria-valuemin', '0');
  view.track.setAttribute('aria-valuemax', '120');
  view.track.setAttribute('aria-valuenow', String(Math.min(data.count, 120)));
  view.track.setAttribute('aria-valuetext', `本期已收集 ${data.count} 个心动盲盒`);
  let position = data.completed ? 1 : 0;
  let previousTarget = 0;
  let previousPosition = 0;
  data.stages.forEach((stage, index) => {
    const entry = view.entries[index];
    const next = !stage.unlocked && stage.target === data.target;
    entry.entry.classList.toggle('is-unlocked', stage.unlocked);
    entry.reward.hidden = !showRewards;
    entry.entry.setAttribute('aria-label', `${stage.target} 个${showRewards ? `：${stage.multiplier} 倍，限开 ${stage.castles} 个` : ''}，${stage.unlocked ? '已解锁' : '未解锁'}`);
    entry.threshold.textContent = String(stage.target);
    entry.multiplier.textContent = `${stage.multiplier}倍`;
    entry.limit.textContent = `限开 ${stage.castles} 个`;
    // The task grid starts at 6%, spans 96%, and its rail ends at the final node.
    const center = (index + 0.5) / data.stages.length;
    const nodePosition = compact ? center : (0.06 + 0.96 * center) / 0.9;
    if (next && !data.completed) {
      position = previousPosition + (nodePosition - previousPosition)
        * (data.count - previousTarget) / (stage.target - previousTarget);
    }
    previousTarget = stage.target;
    previousPosition = nodePosition;
  });
  root.style.setProperty('--heart-progress', String(position));
}
