// 编写人：Aurora
// B站礼物全屏特效配置：拉取并缓存礼物 ID 到可信 MP4 素材的映射。
'use strict';

const EFFECT_API_URL = 'https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2' +
  '?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0';
const DEFAULT_REFRESH_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RETRY_MS = 60 * 1000;
const MAX_LAYOUT_DIMENSION = 8192;
const TRUSTED_EFFECT_HOSTS = ['hdslb.com', 'bilibili.com', 'bilivideo.com'];

function pickEffect(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.reduce((best, entry) => (
    Number(entry?.id) > Number(best?.id) ? entry : best
  ), entries[0]);
}

function isTrustedEffectUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const hostname = url.hostname.toLowerCase();
    return TRUSTED_EFFECT_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch (_) {
    return false;
  }
}

function normalizeEffectUrl(value) {
  const raw = String(value || '').trim();
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  return isTrustedEffectUrl(normalized) ? normalized : '';
}

function parseEffectLayout(payload) {
  const info = payload?.info;
  const videoWidth = Number(info?.videoW);
  const videoHeight = Number(info?.videoH);
  if (!Number.isInteger(videoWidth) || !Number.isInteger(videoHeight)
    || videoWidth <= 0 || videoHeight <= 0
    || videoWidth > MAX_LAYOUT_DIMENSION || videoHeight > MAX_LAYOUT_DIMENSION) {
    throw new Error('礼物特效视频尺寸无效');
  }

  const rgbFrame = parseEffectFrame(info.rgbFrame, videoWidth, videoHeight);
  const alphaFrame = parseEffectFrame(info.aFrame, videoWidth, videoHeight);
  return Object.freeze({ videoWidth, videoHeight, rgbFrame, alphaFrame });
}

function parseEffectFrame(value, videoWidth, videoHeight) {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('礼物特效画面坐标无效');
  }
  const frame = value.map(Number);
  if (!frame.every(Number.isInteger)) throw new Error('礼物特效画面坐标无效');
  const [x, y, width, height] = frame;
  if (x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > videoWidth || y + height > videoHeight) {
    throw new Error('礼物特效画面坐标无效');
  }
  return Object.freeze(frame);
}

function buildEffectMap(payload) {
  const confList = payload?.data?.full_sc_resource?.conf_list;
  const byGiftId = new Map();
  if (!Array.isArray(confList)) return byGiftId;

  for (const raw of confList) {
    const mp4Url = normalizeEffectUrl(raw?.web_mp4);
    const layoutUrl = normalizeEffectUrl(raw?.web_mp4_json);
    if (!mp4Url || !layoutUrl) continue;

    const effect = Object.freeze({
      effectId: Number(raw.id) || 0,
      type: Number(raw.type) || 0,
      mp4Url,
      layoutUrl,
      md5: String(raw.web_mp4_md5 || ''),
      fileSize: Math.max(0, Number(raw.web_mp4_file_size) || 0)
    });
    const giftIds = Array.isArray(raw.bind_gift_ids) ? raw.bind_gift_ids : [];
    for (const value of giftIds) {
      const giftId = Number(value);
      if (!Number.isSafeInteger(giftId) || giftId <= 0) continue;
      const existing = byGiftId.get(giftId);
      if (!existing || effect.effectId > existing.effectId) byGiftId.set(giftId, effect);
    }
  }

  return byGiftId;
}

