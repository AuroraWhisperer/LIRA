'use strict';

// Runs only inside the isolated, unprivileged official Doubao page. Protocol
// reference: wangchuxiaoji-oss/doubao2api. Context reset needs upstream acceptance
// testing; the owner also requires an acknowledgement of a new section.
async function requestDoubaoText({ text, timeoutMs, conversationId, sectionId }) {
  if (location.origin !== 'https://www.doubao.com') return { error: 'DOUBAO_UNAVAILABLE' };
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    function storedId(key) {
      try { return JSON.parse(localStorage.getItem(key) || '{}').web_id || ''; } catch { return ''; }
    }
    const params = new URLSearchParams({
      aid: '497858', real_aid: '497858', device_platform: 'web', language: 'zh',
      samantha_web: '1', 'use-olympus-account': '1', version_code: '20800',
      device_id: storedId('samantha_web_web_id'), web_id: storedId('__tea_cache_tokens_497858'),
      tea_uuid: storedId('__tea_cache_tokens_497858'), web_tab_id: crypto.randomUUID(),
    });
    const payload = {
      client_meta: { local_conversation_id: conversationId ? '' : `local_${crypto.randomUUID()}`, conversation_id: conversationId || '', bot_id: '7338286299411103781', last_section_id: sectionId || '', last_message_index: null },
      messages: [{
        local_message_id: crypto.randomUUID(), message_status: 0,
        content_block: [{ block_type: 10000, block_id: crypto.randomUUID(), parent_id: '', meta_info: [], append_fields: [],
          content: { text_block: { text, icon_url: '', icon_url_dark: '', summary: '' }, pc_event_block: '' } }],
      }],
      option: {
        create_time_ms: Date.now(), need_create_conversation: !conversationId, click_clear_context: Boolean(conversationId), need_deep_think: 0, agent_mode: 2,
        is_audio: false, tts_switch: false, answer_with_suggest: false, unique_key: crypto.randomUUID(), start_seq: 0,
        sse_recv_event_options: { support_chunk_delta: true },
        model_config: { model_item_key: '0', model_extra_params: {}, reasoning_effort: 3 },
      },
      ext: { agent_mode: '2', use_deep_think: '0' },
    };
    const csrf = document.cookie.split('; ').find(cookie => cookie.startsWith('passport_csrf_token='))?.slice('passport_csrf_token='.length);
    const response = await fetch(`/chat/completion?${params}`, {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'agw-js-conv': 'str', ...(csrf ? { 'x-tt-passport-csrf-token': csrf } : {}) },
      body: JSON.stringify(payload),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';
    let bytes = 0;
    let pendingEvents = '';
    let firstTextMs = null;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2 * 1024 * 1024) { await reader.cancel(); return { error: 'DOUBAO_EMPTY_REPLY' }; }
      const chunk = decoder.decode(part.value, { stream: true });
      body += chunk;
      if (firstTextMs === null) {
        const boundaryStart = Math.max(0, pendingEvents.length - 3);
        pendingEvents += chunk;
        if (!/\r?\n\r?\n/u.test(pendingEvents.slice(boundaryStart))) continue;
        const frames = pendingEvents.split(/\r?\n\r?\n/u);
        pendingEvents = frames.pop();
        for (const frame of frames) {
          const lines = frame.split(/\r?\n/u);
          const type = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          let value;
          try { value = JSON.parse(data); } catch { continue; }
          const hasText = text => typeof text === 'string' && Boolean(text.trim());
          const isTextBlock = block => block.block_type === 10000 && hasText(block.content?.text_block?.text);
          const delta = type === 'CHUNK_DELTA' && (value.block_type === undefined || value.block_type === 10000) && hasText(value.text);
          const initial = type === 'STREAM_MSG_NOTIFY' && Array.isArray(value.content?.content_block) && value.content.content_block.some(isTextBlock);
          const patch = type === 'STREAM_CHUNK' && Array.isArray(value.patch_op) && value.patch_op.some(operation => Array.isArray(operation.patch_value?.content_block) && operation.patch_value.content_block.some(isTextBlock));
          if (delta || initial || patch) { firstTextMs = Math.round(performance.now() - startedAt); pendingEvents = ''; break; }
        }
      }
    }
    body += decoder.decode();
    return { status: response.status, body, firstTextMs };
  } catch {
    return { error: controller.signal.aborted ? 'DOUBAO_TIMEOUT' : 'DOUBAO_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestDoubaoText };
