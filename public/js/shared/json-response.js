function responseError(message, response, payload, code = payload?.code) {
  return Object.assign(new Error(message), { status: response.status, code, payload });
}

export async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  if (!text) {
    if (!response.ok) throw responseError(`${fallbackMessage}（HTTP ${response.status}）`, response);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    const preview = text.replace(/\s+/g, ' ').slice(0, 80);
    throw responseError(
      `${fallbackMessage}：服务返回了非 JSON 内容（HTTP ${response.status}${preview ? `，${preview}` : ''}）`,
      response, undefined, 'INVALID_RESPONSE',
    );
  }
}

export function assertApiResponse(response, payload, fallbackMessage) {
  if (!response.ok || !payload?.ok) {
    throw responseError(payload?.error || fallbackMessage, response, payload);
  }
  return payload;
}

export async function readApiResponse(response, fallbackMessage) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (error?.name !== 'SyntaxError') throw error;
    throw responseError(`${fallbackMessage}：服务返回了非 JSON 内容（HTTP ${response.status}）`, response, undefined, 'INVALID_RESPONSE');
  }
  return assertApiResponse(response, payload, fallbackMessage);
}
