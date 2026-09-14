'use strict';

import { readJsonResponse } from '../shared/utils.js';

const BASE = '/api/bilibili/dynamic-lottery';
const ERRORS = {
  LOTTERY_IDENTITY_UNAVAILABLE: '请先完成 LIRA 账号授权。',
  LOTTERY_DESKTOP_REQUIRED: '请在 LIRA 桌面客户端使用动态抽奖。',
  LOTTERY_STORAGE_UNAVAILABLE:
    '抽奖数据库不可用，请重启客户端。其他功能不受影响。',
  LOTTERY_STORAGE_FAILED: '保存抽奖进度失败，请停止操作并检查本地数据目录。',
  LOTTERY_DYNAMIC_LINK_INVALID:
    '请粘贴 B站动态、BV 视频或 b23.tv 的 HTTPS 链接。',
  LOTTERY_DYNAMIC_TYPE_UNSUPPORTED:
    '此动态类型暂不支持，请使用原创文字/图文动态，或直接使用 BV 视频链接。',
  LOTTERY_DYNAMIC_OWNER_MISMATCH:
    '抽奖账号不是内容作者，请在上方切换为作者的专用账号。',
  LOTTERY_VIDEO_SOURCE_UNAVAILABLE:
    '视频支持评论抽奖及关注核验；暂不能可靠取得视频点赞、分享用户名单。请关闭这两个条件，或使用原创图文动态。',
  LOTTERY_BILIBILI_AUTH_REQUIRED: '抽奖登录已失效，请退出并重新登录作者账号。',
  LOTTERY_SESSION_CHANGED:
    '账号或授权发生变化，操作已停止。确认原作者账号后继续。',
  LOTTERY_SESSION_DISPOSED: '客户端正在关闭；重新打开后可继续。',
  LOTTERY_AUTH_BUSY: '账号正在登录或退出，请稍后继续。',
  LOTTERY_BILIBILI_CHALLENGE:
    'B站要求验证或触发风控。请先在登录窗口处理，稍后手动继续。',
  LOTTERY_BILIBILI_RATE_LIMITED:
    'B站限制了请求频率。进度已保存，请冷却后手动继续。',
  LOTTERY_REQUEST_PAUSED:
    '请求已暂停；确认登录和网络后点击继续，冷却期间仍会等待。',
  LOTTERY_COOLING_DOWN:
    'B站请求仍在冷却期，请至少等待 5 分钟或服务器要求的更长时间后继续。',
  LOTTERY_UPSTREAM_INVALID:
    'B站返回的名单或分页不完整，已停止；不会用部分名单开奖。请稍后继续。',
  LOTTERY_REACTION_UNKNOWN:
    'B站返回了无法识别的互动类型，已暂停，不能把它当作点赞或转发。',
  LOTTERY_REACTION_INCOMPLETE:
    '互动用户名单少于内容显示的数量，无法确认完整性。已暂停，不会用部分名单开奖；请稍后新建活动重新采集。',
  LOTTERY_BILIBILI_API_ERROR:
    'B站接口暂时无法读取，请稍后重试；已保存的名单不会丢失。',
  LOTTERY_REQUEST_TIMEOUT: 'B站请求超时，进度已保存，可稍后继续。',
  LOTTERY_RELATION_UNKNOWN:
    '无法确认当前候选人是否关注作者。停在该候选人，继续时不会跳过或重新乱序。',
  LOTTERY_INTERRUPTED: '上次操作被中断，进度已保存。请手动继续。',
  LOTTERY_COLLECTION_PAUSED: '采集已暂停，可从保存的位置继续。',
  LOTTERY_OPERATION_PAUSED: '操作已暂停；名单、顺序和已确认的中奖者均已保留。',
  LOTTERY_COLLECTION_INCOMPLETE: '请先完成所有所选来源的采集，再开始开奖。',
  LOTTERY_CURSOR_CONFLICT:
    '分页游标重复或发生冲突，不能继续确认完整名单。请新建活动重新采集。',
  LOTTERY_COLLECTION_LIMIT:
    '名单超过本版采集上限（10 万条证据），已停止；不能使用截断名单开奖。',
  LOTTERY_DRAW_CONFLICT: '活动状态已更新，请刷新后再操作。',
  LOTTERY_BUSY: '已有采集或开奖操作在进行，请先等待或暂停。',
  LOTTERY_RULES_INVALID: '请填写链接和 1–100 的整数中奖人数。',
  LOTTERY_LEGACY_TASK: '这是旧版规则的活动，仅供查看。请新建活动使用当前流程。',
  LOTTERY_TASK_NOT_FOUND: '活动不存在或不属于当前 LIRA 账号。',
};
const SOURCE_NAMES = { comment: '评论', like: '点赞', repost: '转发' };
const STATUSES = {
  draft: '待采集',
  collecting: '正在采集',
  ready: '名单就绪',
  frozen: '顺序已保存',
  drawing: '正在核验',
  paused: '已暂停',
  completed: '开奖完成',
  exhausted: '候选名单已用尽',
};

