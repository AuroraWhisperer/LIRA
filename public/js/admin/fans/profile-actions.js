import { profileForm, recordForm } from './forms.js';
import { html } from './view.js';
import { toast } from '../../shared/utils.js';

export function createFanProfileActions({ request, openForm, onProfile, onDeleted, onChanged, onArchived, onSuppressed, reload }) {
  function editProfile(profile = {}) {
    openForm(profileForm(profile), async (payload) => {
      let saved;
      try {
        saved = await request(profile.id ? 'save' : 'create', payload);
      } catch (error) {
        if (error.existingId && profile.id && !profile.identity) error.mergeInput = payload;
        throw error;
      }
      await onProfile(saved);
    });
  }

  function editRecord(profileId, kind, record) {
    openForm(recordForm(kind, record), async (payload) => {
      const result = await request('save-record', { ...payload, profileId });
      await onProfile(result.profile, kind === 'note' ? 'interactions' : undefined);
    });
  }

  function deleteProfile(profile) {
    const id = profile.id;
    openForm(
      {
        title: '永久删除档案',
        saveLabel: '确认永久删除',
        hint: '档案、手记与提醒状态会删除，原始礼物账本不受影响。此操作不能撤销。',
        fields: `<p class="fan-field-wide">即将删除 ${html(profile.alias || profile.platformName)}。建议先保存完整备份。</p><label class="fan-check"><input name="suppress" type="checkbox" checked />将绑定的 B 站账号加入黑名单，不再记录该粉丝</label><label class="fan-check"><input name="confirm" type="checkbox" required />我确认永久删除</label>`,
        read: (value) => ({
          id,
          confirm: value.elements.confirm.checked,
          suppress: value.elements.suppress.checked,
        }),
      },
      async (payload) => {
        await request('delete', payload);
        await onDeleted();
      },
    );
  }

  async function handle(name, profile, selection, recordId) {
    if (name === 'edit-profile') {
      editProfile(profile);
    } else if (name.startsWith('new-')) {
      editRecord(profile.id, name.slice(4));
    } else if (name === 'edit-record') {
      const record = profile.records.find((item) => item.id === recordId);
      if (record) editRecord(profile.id, record.kind, record);
    } else if (name.startsWith('resolve-')) {
      const saved = await request('resolve-membership', {
        profileId: profile.id,
        id: recordId,
        choice: name.slice(8),
      });
      await onChanged(saved, profile.id, selection);
    } else if (name === 'archive') {
      const saved = await request('save', {
        id: profile.id,
        revision: profile.revision,
        archived: !profile.archived,
      });
      onArchived(saved, selection);
      toast(saved.archived ? '已归档，资料仍保留。可在‘已归档’中恢复。' : '已恢复到主列表，可在‘当前档案’中查看。');
      await reload();
    } else if (name === 'suppress') {
      await request('suppress', { id: profile.id, revision: profile.revision });
      onSuppressed(profile.id, selection);
      toast('已加入黑名单，相关档案与提醒已隐藏。可在设置中解除屏蔽。');
      await reload();
    } else if (name === 'favorite') {
      const saved = await request('save', {
        id: profile.id,
        revision: profile.revision,
        favorite: !profile.favorite,
      });
      await onChanged(saved, profile.id, selection);
    } else if (name === 'delete') {
      deleteProfile(profile);
    } else {
      return false;
    }
    return true;
  }

  return { editProfile, editRecord, deleteProfile, handle };
}
