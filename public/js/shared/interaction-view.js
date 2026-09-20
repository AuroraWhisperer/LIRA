export function renderPollRows(container, session) {
  const changed = container.dataset.sessionId !== session.sessionId;
  if (changed) {
    container.replaceChildren();
    container.dataset.sessionId = session.sessionId;
    for (const option of session.options) {
      const row = document.createElement('div');
      row.className = 'interaction-row';
      const label = document.createElement('div');
      label.className = 'interaction-option';
      label.textContent = option.text;
      const track = document.createElement('div');
      track.className = 'interaction-track';
      const bar = document.createElement('span');
      bar.className = 'interaction-fill';
      const value = document.createElement('span');
      value.className = 'interaction-value';
      track.append(bar, value);
      row.append(label, track);
      container.append(row);
    }
    container.scrollTop = 0;
  }
  const maximum = Math.max(0, ...session.options.map((item) => item.votes));
  const tied = session.options.filter((item) => item.votes === maximum).length > 1;
  session.options.forEach((option, index) => {
    const row = container.children[index];
    const winner = session.phase === 'finished' && maximum > 0 && option.votes === maximum;
    row.children[0].textContent = option.text + (winner ? tied ? ' · 并列最高' : ' · 最高票' : '');
    row.children[1].children[0].style.width = `${option.percentage}%`;
    row.children[1].children[1].textContent = `${option.votes} 票 · ${option.percentage.toFixed(1)}%`;
  });
  return changed;
}

export function interactionStatus(session) {
  if (session.phase === 'finished') return session.kind === 'poll' ? '投票已结束' : '评分已结束';
  if (session.phase === 'interrupted') return '接收已中断';
  if (!session.connected) return '连接中断，可能漏收';
  if (session.kind === 'rating') return '正在收集评分';
  const seconds = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
  return `剩余 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
