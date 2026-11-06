import { isComponentPreview } from './component-preview-client.js';

export function createGameResult({ onAction, resolveAvatarUrl }) {
  let profileRequest = 0;
  let restartBlocked = false;

  function show({ winner, identity = {}, title, avatarLabel, blockRestart = false }) {
    restartBlocked = blockRestart;
    const result = byId('gameResult');
    const winnerUid = String(identity.uid || '').trim();
    if (!result.hidden && result.dataset.winner === winner && result.dataset.winnerUid === winnerUid) return;
    const requestId = ++profileRequest;
    result.dataset.winner = winner;
    result.dataset.winnerUid = winnerUid;
    byId('gameResultText').textContent = title;
    setActionsPending(false);
    setActionStatus('');
    result.hidden = false;
    position();
    hideAvatar();
    if (winner !== 'draw' && !isComponentPreview()) void loadWinnerProfile(requestId, winner, avatarLabel);
  }

  function position() {
    const result = byId('gameResult');
    if (!result || result.hidden) return;
    const target = document.body.dataset.game === 'gomoku' ? byId('gomokuBoard') : byId('bombNumbers');
    const stage = byId('gameStage');
    if (!target || !stage) return;
    const targetRect = target.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (targetRect.width <= 0 || targetRect.height <= 0) return;
    result.style.left = `${targetRect.left - stageRect.left}px`;
    result.style.top = `${targetRect.top - stageRect.top}px`;
    result.style.width = `${targetRect.width}px`;
    result.style.height = `${targetRect.height}px`;
  }

  async function loadWinnerProfile(requestId, winner, avatarLabel) {
    try {
      const token = window.__API_TOKEN__;
      const response = await fetch('/api/games/winner-profile', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const payload = await response.json();
      if (!payload.ok || requestId !== profileRequest) return;
      const profile = payload.data || {};
      const result = byId('gameResult');
      if (result.hidden || result.dataset.winner !== winner) return;
      if (!profile.avatarUrl) return;
      const avatar = byId('gameResultAvatar');
      avatar.alt = avatarLabel;
      avatar.src = resolveAvatarUrl(profile.avatarUrl);
      avatar.hidden = false;
    } catch (_) {
      hideAvatar();
    }
  }

  function requestAction(action) {
    const result = byId('gameResult');
    if (result.hidden || !['stop', 'restart'].includes(action)) return;
    setActionsPending(true, action);
    setActionStatus('');
    return onAction(action);
  }

  function showActionError() {
    if (byId('gameResult').hidden) return;
    setActionsPending(false);
    setActionStatus('操作失败，请重试');
  }

  function setActionsPending(pending, action = '') {
    const exitButton = byId('gameResultExit');
    const nextButton = byId('gameResultNext');
    exitButton.disabled = pending;
    nextButton.disabled = pending || restartBlocked === true;
    nextButton.title = restartBlocked ? '请先结束投票或评分' : '';
    exitButton.textContent = pending && action === 'stop' ? '正在结束…' : '结束游戏';
    nextButton.textContent = pending && action === 'restart' ? '开局中…' : '下一局';
  }

  function setActionStatus(message) {
    const status = byId('gameResultActionStatus');
    status.textContent = message;
    status.hidden = !message;
  }

  function hide(blockRestart = false) {
    restartBlocked = blockRestart;
    profileRequest += 1;
    const result = byId('gameResult');
    result.hidden = true;
    result.removeAttribute('style');
    delete result.dataset.winner;
    delete result.dataset.winnerUid;
    hideAvatar();
    setActionsPending(false);
    setActionStatus('');
  }

  function hideAvatar() {
    const avatar = byId('gameResultAvatar');
    avatar.hidden = true;
    avatar.alt = '';
    avatar.removeAttribute('src');
  }

  const stop = () => requestAction('stop');
  const restart = () => requestAction('restart');

  function bind() {
    byId('gameResultAvatar').addEventListener('error', hideAvatar);
    byId('gameResultExit').addEventListener('click', stop);
    byId('gameResultNext').addEventListener('click', restart);
    window.addEventListener('resize', position);
  }

  function dispose() {
    profileRequest += 1;
    byId('gameResultAvatar').removeEventListener('error', hideAvatar);
    byId('gameResultExit').removeEventListener('click', stop);
    byId('gameResultNext').removeEventListener('click', restart);
    window.removeEventListener('resize', position);
  }

  return { bind, show, hide, showActionError, dispose };
}

function byId(id) {
  return document.getElementById(id);
}
