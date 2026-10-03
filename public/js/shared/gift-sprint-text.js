export function renderGiftSprintText(node, sprint) {
  const hasTarget = Number(sprint?.targetRmb) > 0;
  node.textContent = hasTarget ? `还差 ${sprint.remainingCrystalBalls} 个水晶球` : '';
  node.hidden = !hasTarget;
  node.classList.toggle('is-complete', hasTarget && sprint.remainingCrystalBalls === 0);
}