function errorText(code) {
  return code
    ? ERRORS[code] || '操作未完成，已保留进度。请刷新状态后再继续。'
    : '';
}

export function initLotteryWorkflow(root) {
  const form = root.querySelector('[data-lottery-form]');
  if (!form) return { setAuth() {}, reset() {}, dispose() {} };
  const find = (key) => root.querySelector(`[data-lottery-${key}]`);
  const fields = find('fields');
  const history = find('history');
  const progress = find('progress');
  const status = find('task-status');
  const message = find('message');
  const winners = find('winners');
  const resultNote = find('result-note');
  const taskInfo = find('task-info');
  const listeners = [];
  let auth = { available: false, loggedIn: false, busy: false };
  let data = { tasks: [], task: null, result: null, job: null, error: '' };
  let selectedId = '';
  let hydratedId = '';
  let creating = false;
  let requestId = null;
  let busy = false;
  let disposed = false;
  let timer = null;
  let controller = null;
  let generation = 0;

  function listen(element, type, handler) {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  }

  function fillForm(task) {
    if (!task || hydratedId === task.id || creating) return;
    hydratedId = task.id;
    form.elements.url.value = task.target.url || '';
    form.elements.winnerCount.value = task.rules.winnerCount || 10;
    form.elements.requireLike.checked =
      task.rules.requiredActions?.includes('like') === true;
    form.elements.requireRepost.checked =
      task.rules.requiredActions?.includes('repost') === true;
    form.elements.requireFollow.checked = task.rules.requireFollow === true;
  }

  function render() {
    const task = data.task;
    const result = data.result;
    const working = Boolean(data.job);
    const canAct = auth.available && auth.loggedIn && !auth.busy && !busy;
    fields.disabled = !canAct || working || Boolean(task && !creating);
    find('create').disabled = fields.disabled;
    find('new').disabled = !canAct || working;
    find('state-refresh').disabled = !auth.available || auth.busy || busy;
    find('pause').disabled = !canAct || !working;
    find('resume').disabled =
      !canAct ||
      working ||
      !task ||
      !['paused', 'draft', 'frozen'].includes(task.status);
    find('draw').disabled =
      !canAct || working || !task || task.status !== 'ready';
    find('resume').textContent = result ? '继续原顺序核验' : '继续采集';
    history.disabled = busy || working || data.tasks.length === 0;
    const options = data.tasks.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `${new Date(entry.createdAtMs).toLocaleString()} · ${entry.description.slice(0, 45)} · ${STATUSES[entry.status] || entry.status}`;
      option.selected = entry.id === task?.id;
      return option;
    });
    history.replaceChildren(...options);
    if (creating) history.selectedIndex = -1;
    fillForm(task);
    status.textContent =
      working && !data.job.taskId
        ? '正在确认链接与作者账号…'
        : creating
          ? '新建抽奖活动'
          : task
            ? STATUSES[task.status] || '等待操作'
            : '等待创建活动';
    taskInfo.textContent = task
      ? `${task.target.description || '抽奖内容'} · 作者 UID ${task.ownerUid} · 评论截止 ${new Date(task.rules.endsAtMs).toLocaleString()}`
      : '';
    progress.replaceChildren();
    if (task?.scan) {
      for (const [source, state] of Object.entries(task.scan.sources)) {
        const item = document.createElement('li');
        item.textContent = `${SOURCE_NAMES[source] || source}：${state.readCount} 条记录 · ${state.coverage === 'exhausted' ? '分页结束' : '未采集完'}`;
        progress.append(item);
      }
    }
    if (task?.candidateCount !== null && task?.candidateCount !== undefined) {
      const item = document.createElement('li');
      item.textContent = `去重并满足全部互动条件：${task.candidateCount} 人（已排除作者）`;
      progress.append(item);
    }
    message.textContent = errorText(
      data.error || result?.reason || task?.scan?.pauseReason,
    );
    winners.replaceChildren();
    for (const winner of result?.winners || []) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `https://space.bilibili.com/${winner.uid}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `UID ${winner.uid}`;
      const verified = document.createElement('span');
      verified.textContent =
        winner.verification.reason === 'FOLLOW_NOT_REQUIRED'
          ? '符合互动条件 · 未要求关注'
          : '已确认关注作者';
      item.append(link, verified);
      winners.append(item);
    }
    resultNote.textContent = result
      ? `已确认 ${result.winners.length} / ${result.requestedCount} 人 · 已处理 ${result.checkedCount} 人 · 不符合 ${result.excludedCount} 人${result.shortage ? ` · 名单已用尽，缺 ${result.shortage} 人` : ''}${result.status === 'paused' ? ' · 暂停在下一位待核验候选人' : ''}`
      : '完成采集后点击“开始随机抽奖”。结果会保存在当前 LIRA 账号的本地历史中。';
    find('draw-proof').textContent = result
      ? `名单摘要 SHA-256：${result.digest} · ${result.algorithm} · 顺序已固定，继续不会重排`
      : '';
  }

  function cancelRequest() {
    generation += 1;
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    timer = null;
  }

  async function load(path = '/state', body) {
    if (disposed || !auth.available || auth.busy) return;
    cancelRequest();
    const current = generation;
    controller = new AbortController();
    busy = true;
    render();
    try {
      const headers = {};
      if (window.__API_TOKEN__)
        headers.Authorization = `Bearer ${window.__API_TOKEN__}`;
      if (body) headers['Content-Type'] = 'application/json';
      const query =
        path === '/state' && selectedId
          ? `?taskId=${encodeURIComponent(selectedId)}`
          : '';
      const response = await fetch(`${BASE}${path}${query}`, {
        method: body ? 'POST' : 'GET',
        headers,
        cache: 'no-store',
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const payload = await readJsonResponse(response, '无法读取抽奖状态');
      if (disposed || current !== generation) return;
      if (!payload.ok) {
        data.error = payload.error;
      } else {
        data = payload.data;
        selectedId = data.task?.id || '';
        if (path === '/tasks') creating = false;
        if (!data.task && !data.job) creating = true;
      }
    } catch (error) {
      if (disposed || current !== generation || error.name === 'AbortError')
        return;
      data.error = 'LOTTERY_OPERATION_FAILED';
    } finally {
      if (!disposed && current === generation) {
        busy = false;
        render();
        if (data.job)
          timer = setTimeout(() => {
            void load();
          }, 1500);
      }
    }
  }

  listen(form, 'submit', (event) => {
    event.preventDefault();
    if (find('create').disabled || !form.reportValidity()) return;
    requestId ||= crypto.randomUUID();
    selectedId = '';
    void load('/tasks', {
      url: form.elements.url.value.trim(),
      winnerCount: Number(form.elements.winnerCount.value),
      requireLike: form.elements.requireLike.checked,
      requireRepost: form.elements.requireRepost.checked,
      requireFollow: form.elements.requireFollow.checked,
      requestId,
    });
  });
  listen(form, 'input', () => {
    requestId = null;
  });
  for (const action of ['pause', 'resume', 'draw']) {
    listen(find(action), 'click', () => {
      if (find(action).disabled) return;
      void load('/tasks/action', {
        taskId: action === 'pause' ? data.job?.taskId : data.task?.id,
        revision: data.task?.revision,
        action,
      });
    });
  }
  listen(find('new'), 'click', () => {
    cancelRequest();
    creating = true;
    requestId = null;
    selectedId = '';
    hydratedId = '';
    data = { ...data, task: null, result: null, job: null, error: '' };
    render();
    form.elements.url.focus();
  });
  listen(find('state-refresh'), 'click', () => {
    creating = false;
    void load();
  });
  listen(history, 'change', () => {
    selectedId = history.value;
    creating = false;
    void load();
  });

  function reset() {
    cancelRequest();
    data = { tasks: [], task: null, result: null, job: null, error: '' };
    busy = false;
    selectedId = '';
    hydratedId = '';
    requestId = null;
    creating = false;
    form.reset();
    render();
  }

  render();
  return {
    setAuth(next) {
      if (disposed) return;
      const changed =
        auth.available !== next.available ||
        auth.loggedIn !== next.loggedIn ||
        auth.busy !== next.busy;
      auth = next;
      if (changed) {
        cancelRequest();
        busy = false;
        render();
        if (auth.available && !auth.busy) void load();
      }
    },
    reset,
    dispose() {
      disposed = true;
      cancelRequest();
      for (const remove of listeners) remove();
    },
  };
}
