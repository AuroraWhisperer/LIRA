import { toast } from '../../shared/utils.js';
import { html } from './view.js';
import { legacyForm } from './forms.js';

export function createFanTransferUi({ request, openForm, getProfile, onProfile, onReset }) {
  async function mergeDraft(patch, targetId) {
    const input = { id: patch.id, revision: patch.revision, targetId, patch };
    const preview = await request('preview-merge', input);
    const summary = (p) =>
      html(
        JSON.stringify(
          {
            称呼: p.alias,
            识别摘要: p.summary,
            生日: p.birthday,
            MBTI: p.mbti,
            个人备注: p.notes,
            下次想聊: p.nextTopic,
            标签: p.tags,
          },
          null,
          2,
        ),
      );
    openForm(
      {
        title: '合并到已有身份档案',
        saveLabel: '确认合并',
        hint: '记录与原始依据会保留，合并前自动保存本机恢复点。',
        fields: `<p class="fan-field-wide">将草稿“${html(preview.source.alias)}”的 ${preview.recordCount} 条记录合入“${html(preview.target.alias || preview.target.platformName)}”。</p>
        <details class="fan-field-wide" open><summary>核对两份资料</summary><h3>当前草稿</h3><pre>${summary(preview.source)}</pre><h3>已有档案</h3><pre>${summary(preview.target)}</pre></details>
        <label class="fan-field fan-field-wide">相同字段采用哪份资料<select name="prefer"><option value="target">保留已有档案，只补空缺</option><option value="source">采用当前草稿，空值不覆盖</option></select></label>`,
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
        fields: `<label class="fan-field fan-field-wide">恢复点<select name="point">${points.map((p) => `<option value="${html(p.id)}">${html(p.createdAt)} · ${html(p.reason)}</option>`).join('')}</select></label>`,
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
      toast('没有被排除的身份。');
      return;
    }
    openForm(
      {
        title: '允许身份再次自动建档',
        saveLabel: '移出排除名单',
        hint: '移除后，下次上舰事件或历史回放可以再次为这个身份建档。',
        fields: `<label class="fan-field fan-field-wide">身份<select name="identity">${items.map((p, index) => `<option value="${index}">${html(p.identity[1])} ${html(p.identity[2])}</option>`).join('')}</select></label><label class="fan-check"><input name="confirm" type="checkbox" required />允许再次自动建档</label>`,
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
        hint: '恢复前会在本机保存完整快照；空值不会自动覆盖另一份档案，替换冲突需主动选择。',
        fields: `<p class="fan-field-wide">将新建 ${preview.added} 份档案，发现 ${preview.updated} 份已有档案。备份归属：${html(preview.scope)}</p>
        <label class="fan-field fan-field-wide">遇到已有档案<select name="conflicts"><option value="keep">保留本机档案</option><option value="replace">用备份完整替换冲突档案</option></select></label>`,
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
          title: '确认旧点歌归属',
          saveLabel: '确认补录',
          fields: `<p class="fan-field-wide">${html(range.from)} 至 ${html(range.to)} 共 ${preview.count} 条，其中 ${preview.unownedCount} 条原来没有主播归属。请确认这些记录属于当前主播。</p><label class="fan-check"><input type="checkbox" name="confirm" required />我已核对这些记录属于当前账号</label>
          <details class="fan-field-wide"><summary>查看记录</summary><ul>${preview.records.map((r) => `<li>${html(r.occurredAt)} · ${html(r.songName)} · ${html(r.artist)}</li>`).join('')}</ul></details>`,
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
