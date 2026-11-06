'use strict';

import { api, readJsonResponse, showError, toast } from '../shared/utils.js';
import { createDrawWordPicker } from './games-word-picker.js';

export function createDrawAdmin({ onSession, onRefreshFailure, onRefreshSuccess }) {
  // Only syncSession replaces this snapshot; action responses go back through the page owner.
  let sessionSnapshot = null;
  let interactionCollecting = false;
  let hostStateRequest = 0;
  let drawClock = null;
  let drawClockTimer = null;
  let drawWordCategories = [];
  let activeDrawCategoryIds = null;

  const drawWordPicker = createDrawWordPicker({
    async onChoose(value) {
      const result = await api('/api/games/session/move', { value }, { notifyError: false });
      if (sessionSnapshot?.sessionId !== value.sessionId || sessionSnapshot?.state?.round !== value.round) return;
      if (result.data.eventRevision >= sessionSnapshot.eventRevision) onSession(result.data);
      await refreshHostState().catch(onRefreshFailure);
      toast('题词已选定，开始作画');
    },
  });
  byId('drawOpenWordPickerBtn').addEventListener('click', () => refreshHostState().then(() => drawWordPicker.open()).catch(showError));
  byId('drawCardTrigger').addEventListener('click', toggleDrawDetails);
  byId('drawFinishRoundBtn').addEventListener('click', () => controlDrawRound('finish-round').catch(showError));
  byId('drawRevealAnswerBtn').addEventListener('click', () => controlDrawRound('reveal-answer').catch(showError));
  byId('drawNextRoundBtn').addEventListener('click', () => controlDrawRound('next-round').catch(showError));
  byId('drawSelectAllCategoriesBtn').addEventListener('click', () => setAllDrawCategories(true));
  byId('drawClearCategoriesBtn').addEventListener('click', () => setAllDrawCategories(false));

  async function refreshHostState() {
    const request = ++hostStateRequest;
    const sessionId = sessionSnapshot?.sessionId;
    const round = sessionSnapshot?.state?.round;
    const phase = sessionSnapshot?.state?.phase;
    if (sessionSnapshot?.game !== 'draw-guess') return;
    const response = await fetch('/api/games/host-state', { cache: 'no-store' });
    const payload = await readJsonResponse(response, '读取你画我猜题词失败');
    if (request !== hostStateRequest || sessionId !== sessionSnapshot?.sessionId || round !== sessionSnapshot?.state?.round || phase !== sessionSnapshot?.state?.phase) return;
    if (!payload.ok) throw new Error(payload.error || '读取你画我猜题词失败');
    if (payload.data?.game !== 'draw-guess' || payload.data.round !== round) return;
    renderHostState(payload.data);
    onRefreshSuccess();
  }

  async function refreshDrawCategories() {
    const response = await fetch('/api/games/draw-guess/categories', {
      cache: 'no-store',
    });
    const payload = await readJsonResponse(response, '读取你画我猜词库失败');
    if (!payload.ok) throw new Error(payload.error || '读取你画我猜词库失败');
    renderDrawCategories(payload.data || []);
  }

  function renderDrawCategories(categories) {
    drawWordCategories = categories.filter((category) => category?.id && category?.label && Number(category.count) > 0);
    const root = byId('drawWordCategories');
    root.replaceChildren();
    const selected = activeDrawCategoryIds ? new Set(activeDrawCategoryIds) : null;
    for (const category of drawWordCategories) {
      const label = document.createElement('label');
      label.className = 'draw-word-category';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(category.id);
      input.checked = selected ? selected.has(input.value) : true;
      input.dataset.drawCategory = '';
      input.addEventListener('change', updateDrawCategoryStatus);
      const name = document.createElement('strong');
      name.textContent = String(category.label);
      const count = document.createElement('span');
      count.textContent = `${Number(category.count)} 词`;
      label.append(input, name, count);
      root.append(label);
    }
    setDrawCategoryControlsDisabled(Boolean(sessionSnapshot));
    updateDrawCategoryStatus();
  }

  function readSelectedDrawCategoryIds() {
    return [...document.querySelectorAll('[data-draw-category]:checked')].map((input) => input.value);
  }

  function setAllDrawCategories(selected) {
    document.querySelectorAll('[data-draw-category]').forEach((input) => {
      input.checked = selected;
    });
    updateDrawCategoryStatus();
  }

  function updateDrawCategoryStatus() {
    const selectedIds = new Set(readSelectedDrawCategoryIds());
    const wordCount = drawWordCategories.reduce(
      (total, category) => (selectedIds.has(String(category.id)) ? total + Number(category.count) : total),
      0,
    );
    byId('drawWordCategoryStatus').textContent = drawWordCategories.length
      ? `已选 ${selectedIds.size} / ${drawWordCategories.length} 类 · ${wordCount} 词`
      : '暂时没有可用分类';
    syncDrawStartAvailability();
  }

  function setDrawCategoryControlsDisabled(disabled) {
    document.querySelectorAll('[data-draw-category]').forEach((input) => {
      input.disabled = disabled;
      input.closest('.draw-word-category')?.classList.toggle('is-disabled', disabled);
    });
    byId('drawSelectAllCategoriesBtn').disabled = disabled;
    byId('drawClearCategoriesBtn').disabled = disabled;
  }

  function syncDrawStartAvailability() {
    const button = document.querySelector('[data-start-game="draw-guess"]');
    if (!button) return;
    const disabled =
      Boolean(sessionSnapshot) ||
      interactionCollecting ||
      !drawWordCategories.length ||
      !readSelectedDrawCategoryIds().length;
    button.disabled = disabled;
    button.setAttribute('aria-disabled', String(disabled));
  }

  async function start() {
    const categoryIds = readSelectedDrawCategoryIds();
    if (!categoryIds.length) throw new Error('请至少选择一个词库分类。');
    const result = await api('/api/games/session', {
      game: 'draw-guess',
      totalRounds: Number(byId('drawTotalRounds').value),
      roundDurationSeconds: Number(byId('drawRoundDuration').value),
      categoryIds,
    });
    onSession(result.data);
    await refreshHostState();
    setDrawDetails(true);
    toast('请选择本局题词');
  }

  async function controlDrawRound(action) {
    const result = await api('/api/games/session/move', { value: { action } });
    onSession(result.data);
    await refreshHostState();
    if (action !== 'reveal-answer') {
      toast(action === 'finish-round' ? '作画已结束，请公布答案' : '请选择下一题的题词');
    }
  }

  function toggleDrawDetails() {
    setDrawDetails(byId('drawCardDetails').hidden);
  }

  function setDrawDetails(expanded) {
    const card = document.querySelector('[data-draw-card]');
    const details = byId('drawCardDetails');
    details.hidden = !expanded;
    card.classList.toggle('is-collapsed', !expanded);
    byId('drawCardTrigger').setAttribute('aria-expanded', String(expanded));
  }

  function syncSession(session, collecting) {
    if (session?.sessionId !== sessionSnapshot?.sessionId || session?.state?.round !== sessionSnapshot?.state?.round || session?.state?.phase !== sessionSnapshot?.state?.phase) {
      hostStateRequest += 1;
      byId('drawHostWord').textContent = session?.game === 'draw-guess'
        ? session.state.phase === 'choosing' ? '请选择本局题词' : '正在读取题词…'
        : '开始游戏后选择题词';
    }
    sessionSnapshot = session || null;
    interactionCollecting = collecting;
    drawWordPicker?.sync(sessionSnapshot);
    syncDrawClockTimer();
    document.querySelectorAll('[data-draw-setting]').forEach((label) => {
      label.classList.toggle('is-disabled', Boolean(session));
      label.querySelector('input').disabled = Boolean(session);
    });
    setDrawCategoryControlsDisabled(Boolean(session));
    syncDrawStartAvailability();
    renderDrawSession(session);
  }

  function renderDrawSession(session) {
    const drawSession = session?.game === 'draw-guess' ? session : null;
    const state = drawSession?.state;
    byId('drawOpenWordPickerBtn').hidden = state?.phase !== 'choosing';
    byId('drawFinishRoundBtn').disabled = state?.phase !== 'drawing';
    byId('drawRevealAnswerBtn').disabled = state?.phase !== 'round-result' || Boolean(state.answerRevealed);
    byId('drawNextRoundBtn').disabled = state?.phase !== 'round-result' || !state.answerRevealed;
    if (!state) {
      drawClock = null;
      byId('drawCardStatus').textContent = '自定义赛制 · 1–12 局 · 15–300 秒';
      byId('drawHostRound').textContent = '等待开局';
      byId('drawHostStatus').textContent = '开始后挑选题词，确认后开始计时';
      byId('drawHostClock').textContent = '01:30';
      return;
    }
    setDrawDetails(true);
    byId('drawTotalRounds').value = String(state.totalRounds);
    byId('drawRoundDuration').value = String(Math.round(state.roundDurationMs / 1000));
    drawClock = {
      remainingMs: Number(state.remainingMs) || 0,
      receivedAt: performance.now(),
    };
    byId('drawHostRound').textContent = state.phase === 'choosing'
      ? `第 ${state.round} / ${state.totalRounds} 局 · 等待选词`
      : `第 ${state.round} / ${state.totalRounds} 局 · ${state.category} · ${state.wordLength} 个字`;
    if (state.phase === 'choosing') {
      byId('drawHostClock').textContent = '--:--';
      byId('drawCardStatus').textContent = `第 ${state.round} 局 · 等待主播挑选题词`;
      byId('drawHostStatus').textContent = '在选词窗中确认题词后，网页画板和倒计时自动开始';
    } else if (state.phase === 'drawing') {
      byId('drawCardStatus').textContent = `第 ${state.round} 局进行中 · ${state.correct.length} 人答对`;
      byId('drawHostStatus').textContent = '请在游戏网页作画，题词仅在这里显示';
    } else if (state.phase === 'round-result') {
      byId('drawHostClock').textContent = '--:--';
      byId('drawCardStatus').textContent = state.answerRevealed
        ? `第 ${state.round} 局结束 · 答案已公布：${state.revealedAnswer}`
        : `第 ${state.round} 局结束 · 等待主播公布答案`;
      byId('drawHostStatus').textContent = state.answerRevealed ? '可以开始下一题' : '时间到，弹幕仍在收集且不计分';
    } else {
      byId('drawHostClock').textContent = '--:--';
      const champion = state.scores[0];
      byId('drawCardStatus').textContent = champion
        ? `比赛结束 · ${champion.name} ${champion.score} 分`
        : '比赛结束 · 本场无人得分';
      byId('drawHostStatus').textContent = '最终排行已显示在游戏网页，可结束当前游戏';
    }
    updateDrawClock();
  }

  function renderHostState(state) {
    const visible = state?.game === 'draw-guess' && sessionSnapshot?.game === 'draw-guess';
    if (visible && Array.isArray(state.categoryIds) && state.categoryIds.length) {
      activeDrawCategoryIds = state.categoryIds.map(String);
      document.querySelectorAll('[data-draw-category]').forEach((input) => {
        input.checked = activeDrawCategoryIds.includes(input.value);
      });
      updateDrawCategoryStatus();
    }
    byId('drawHostWord').textContent = visible
      ? state.phase === 'choosing' ? '请选择本局题词' : state.word
      : '开始游戏后选择题词';
    drawWordPicker?.sync(sessionSnapshot, visible ? state : null);
  }

  function updateDrawClock() {
    if (sessionSnapshot?.game !== 'draw-guess' || sessionSnapshot.state?.phase !== 'drawing' || !drawClock) return;
    const elapsed = performance.now() - drawClock.receivedAt;
    const remaining = Math.max(0, drawClock.remainingMs - elapsed);
    const totalSeconds = Math.ceil(remaining / 1000);
    byId('drawHostClock').textContent =
      `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }

  function syncDrawClockTimer() {
    const active = sessionSnapshot?.game === 'draw-guess' && sessionSnapshot.state?.phase === 'drawing';
    if (!active) {
      stopDrawClockTimer();
      return;
    }
    if (drawClockTimer === null) {
      drawClockTimer = setInterval(updateDrawClock, 250);
    }
  }

  function stopDrawClockTimer() {
    if (drawClockTimer !== null) {
      clearInterval(drawClockTimer);
      drawClockTimer = null;
    }
  }

  return { syncSession, start, refreshHostState, refreshCategories: refreshDrawCategories, dispose: stopDrawClockTimer };
}

function byId(id) {
  return document.getElementById(id);
}
