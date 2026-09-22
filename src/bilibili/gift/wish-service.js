'use strict';

const { randomUUID } = require('node:crypto');
const { shanghaiDayStart, queryError } = require('./history-filters');
const { createGiftWishSession } = require('./wish-session');

const GUARD_WISH_GIFTS = [
  {
    id: 'guard-3',
    name: '舰长',
    giftCategory: 'guard',
    imagePath: '/img/admin/gifts/bilibili-guard-captain.webp',
  },
  {
    id: 'guard-2',
    name: '提督',
    giftCategory: 'guard',
    imagePath: '/img/admin/gifts/bilibili-guard-prefect.webp',
  },
  {
    id: 'guard-1',
    name: '总督',
    giftCategory: 'guard',
    imagePath: '/img/admin/gifts/bilibili-guard-governor.webp',
  },
];
const PERIODS = new Set(['long', 'day', 'session']);
const DISPLAY_STYLES = new Set(['card', 'text', 'circle']);

function createGiftWishService({ store, gifts, catalog, getRoomId, now = Date.now, readRoom }) {
  const sessions = createGiftWishSession({ store, now, readRoom });
  const invalid = (message) => queryError('INVALID_GIFT_WISH', message);

  function scope(viewRevision) {
    const source = gifts.getActiveSource();
    if (!Number.isSafeInteger(source?.sourceId) || source.sourceId < 1 || source.syncState === 'SOURCE_SWITCHING') {
      throw queryError('GIFT_SOURCE_UNAVAILABLE', '礼物来源尚未就绪，请连接主播账号后重试。');
    }
    const revision = gifts.getViewRevision();
    if (viewRevision !== undefined && viewRevision !== revision) {
      throw queryError('GIFT_VIEW_STALE', '礼物来源已变化，请刷新许愿列表后重试。');
    }
    return { source, revision };
  }

  function catalogItems() {
    return [
      ...GUARD_WISH_GIFTS,
      ...(catalog.getGlobalSnapshot?.()?.gifts || []),
      ...(catalog.getSnapshot()?.gifts || []),
    ];
  }

  async function getSnapshot() {
    const { source, revision } = scope();
    const session = await sessions.get(source.sourceId, String(getRoomId() || ''));
    scope(revision);
    const asOf = new Date(now()).toISOString();
    const day = new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    const artwork = new Map(catalogItems().map((gift) => [gift.variantId || String(gift.id), gift.imagePath]));
    const items = store.list(source.sourceId).map((wish) => {
      const start =
        wish.period === 'long'
          ? wish.created_at
          : wish.period === 'day'
            ? shanghaiDayStart(day)
            : session.state === 'offline' || session.ended_at
              ? null
              : session.started_at;
      const end = wish.period === 'session' && session.stale ? session.checked_at : asOf;
      const count = store.count(source.sourceId, wish, start, end);
      return {
        id: wish.id,
        period: wish.period,
        giftId: wish.gift_id,
        giftName: wish.gift_name,
        giftCategory: wish.gift_category,
        imagePath: artwork.get(wish.variant_id || wish.gift_id) || wish.image_path,
        target: wish.target,
        label: wish.label,
        displayStyle: wish.display_style,
        textTemplate: wish.text_template,
        createdAt: wish.created_at,
        count,
        remaining: Math.max(0, wish.target - count),
        completed: count >= wish.target,
        progress: Math.min(100, Math.floor((count / wish.target) * 100)),
        startAt: start || null,
      };
    });
    return {
      viewRevision: revision,
      asOf,
      day,
      partial: source.partial !== false,
      session: {
        state: session.state,
        stale: session.stale,
        startedAt: session.started_at || null,
        endedAt: session.ended_at || null,
      },
      guards: GUARD_WISH_GIFTS,
      items,
    };
  }

  function save(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('许愿参数无效。');
    const { source } = scope(input.viewRevision || null);
    if (!Number.isSafeInteger(input.target) || input.target < 1 || input.target > 999999999) {
      throw invalid('目标数量必须是 1–999999999 的整数。');
    }
    if (typeof input.label !== 'string' || [...input.label].length > 40) throw invalid('许愿说明最多 40 个字。');
    const label = input.label.trim();
    if (input.displayStyle !== undefined && !DISPLAY_STYLES.has(input.displayStyle))
      throw invalid('请选择有效的展示样式。');
    if (
      input.textTemplate !== undefined &&
      (typeof input.textTemplate !== 'string' || [...input.textTemplate].length > 200)
    )
      throw invalid('展示文字最多 200 个字。');
    const textTemplate = input.textTemplate?.trim();
    if (input.id !== undefined) {
      if (
        typeof input.id !== 'string' ||
        !store.update(source.sourceId, input.id, {
          target: input.target,
          label,
          displayStyle: input.displayStyle,
          textTemplate,
        })
      )
        throw invalid('这条许愿已不存在，请刷新。');
      return { id: input.id };
    }
    if (!PERIODS.has(input.period)) throw invalid('请选择有效的许愿周期。');
    if (store.list(source.sourceId).length >= 30) throw invalid('最多保留 30 条许愿，请先删除不需要的许愿。');
    const gift = catalogItems().find((item) => (item.variantId || String(item.id)) === input.giftKey);
    if (!gift) throw invalid('礼物已不在目录中，请重新选择。');
    if (gift.giftCategory !== 'guard' && !gift.variantId) throw invalid('礼物资料尚未同步，请刷新礼物库后重新选择。');
    const wish = {
      id: randomUUID(),
      period: input.period,
      giftId: String(gift.id),
      variantId: gift.variantId || null,
      giftName: gift.name,
      giftCategory: gift.giftCategory || 'directGift',
      imagePath: gift.imagePath || '',
      target: input.target,
      label,
      displayStyle: input.displayStyle || 'card',
      textTemplate: textTemplate || '',
      createdAt: new Date(now()).toISOString(),
    };
    store.insert(source.sourceId, wish);
    return { id: wish.id };
  }

  function remove(input) {
    const { source } = scope(input?.viewRevision || null);
    if (typeof input?.id !== 'string' || !store.remove(source.sourceId, input.id))
      throw invalid('这条许愿已不存在，请刷新。');
    return { removed: true };
  }

  return { getSnapshot, save, remove };
}

module.exports = { createGiftWishService };
