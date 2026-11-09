export function createFormerNameBatch({ request, getContext, onChanged }) {
  const get = id => document.getElementById(id);
  let current = null;
  let timer;
  let wake;
  let disposed = false;

  function stop() {
    if (current) current.stopped = true;
    if (wake) {
      clearTimeout(timer);
      const finish = wake;
      wake = null;
      finish();
    }
  }

  function reset() {
    stop();
    current = null;
    get('fanFormerBatch').hidden = true;
    get('fanFormerBatchStart').disabled = false;
  }

  function update(job) {
    get('fanFormerBatchProgress').max = job.total || 1;
    get('fanFormerBatchProgress').value = job.processed;
    get('fanFormerBatchStatus').textContent = `${job.running ? '正在补充' : job.error ? '补充已暂停' : job.stopped ? '已停止' : '补充完成'}：${job.processed} / ${job.total} 份，${job.changed} 份有新增，共补充 ${job.added} 个名字${job.error ? `。${job.error}` : ''}`;
    get('fanFormerBatchStop').hidden = !job.running;
  }

  async function run() {
    if (current?.running || disposed) return;
    const job = { contextId: getContext(), running: true, stopped: false, processed: 0, total: 0, changed: 0, added: 0 };
    current = job;
    const active = () => !disposed && current === job && job.contextId === getContext();
    get('fanFormerBatchStart').disabled = true;
    get('fanFormerBatch').hidden = false;
    update(job);
    try {
      const { ids } = await request('former-name-targets');
      if (!active()) return;
      job.total = ids.length;
      update(job);
      for (const id of ids) {
        if (job.stopped || !active()) break;
        const result = await request('supplement-former-names', { id });
        if (!active()) return;
        job.processed++;
        job.added += result.added;
        if (result.added) job.changed++;
        update(job);
        if (job.processed < job.total && !job.stopped) await new Promise(resolve => {
          wake = resolve;
          timer = setTimeout(() => { wake = null; resolve(); }, 1000);
        });
      }
    } catch (error) {
      job.error = error.message;
    } finally {
      job.running = false;
      if (active()) {
        get('fanFormerBatchStart').disabled = false;
        update(job);
        if (job.processed) await onChanged(job.contextId);
      }
    }
  }

  return { run, stop, reset, dispose() { disposed = true; stop(); } };
}
