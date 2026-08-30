'use strict';

const PROTOCOL_PREFERENCES = Object.freeze([
  'auto',
  'responses',
  'chat_completions',
]);

function normalizeProtocolPreference(value) {
  const normalized = String(value ?? 'auto')
    .trim()
    .toLowerCase();
  if (!PROTOCOL_PREFERENCES.includes(normalized)) {
    throw new Error(
      'modelApiProtocol 必须是 auto、responses 或 chat_completions。',
    );
  }
  return normalized;
}

function resolveModelEndpoint(value, protocolPreference = 'auto') {
  const input = String(value || '').trim();
  const url = new URL(input);
  const preference = normalizeProtocolPreference(protocolPreference);
  const path = url.pathname.replace(/\/+$/, '');
  const officialDeepSeek = isOfficialDeepSeekUrl(url);

  if (path.endsWith('/chat/completions')) {
    return {
      url: input,
      protocol: 'chat_completions',
      adapted: true,
      officialDeepSeek,
    };
  }
  if (path.endsWith('/responses')) {
    return {
      url: input,
      protocol: 'responses',
      adapted: false,
      officialDeepSeek,
    };
  }
  const isBasePath =
    !url.search && !url.hash && (path === '' || path.endsWith('/v1'));
  if (
    preference === 'responses' ||
    preference === 'chat_completions' ||
    (preference === 'auto' && isBasePath)
  ) {
    const protocol = preference === 'auto' ? 'chat_completions' : preference;
    const suffix =
      protocol === 'responses' ? '/responses' : '/chat/completions';
    const basePath = path || (officialDeepSeek ? '' : '/v1');
    url.pathname = `${basePath}${suffix}`;
    return {
      url: url.toString(),
      protocol,
      adapted: true,
      officialDeepSeek,
    };
  }
  return {
    url: input,
    protocol: 'responses',
    adapted: false,
    officialDeepSeek,
  };
}

function resolveModelsEndpoint(value, protocolPreference = 'auto') {
  const input = String(value || '').trim();
  const url = new URL(input);
  const path = url.pathname.replace(/\/+$/, '');
  const endpoint = resolveModelEndpoint(input, protocolPreference);
  if (path.endsWith('/chat/completions')) {
    url.pathname = `${path.slice(0, -'/chat/completions'.length)}/models`;
  } else if (path.endsWith('/responses')) {
    url.pathname = `${path.slice(0, -'/responses'.length)}/models`;
  } else if (path.endsWith('/models')) {
    url.pathname = path;
  } else if (!endpoint.adapted) {
    url.pathname = `${path}/models`;
  } else {
    const endpointPath = new URL(endpoint.url).pathname.replace(/\/+$/, '');
    url.pathname = `${endpointPath.slice(
      0,
      endpoint.protocol === 'responses'
        ? -'/responses'.length
        : -'/chat/completions'.length,
    )}/models`;
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function describeModelEndpoint(
  value,
  protocolPreference = 'auto',
  providerPreference = 'auto',
) {
  const input = String(value || '').trim();
  if (!input) {
    return {
      protocol: 'unconfigured',
      provider: 'unconfigured',
      webSearchMode: 'unconfigured',
      reasoningMode: 'unconfigured',
    };
  }
  const endpoint = resolveModelEndpoint(input, protocolPreference);
  const configuredProvider = String(providerPreference || 'auto')
    .trim()
    .toLowerCase();
  const provider = [
    'deepseek',
    'openai',
    'anthropic',
    'gemini',
    'custom',
  ].includes(configuredProvider)
    ? configuredProvider
    : endpoint.officialDeepSeek
      ? 'deepseek'
      : 'custom';
  return {
    protocol: endpoint.protocol,
    provider,
    webSearchMode:
      endpoint.protocol === 'responses' ? 'hosted' : 'local_function',
    reasoningMode:
      provider === 'deepseek'
        ? 'deepseek_effort'
        : provider === 'gemini'
          ? 'gemini_effort'
          : endpoint.protocol === 'responses'
            ? 'effort'
            : 'provider_managed',
  };
}

function isOfficialDeepSeekUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  return (
    url.protocol === 'https:' &&
    url.hostname === 'api.deepseek.com' &&
    !url.port
  );
}

module.exports = {
  PROTOCOL_PREFERENCES,
  normalizeProtocolPreference,
  resolveModelEndpoint,
  resolveModelsEndpoint,
  describeModelEndpoint,
  isOfficialDeepSeekUrl,
};