function createGiftEffectResolver(options = {}) {
  const fetchJson = options.fetchJson || defaultFetchJson;
  const fetchLayoutJson = options.fetchLayoutJson || defaultFetchLayoutJson;
  const now = options.now || Date.now;
  const refreshMs = numberOption(options.refreshMs, DEFAULT_REFRESH_MS);
  const retryMs = numberOption(options.retryMs, DEFAULT_RETRY_MS);
  let byGiftId = new Map();
  let fetchedAt = 0;
  let failedAt = 0;
  let pending = null;
  const layoutByUrl = new Map();
  const pendingLayoutByUrl = new Map();
  const failedLayoutAtByUrl = new Map();

  function isFresh(currentMs) {
    return fetchedAt > 0 && currentMs - fetchedAt < refreshMs;
  }

  async function getEffectMap() {
    const currentMs = now();
    if (isFresh(currentMs)) return byGiftId;
    if (failedAt > 0 && currentMs - failedAt < retryMs) return byGiftId;
    if (pending) return pending;

    pending = fetchJson('gift_effect_config', EFFECT_API_URL)
      .then(({ payload }) => buildEffectMap(payload))
      .then((nextMap) => {
        byGiftId = nextMap;
        fetchedAt = now();
        failedAt = 0;
        console.log(`[Bilibili][GiftEffect] 特效配置已更新：${nextMap.size} 个礼物可播放全屏特效`);
        return byGiftId;
      })
      .catch((error) => {
        failedAt = now();
        console.warn(`[Bilibili][GiftEffect] 特效配置拉取失败，沿用旧缓存：${error.message || error}`);
        return byGiftId;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  function resolve(giftId) {
    const id = Number(giftId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return byGiftId.get(id) || null;
  }

  async function getEffectLayout(layoutUrl) {
    if (layoutByUrl.has(layoutUrl)) return layoutByUrl.get(layoutUrl);
    if (pendingLayoutByUrl.has(layoutUrl)) return pendingLayoutByUrl.get(layoutUrl);
    const failedAtMs = failedLayoutAtByUrl.get(layoutUrl);
    if (failedAtMs !== undefined && now() - failedAtMs < retryMs) return null;

    const request = Promise.resolve()
      .then(() => fetchLayoutJson('gift_effect_layout', layoutUrl))
      .then(({ payload }) => parseEffectLayout(payload))
      .then((layout) => {
        layoutByUrl.set(layoutUrl, layout);
        failedLayoutAtByUrl.delete(layoutUrl);
        return layout;
      })
      .catch((error) => {
        failedLayoutAtByUrl.set(layoutUrl, now());
        console.warn(`[Bilibili][GiftEffect] 特效坐标拉取失败：${error.message || error}`);
        return null;
      })
      .finally(() => {
        pendingLayoutByUrl.delete(layoutUrl);
      });
    pendingLayoutByUrl.set(layoutUrl, request);
    return request;
  }

  async function resolveEffect(giftId) {
    await getEffectMap();
    const effect = resolve(giftId);
    if (!effect) return null;
    if (!effect.layoutUrl) return effect;

    const layout = await getEffectLayout(effect.layoutUrl);
    return layout ? Object.freeze({ ...effect, layout }) : null;
  }

  return { getEffectMap, resolve, resolveEffect };
}

async function buildGiftEffectEvent(item, resolver) {
  const giftId = Number(item && (item.giftId ?? item.gift_id));
  if (!Number.isSafeInteger(giftId) || giftId <= 0) return null;

  let effect = null;
  try {
    if (typeof resolver.resolveEffect === 'function') {
      effect = await resolver.resolveEffect(giftId);
    } else {
      const effectMap = await resolver.getEffectMap();
      effect = effectMap.get(giftId) || null;
    }
  } catch (_) {
    return null;
  }
  if (!effect) return null;

  return {
    type: 'gift:effect',
    eventId: Number(item.id) || 0,
    giftId,
    giftName: String(item.giftName ?? item.gift_name ?? '').trim() || '礼物',
    num: Math.max(1, Number(item.num) || 1),
    unitPrice: Math.max(0, Number(item.unitPrice ?? item.unit_price) || 0),
    userName: String(item.userName ?? item.user_name ?? '').trim(),
    effect
  };
}

function numberOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function defaultFetchJson(endpointName, url) {
  const result = await fetchJsonDocument(endpointName, url);
  const { payload, response } = result;
  if (Number(payload.code) !== 0) {
    throw new Error(`Bilibili API ${endpointName} failed: http=${response.status} code=${payload.code} message=${payload.message || payload.msg || ''}`);
  }
  return result;
}

async function defaultFetchLayoutJson(endpointName, url) {
  return fetchJsonDocument(endpointName, url);
}

async function fetchJsonDocument(endpointName, url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': 'https://live.bilibili.com',
      'Referer': 'https://live.bilibili.com/'
    }
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili API ${endpointName} returned non-JSON response. HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(`Bilibili API ${endpointName} failed: http=${response.status}`);
  }
  return { payload, response };
}

module.exports = {
  EFFECT_API_URL,
  DEFAULT_REFRESH_MS,
  DEFAULT_RETRY_MS,
  pickEffect,
  isTrustedEffectUrl,
  parseEffectLayout,
  buildEffectMap,
  createGiftEffectResolver,
  buildGiftEffectEvent
};
