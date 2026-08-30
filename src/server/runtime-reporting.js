'use strict';

function logGiftDelivery(trigger, item, cleanText) {
  console.log(
    `[Bilibili][GiftDelivery] action=broadcast trigger=${trigger} trace=${JSON.stringify(
      {
        eventId: Number(item && item.id) || 0,
        platformId: cleanText(item && item.platform_id),
        cmd: cleanText(item && item.cmd),
        uid: cleanText(item && item.uid),
        userName: cleanText(item && item.user_name),
        giftId: cleanText(item && item.gift_id),
        giftName: cleanText(item && item.gift_name),
        num: Number(item && item.num) || 1,
        totalPrice: Number(item && item.total_price) || 0,
      },
    )}`,
  );
}

module.exports = { logGiftDelivery };
