// Rejected text belongs to the open editor. Only accepted configs enter scene documents.
export function createRejectedTextBoxEdits() {
  const scenes = new Map();
  return {
    forScene(id) {
      if (!scenes.has(id)) scenes.set(id, new Map());
      return scenes.get(id);
    },
    messageFor(document) {
      const edits = scenes.get(document.id);
      if (!edits?.size) return '';
      for (const item of document.items) {
        const edit = item.type === 'text-box' && edits.get(item.id);
        if (edit) return `${item.name}：${edit.message}`;
      }
      return '';
    },
  };
}
