// 编写人：Aurora
// 主播计划：仅在当前设备保存今天、本周和本月的轻量安排。
'use strict';

(function () {
  const STORAGE_KEY = 'admin.streamerPlanner.v1';
  const PERIODS = ['today', 'week', 'month'];
  const CATEGORIES = ['song', 'prep', 'content', 'review'];
  const PROGRESS_VALUES = [0, 25, 50, 75, 100];
  const CATEGORY_LABELS = {
    song: '学歌',
    prep: '开播准备',
    content: '内容发布',
    review: '直播复盘'
  };
  const PROGRESS_LABELS = {
    standard: {
      0: '未开始',
      25: '已经开始',
      50: '做到一半',
      75: '快完成了',
      100: '已完成'
    },
    song: {
      0: '还没听熟',
      25: '在学歌词和旋律',
      50: '能跟伴奏唱',
      75: '正在练稳定',
      100: '可以上播'
    }
  };
  const PERIOD_CONFIG = {
    today: { listId: 'plannerTodayList', countId: 'plannerTodayCount', empty: '今天先留白，想好后再添加。' },
    week: { listId: 'plannerWeekList', countId: 'plannerWeekCount', empty: '把练歌和内容安排在这一周。' },
    month: { listId: 'plannerMonthList', countId: 'plannerMonthCount', empty: '放一个本月真正想完成的目标。' }
  };
  const STARTER_TASKS = [
    { id: 'starter-preflight', title: '开播前检查麦克风、耳返和网络', period: 'today', category: 'prep', progress: 0 },
    { id: 'starter-announcement', title: '写好今天的直播标题和开播公告', period: 'today', category: 'content', progress: 0 },
    { id: 'starter-song', title: '添加本周要学的第一首歌', period: 'week', category: 'song', progress: 0 },
    { id: 'starter-clip', title: '剪出一条值得分享的直播切片', period: 'week', category: 'content', progress: 0 },
    { id: 'starter-library', title: '整理一次可点歌单', period: 'month', category: 'prep', progress: 0 },
    { id: 'starter-review', title: '看看本月最受欢迎的歌和直播时段', period: 'month', category: 'review', progress: 0 }
  ];
  const moduleState = {
    initialized: false,
    tasks: readTasks()
  };

  function createTaskId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeProgress(value, fallback = 0) {
    const numericValue = Number(value);
    return PROGRESS_VALUES.includes(numericValue) ? numericValue : fallback;
  }

  function normalizeTask(value, fallbackId = '') {
    if (!value || typeof value !== 'object') return null;
    const title = String(value.title || '').trim().slice(0, 80);
    if (!title) return null;

    return {
      id: String(value.id || fallbackId || createTaskId()),
      title,
      period: PERIODS.includes(value.period) ? value.period : 'today',
      category: CATEGORIES.includes(value.category) ? value.category : 'prep',
      progress: normalizeProgress(value.progress)
    };
  }

  function readTasks() {
    try {
      const stored = window.localStorage?.getItem(STORAGE_KEY);
      if (stored === null || stored === undefined) {
        return STARTER_TASKS.map((task) => ({ ...task }));
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((task, index) => normalizeTask(task, `restored-${index}`))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function storeTasks() {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(moduleState.tasks));
    } catch {
      // The planner remains usable for the current session when storage is disabled.
    }
  }

  function getTasks() {
    return moduleState.tasks.map((task) => ({ ...task }));
  }

  function addTask(input = {}) {
    const task = normalizeTask({
      ...input,
      id: input.id || createTaskId(),
      progress: normalizeProgress(input.progress)
    });
    if (!task) return null;

    moduleState.tasks.push(task);
    storeTasks();
    render();
    return { ...task };
  }

  function updateTask(taskId, patch = {}) {
    const task = moduleState.tasks.find((item) => item.id === taskId);
    if (!task) return null;

    if (patch.title !== undefined) {
      const title = String(patch.title || '').trim().slice(0, 80);
      if (title) task.title = title;
    }
    if (PERIODS.includes(patch.period)) task.period = patch.period;
    if (CATEGORIES.includes(patch.category)) task.category = patch.category;
    if (patch.progress !== undefined) {
      task.progress = normalizeProgress(patch.progress, task.progress);
    }

    storeTasks();
    render();
    return { ...task };
  }

  function removeTask(taskId) {
    const taskIndex = moduleState.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex < 0) return false;
    moduleState.tasks.splice(taskIndex, 1);
    storeTasks();
    render();
    return true;
  }

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function renderEmptyState(period) {
    const empty = createElement('div', 'planner-empty-state');
    const icon = createElement('span', 'planner-empty-icon', '+');
    icon.setAttribute('aria-hidden', 'true');
    empty.append(icon, createElement('p', '', PERIOD_CONFIG[period].empty));
    return empty;
  }

  function renderProgressOptions(select, task) {
    const labels = task.category === 'song' ? PROGRESS_LABELS.song : PROGRESS_LABELS.standard;
    PROGRESS_VALUES.forEach((progress) => {
      const option = createElement('option', '', labels[progress]);
      option.value = String(progress);
      option.selected = progress === task.progress;
      select.append(option);
    });
  }

  function renderTask(task) {
    const card = createElement('article', `planner-task-card category-${task.category}`);
    card.dataset.taskId = task.id;
    card.setAttribute('role', 'listitem');
    card.style.setProperty('--planner-progress', `${task.progress}%`);
    if (task.progress === 100) card.classList.add('is-complete');

    const check = createElement('button', 'planner-task-check', task.progress === 100 ? '✓' : '');
    check.type = 'button';
    check.dataset.taskComplete = task.id;
    check.setAttribute('aria-label', task.progress === 100 ? `将“${task.title}”标为未完成` : `完成“${task.title}”`);
    check.setAttribute('aria-pressed', String(task.progress === 100));

    const copy = createElement('div', 'planner-task-copy');
    copy.append(
      createElement('span', 'planner-task-category', CATEGORY_LABELS[task.category]),
      createElement('h4', '', task.title)
    );

    const remove = createElement('button', 'planner-task-delete', '×');
    remove.type = 'button';
    remove.dataset.taskDelete = task.id;
    remove.title = '删除这项安排';
    remove.setAttribute('aria-label', `删除“${task.title}”`);

    const head = createElement('div', 'planner-task-head');
    head.append(check, copy, remove);

    const progress = createElement('label', 'planner-task-progress');
    const progressCaption = createElement('span', '', task.category === 'song' ? '学歌进度' : '完成进度');
    const select = createElement('select');
    select.dataset.taskProgress = task.id;
    select.dataset.dropdownVariant = 'toolbox';
    select.setAttribute('aria-label', `${task.title}的进度`);
    renderProgressOptions(select, task);

    const meter = createElement('span', 'planner-progress-track');
    meter.setAttribute('aria-hidden', 'true');
    meter.append(createElement('span'));
    progress.append(progressCaption, select, meter);
    card.append(head, progress);
    return card;
  }

  function renderPeriod(period) {
    const config = PERIOD_CONFIG[period];
    const list = document.getElementById(config.listId);
    if (!list) return;

    const tasks = moduleState.tasks.filter((task) => task.period === period);
    list.replaceChildren(...(tasks.length ? tasks.map(renderTask) : [renderEmptyState(period)]));

    const count = document.getElementById(config.countId);
    if (count) count.textContent = `${tasks.length} 项`;
  }

  function renderSummary() {
    const completed = moduleState.tasks.filter((task) => task.progress === 100).length;
    const todayRemaining = moduleState.tasks.filter((task) => (
      task.period === 'today' && task.progress !== 100
    )).length;
    const summary = document.getElementById('plannerSummary');
    const note = document.getElementById('plannerSummaryNote');
    const date = document.getElementById('plannerDateLabel');

    if (summary) summary.textContent = `${completed} / ${moduleState.tasks.length} 已完成`;
    if (note) {
      note.textContent = todayRemaining
        ? `今天还有 ${todayRemaining} 件事，做完就安心开播`
        : '今天已安排妥当，可以轻松一点';
    }
    if (date) {
      date.textContent = new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      }).format(new Date());
    }
  }

  function render() {
    if (!document.getElementById('streamerPlanner')) return;
    PERIODS.forEach(renderPeriod);
    renderSummary();
  }

  function applyTemplate(button) {
    const title = document.getElementById('plannerTaskTitle');
    const period = document.getElementById('plannerTaskPeriod');
    const category = document.getElementById('plannerTaskCategory');
    if (!title || !period || !category) return;

    title.value = button.dataset.title || '';
    period.value = PERIODS.includes(button.dataset.period) ? button.dataset.period : 'today';
    category.value = CATEGORIES.includes(button.dataset.category) ? button.dataset.category : 'prep';
    title.focus();
    title.select();
  }

  function init() {
    const root = document.getElementById('streamerPlanner');
    if (!root || moduleState.initialized) return;

    const form = document.getElementById('plannerTaskForm');
    const title = document.getElementById('plannerTaskTitle');
    const period = document.getElementById('plannerTaskPeriod');
    const category = document.getElementById('plannerTaskCategory');

    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const task = addTask({
        title: title?.value,
        period: period?.value,
        category: category?.value
      });
      if (!task || !title) return;
      title.value = '';
      title.focus();
    });

    root.addEventListener('click', (event) => {
      const template = event.target.closest('[data-planner-template]');
      if (template) {
        applyTemplate(template);
        return;
      }

      const remove = event.target.closest('[data-task-delete]');
      if (remove) {
        removeTask(remove.dataset.taskDelete);
        return;
      }

      const complete = event.target.closest('[data-task-complete]');
      if (complete) {
        const task = moduleState.tasks.find((item) => item.id === complete.dataset.taskComplete);
        if (task) updateTask(task.id, { progress: task.progress === 100 ? 0 : 100 });
      }
    });

    root.addEventListener('change', (event) => {
      const select = event.target.closest('select[data-task-progress]');
      if (select) updateTask(select.dataset.taskProgress, { progress: Number(select.value) });
    });

    storeTasks();
    render();
    moduleState.initialized = true;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.todo = {
    init,
    addTask,
    updateTask,
    removeTask,
    getTasks
  };
})();
