export function createBlindBoxDatePicker({ onChange, onOpen }) {
  const get = (name) => document.getElementById(`blindBoxAnalysisDate${name}`);
  const root = document.getElementById('blindBoxAnalysisDates');
  const trigger = get('Trigger');
  const popover = get('Popover');
  const days = get('Days');
  let selection = null;
  let mode = 'single';
  let startDate = '';
  let endDate = '';
  let month;

  function close({ focus = false } = {}) {
    const wasOpen = !popover.hidden;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus && wasOpen) trigger.focus();
  }

  function setSelection(value) {
    selection = value;
    const label = value ? formatRange(value.startDate, value.endDate) : '今天';
    get('Label').textContent = label;
    trigger.setAttribute('aria-label', `选择统计日期，${label}`);
    close();
  }

  function open() {
    onOpen();
    const today = dateKey(new Date());
    startDate = selection?.startDate || today;
    endDate = selection?.endDate || today;
    mode = startDate === endDate ? 'single' : 'range';
    month = parseDate(startDate);
    month.setDate(1);
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    render(startDate);
    days.querySelector('[tabindex="0"]')?.focus();
  }

  function apply(value) {
    setSelection(value);
    trigger.focus();
    onChange(value);
  }

  function render(focusedDate = '') {
    root.querySelectorAll('[data-blind-date-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.blindDateMode === mode));
    });
    get('Selection').textContent = formatRange(startDate, endDate);
    get('Month').textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
    get('Hint').textContent = mode === 'single'
      ? '选择要查看的日期'
      : endDate ? '包含开始和结束日期' : startDate ? '请选择结束日期' : '请选择开始日期';
    get('Apply').disabled = !endDate;
    const firstWeekday = (month.getDay() + 6) % 7;
    const today = dateKey(new Date());
    const tabDate = focusedDate || (
      startDate.slice(0, 7) === dateKey(month).slice(0, 7) ? startDate : dateKey(month)
    );
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(month);
      date.setDate(1 - firstWeekday + index);
      const key = dateKey(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.date = key;
      button.textContent = String(date.getDate());
      button.tabIndex = key === tabDate ? 0 : -1;
      button.classList.toggle('is-outside', date.getMonth() !== month.getMonth());
      button.classList.toggle('is-today', key === today);
      button.classList.toggle('is-selected', key === startDate || key === endDate);
      button.setAttribute('aria-label', `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`);
      button.setAttribute('aria-pressed', String(key === startDate || key === endDate));
      if (key === today) button.setAttribute('aria-current', 'date');
      fragment.append(button);
    }
    days.replaceChildren(fragment);
    paintRange();
  }

  function paintRange(hoverDate = '') {
    const end = endDate || hoverDate || startDate;
    const first = startDate < end ? startDate : end;
    const last = startDate < end ? end : startDate;
    days.querySelectorAll('[data-date]').forEach((button) => {
      const key = button.dataset.date;
      button.classList.toggle('is-in-range', mode === 'range' && !!startDate && key > first && key < last);
      button.classList.toggle('is-range-start', mode === 'range' && !!startDate && first !== last && key === first);
      button.classList.toggle('is-range-end', mode === 'range' && !!startDate && first !== last && key === last);
    });
  }

  trigger.addEventListener('click', () => {
    if (popover.hidden) open();
    else close();
  });
  root.querySelectorAll('[data-blind-date-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.blindDateMode;
      if (mode === nextMode) return;
      mode = nextMode;
      startDate = mode === 'single' ? startDate || selection?.startDate || dateKey(new Date()) : '';
      endDate = mode === 'single' ? startDate : '';
      if (mode === 'single') {
        month = parseDate(startDate);
        month.setDate(1);
      }
      render();
    });
  });
  root.querySelectorAll('[data-blind-date-month]').forEach((button) => {
    button.addEventListener('click', () => {
      month.setMonth(month.getMonth() + Number(button.dataset.blindDateMonth));
      render();
    });
  });
  days.addEventListener('click', (event) => {
    const key = event.target.closest('[data-date]')?.dataset.date;
    if (!key) return;
    if (mode === 'single') startDate = endDate = key;
    else if (!startDate || endDate) {
      startDate = key;
      endDate = '';
    } else {
      [startDate, endDate] = [startDate, key].sort();
    }
    month = parseDate(key);
    month.setDate(1);
    render(key);
    days.querySelector(`[data-date="${key}"]`)?.focus();
  });
  days.addEventListener('pointerover', (event) => {
    if (mode === 'range' && !endDate) paintRange(event.target.closest('[data-date]')?.dataset.date);
  });
  days.addEventListener('pointerleave', () => paintRange());
  days.addEventListener('keydown', (event) => {
    const key = event.target.dataset.date;
    if (!key) return;
    const date = parseDate(key);
    const weekday = (date.getDay() + 6) % 7;
    const offsets = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday,
    };
    if (!Object.hasOwn(offsets, event.key) && !['PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    if (Object.hasOwn(offsets, event.key)) date.setDate(date.getDate() + offsets[event.key]);
    else {
      const day = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1));
      const last = new Date(date);
      last.setMonth(last.getMonth() + 1, 0);
      date.setDate(Math.min(day, last.getDate()));
    }
    month = new Date(date);
    month.setDate(1);
    render(dateKey(date));
    days.querySelector('[tabindex="0"]')?.focus();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || popover.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close({ focus: true });
  });
  root.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !root.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', (event) => {
    if (!event.composedPath().includes(root)) close();
  });
  get('Cancel').addEventListener('click', () => close({ focus: true }));
  get('Today').addEventListener('click', () => apply(null));
  get('Apply').addEventListener('click', () => {
    if (endDate) apply({ startDate, endDate });
  });

  return { setSelection, close };
}

function parseDate(value) {
  return new Date(`${value}T12:00:00`);
}

function dateKey(date) {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatRange(startDate, endDate) {
  if (!startDate) return '开始日期 — 结束日期';
  const start = startDate.replaceAll('-', '.');
  return startDate === endDate ? start : `${start} — ${endDate ? endDate.replaceAll('-', '.') : '选择结束日期'}`;
}
