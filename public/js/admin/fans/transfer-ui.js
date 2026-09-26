import { toast } from '../../shared/utils.js';
import { html, dateLabel } from './view.js';
import { legacyForm } from './forms.js';

export function createFanTransferUi({ request, openForm, getProfile, onProfile, onReset }) {
  async function mergeDraft(patch, targetId) {
    const input = { id: patch.id, revision: patch.revision, targetId, patch };
    const preview = await request('preview-merge', input);
    const summary = (p) => {
      const birthday = p.birthday;
      const fields = [
        ['常用称呼', p.alias],
        ['一句话印象', p.summary],
        ['生日', birthday ? `${birthday.year ? `${birthday.year}-` : ''}${birthday.monthDay}（${birthday.calendar === 'lunar' ? '农历' : '公历'}${birthday.leapMonth ? '闰月' : ''}）` : ''],
        ['生日提醒', !birthday ? '' : birthday.calendar === 'lunar' && !birthday.thisYearDate ? '尚未设置今年的提醒日期' : `${birthday.advance ? '提前 7 天提醒' : '当天提醒'}${birthday.thisYearDate ? ` · 今年提醒日：${birthday.thisYearDate}` : ''}${birthday.calendar !== 'lunar' && birthday.monthDay === '02-29' ? ` · 非闰年：${birthday.leapDay === 'mar01' ? '3 月 1 日' : '2 月 28 日'}` : ''}`],
        ['MBTI', p.mbti],
        ['个人备注', p.notes],
        ['下次想聊', p.nextTopic],
        ['标签', p.tags?.join('、')],
      ];
      return `<dl class="fan-facts">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${html(value || '未填写')}</dd></div>`).join('')}</dl>`;
    };
    openForm(
      {
        title: '合并重复档案',
        saveLabel: '确认合并',
        hint: '两份档案的记录都会保留。合并前会自动备份，方便撤回。',
        fields: `<p class="fan-field-wide">将“${html(preview.source.alias)}”的 ${preview.recordCount} 条记录合入“${html(preview.target.alias || preview.target.platformName)}”。</p>
        <div class="fan-merge-preview fan-field-wide"><section><h3>这次填写</h3>${summary(preview.source)}</section><section><h3>已有档案</h3>${summary(preview.target)}</section></div>
        <label class="fan-field fan-field-wide">资料不同时，以哪份为准<select name="prefer"><option value="target">保留已有资料，只补充未填写的内容</option><option value="source">采用这次填写的资料，留空的内容保持原样</option></select></label>`,
        read: (value) => ({
          ...input,
          targetRevision: preview.target.revision,
          prefer: value.elements.prefer.value,
        }),
      },
      async (payload) => {
        const result = await request('merge', payload);
        await onProfile(result.profile);
      },
    );
  }

  async function snapshots() {
    const points = await request('snapshots');
    if (!points.length) {
      toast('尚无本机恢复点；合并或恢复备份前会自动创建。');
      return;
    }
    openForm(
      {
        title: '选择本机恢复点',
        saveLabel: '预览恢复点',
        fields: `<label class="fan-field fan-field-wide">恢复点<select name="point">${points.map((p) => `<option value="${html(p.id)}">${html(new Date(p.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))} · ${html(p.reason)}</option>`).join('')}</select></label>`,
        read: (value) => value.elements.point.value,
      },
      async (snapshotId) => {
        const preview = await request('preview-snapshot', { snapshotId });
        openForm(
          {
            title: '恢复到这个时间点',
            saveLabel: '确认恢复',
            hint: '会替换当前账号的全部档案；现在的状态也会先保存为新恢复点。',
            fields: `<p class="fan-field-wide">恢复点包含 ${preview.added + preview.updated} 份档案。这将撤回之后的合并、编辑与新增资料。</p><label class="fan-check"><input name="confirm" type="checkbox" required />确认恢复当前账号的全部档案</label>`,
            read: (value) => ({
              snapshotId,
              digest: preview.digest,
              currentDigest: preview.currentDigest,
              confirm: value.elements.confirm.checked,
            }),
          },
          async (payload) => {
            await request('restore-snapshot', payload);
            await onReset();
          },
        );
        return { keepOpen: true };
      },
    );
  }

  async function suppressions() {
    const items = await request('suppression-list');
    if (!items.length) {
      toast('没有停止自动建档的粉丝。');
      return;
    }
    openForm(
      {
        title: '恢复自动建档',
        saveLabel: '移出排除名单',
        hint: '移出后，下次同步到这位粉丝的上舰记录时，可重新建立档案。',
        fields: `<label class="fan-field fan-field-wide">粉丝账号<select name="identity">${items.map((p, index) => `<option value="${index}">${p.identity[1] === 'uid' ? 'UID' : 'B 站账号'} ${html(p.identity[2])}</option>`).join('')}</select></label><label class="fan-check"><input name="confirm" type="checkbox" required />允许再次自动建档</label>`,
        read: (value) => {
          const [platform, type, id] = items[Number(value.elements.identity.value)].identity;
          return {
            identity: { platform, type, value: id },
            confirm: value.elements.confirm.checked,
          };
        },
      },
      async (payload) => {
        await request('unsuppress', payload);
      },
    );
  }

  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function restoreFile(file) {
    if (!file || file.size > 16 * 1024 * 1024) throw new Error('请选择 16 MB 以内的完整档案备份。');
    const backup = JSON.parse(await file.text());
    const preview = await request('preview-restore', { backup });
    openForm(
      {
        title: '核对恢复预览',
        saveLabel: '确认恢复',
        hint: '恢复前会自动备份当前资料。选择替换时，会覆盖对应档案的完整内容。',
        fields: `<p class="fan-field-wide">恢复到当前账号：新增 ${preview.added} 份档案，${preview.updated} 份档案已存在。</p>
        <label class="fan-field fan-field-wide">遇到已有档案<select name="conflicts"><option value="keep">保留本机档案</option><option value="replace">用备份中的档案完整替换</option></select></label>`,
        read: (value) => ({
          backup,
          digest: preview.digest,
          currentDigest: preview.currentDigest,
          conflicts: value.elements.conflicts.value,
        }),
      },
      async (payload) => {
        await request('restore', payload);
        await onReset();
      },
    );
  }

  function legacy() {
    openForm({ ...legacyForm(getProfile()), saveLabel: '预览记录' }, async (range) => {
      const preview = await request('preview-legacy', range);
      openForm(
        {
          title: '确认要导入的点歌',
          saveLabel: '确认补录',
          fields: `<p class="fan-field-wide">${html(range.from)} 至 ${html(range.to)} 共 ${preview.count} 条点歌${preview.unownedCount ? `，其中 ${preview.unownedCount} 条需要确认来自你的直播间` : ''}。</p><label class="fan-check"><input type="checkbox" name="confirm" required />我已核对，这些点歌来自我的直播间</label>
          <details class="fan-field-wide"><summary>查看记录</summary><ul>${preview.records.map((r) => `<li>${html(dateLabel(r.occurredAt))} · ${html(r.songName)}${r.artist ? ` · ${html(r.artist)}` : ''}</li>`).join('')}</ul></details>`,
          read: (value) => ({
            ...range,
            digest: preview.digest,
            confirmOwnership: value.elements.confirm.checked,
          }),
        },
        async (payload) => {
          await onProfile(await request('import-legacy', payload));
        },
      );
      return { keepOpen: true };
    });
  }

  return { mergeDraft, snapshots, suppressions, download, restoreFile, legacy };
}
