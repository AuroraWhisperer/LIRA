export function initDailyBotTakeover({ documentRef, invoke }) {
  const get = (id) => documentRef.getElementById(`dailyBot${id}`);
  const panel = get('Takeover'), details = get('LegacySummary'), feedback = get('ImportFeedback');
  let state = null, locked = true, inspected = false, draftId = null;
  const fields = [['level', '签级'], ['name', '签名'], ['text', '签文'], ['advice', '建议']];
  function showFortunes(items) {
    const list = get('FortuneCorrection'); list.replaceChildren();
    for (const [index, item] of (Array.isArray(items) && items.length ? items : [{}]).entries()) {
      const row = documentRef.createElement('fieldset'); row.dataset.fortuneRow = '';
      const legend = documentRef.createElement('legend'); legend.textContent = `第 ${index + 1} 签`; row.append(legend);
      for (const [key, title] of fields) {
        const label = documentRef.createElement('label'); label.textContent = title;
        const field = documentRef.createElement('input'); field.type = 'text'; field.dataset.field = key;
        field.value = typeof item?.[key] === 'string' ? item[key] : ''; field.maxLength = 1024;
        label.append(field); row.append(label);
      }
      const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'ghost'; remove.textContent = '删除此签';
      remove.addEventListener('click', () => { row.remove(); draftId = null; controls(); });
      row.append(remove); list.append(row);
    }
  }
  const input = () => ({ legacyStoppedConfirmed: get('Stopped').checked,
    ownershipConfirmed: get('Ownership').checked, libraryChoice: {
      checkin: get('BlessingChoice').value, fortune: get('FortuneChoice').value,
    } });
  function controls() {
    get('Inspect').disabled = locked;
    get('NoLegacy').disabled = locked || !inspected || !get('Stopped').checked || state?.state !== 'pending';
    get('Fresh').disabled = locked || !inspected || !get('Stopped').checked || !get('FreshConfirmed').checked || state?.state !== 'pending';
    get('Prepare').disabled = locked || !inspected || !get('Stopped').checked || !get('Ownership').checked;
    get('Apply').disabled = locked || !draftId;
    get('Cancel').disabled = locked || state?.state !== 'importing';
    for (const id of ['Stopped', 'Ownership', 'FreshConfirmed', 'BlessingChoice', 'FortuneChoice', 'BlessingCorrection']) get(id).disabled = locked;
    for (const field of get('FortuneCorrection').querySelectorAll('input,button')) field.disabled = locked;
    get('BlessingCorrectionLabel').hidden = get('BlessingChoice').value !== 'corrected';
    get('FortuneCorrectionLabel').hidden = get('FortuneChoice').value !== 'corrected';
  }
  get('Inspect').addEventListener('click', () => invoke('summary'));
  get('NoLegacy').addEventListener('click', () => invoke('decide', {
    decision: 'no-legacy', expectedRevision: state.revision, legacyStoppedConfirmed: get('Stopped').checked,
  }));
  get('Fresh').addEventListener('click', () => invoke('decide', {
    decision: 'fresh-start', expectedRevision: state.revision, legacyStoppedConfirmed: get('Stopped').checked,
  }));
  get('Prepare').addEventListener('click', () => {
    const payload = input();
    if (payload.libraryChoice.checkin === 'corrected') payload.blessings = get('BlessingCorrection').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (payload.libraryChoice.fortune === 'corrected') payload.fortunes = [...get('FortuneCorrection').querySelectorAll('[data-fortune-row]')]
      .map((row) => Object.fromEntries(fields.map(([key]) => [key, row.querySelector(`[data-field="${key}"]`).value.trim()])));
    void invoke('prepare', payload);
  });
  get('Apply').addEventListener('click', () => invoke('apply', { draftId }));
  get('Cancel').addEventListener('click', () => invoke('cancel', { id: state.importId, expectedRevision: state.revision }));
  for (const id of ['Stopped', 'Ownership', 'FreshConfirmed', 'BlessingChoice', 'FortuneChoice', 'BlessingCorrection', 'FortuneCorrection']) {
    get(id).addEventListener('input', () => { draftId = null; controls(); });
  }
  return {
    render(settings, busy) {
      state = settings?.takeover; locked = busy;
      panel.hidden = !state || state.state === 'ready';
      get('Cancel').hidden = state?.state !== 'importing';
      get('Prepare').textContent = state?.state === 'importing' ? '重新核对并继续暂存导入' : '读取停写后的最终快照';
      controls();
    },
    result(action, response) {
      if (response.summary) {
        inspected = true;
        const s = response.summary;
        details.textContent = `目标账号：${response.accountName}。本机来源：${s.sourceLabel}；${s.count} 人，累计 ${s.minDays ?? 0}～${s.maxDays ?? 0} 天，最近签到 ${s.lastDate || '无'}${s.customLibraries ? '，含自定义词库' : '，使用内置词库'}。旧库没有主播归属字段，混用过多个主播时不能直接导入。`;
      }
      if (action === 'prepare') {
        draftId = response.draftId;
        get('BlessingCorrection').value = Array.isArray(response.blessings) ? response.blessings.join('\n') : String(response.blessings ?? '');
        showFortunes(response.fortunes);
        feedback.textContent = `最终快照已读取（${response.cutoffAt}），请提交预检并导入。签池曾修改或本次修正/替换时，当天签文可能变化。`;
      }
      if (response.preflight) feedback.textContent = response.preflight.issues.map((issue) =>
        `${{ checkins: '签到记录', checkin: '祝福语', fortune: '签池', cutoffAt: '截止时间' }[issue.field]} 第 ${issue.index + 1} 项：${issue.reason === 'reply-too-long' ? '回复过长' : '内容或日期无效'}`).join('；') + '。请先取消暂存，修正词库或明确改用内置版本，再重新准备。';
      if (action === 'cancel') { draftId = null; feedback.textContent = '暂存已取消，原库和云端业务记录保留。'; }
    },
    reset() {
      inspected = false; draftId = null; details.textContent = ''; feedback.textContent = '';
      for (const id of ['Stopped', 'Ownership', 'FreshConfirmed']) get(id).checked = false;
      get('BlessingChoice').value = get('FortuneChoice').value = 'legacy';
      get('BlessingCorrection').value = ''; get('FortuneCorrection').replaceChildren();
    },
  };
}
