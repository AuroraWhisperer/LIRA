import { profileForm, recordForm } from './forms.js';
import { html } from './view.js';

export function createFanProfileActions({ request, openForm, onProfile, onDeleted }) {
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
        fields: `<p class="fan-field-wide">即将删除 ${html(profile.alias || profile.platformName)}。建议先保存完整备份。</p><label class="fan-check"><input name="suppress" type="checkbox" checked />不再为这位粉丝自动建档</label><label class="fan-check"><input name="confirm" type="checkbox" required />我确认永久删除</label>`,
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

  return { editProfile, editRecord, deleteProfile };
}
