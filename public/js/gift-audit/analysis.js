// Gift audit parsing and matching. This module intentionally has no DOM dependencies.

export function parseBubbleHtml(html) {
  const results = [];
  let match;

  // 匹配 super-gift-item 和普通 gift-item 气泡
  const itemFragments = [];
  const giftItemRegex =
    /<div[^>]*class="[^"]*(?:super-)?gift-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:super-)?gift-item[^"]*"|<\/div>\s*<\/div>\s*$)/g;
  while ((match = giftItemRegex.exec(html)) !== null) {
    itemFragments.push(match[1] || match[0]);
  }

  // 如果上述正则没匹配到，尝试按 user-name 分段
  if (itemFragments.length === 0) {
    const segments = html.split(/<div[^>]*class="[^"]*user-name[^"]*"[^>]*>/);
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      const userName = (segment.match(/^([^<]+)/) || ['', ''])[1].trim();
      const giftNameMatch = segment.match(/<span[^>]*class="[^"]*gift-name[^"]*"[^>]*>([^<]+)<\/span>/);
      const giftName = giftNameMatch ? giftNameMatch[1].trim() : '';
      const giftFrameMatch = segment.match(/gift-(\d+)-\d+/);
      const giftId = giftFrameMatch ? giftFrameMatch[1] : '';

      const comboCount = parseComboCount(segment);

      if (userName && giftName) {
        results.push({ userName, giftName, giftId, comboCount });
      }
    }
    return results;
  }

  const seen = new Set();
  for (const itemHtml of itemFragments) {
    // 提取用户名
    const userNameMatch = itemHtml.match(/<div[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/div>/);
    const userName = userNameMatch ? userNameMatch[1].trim() : '';

    // 提取礼物名
    const giftNameMatch = itemHtml.match(/<span[^>]*class="[^"]*gift-name[^"]*"[^>]*>([^<]+)<\/span>/);
    const giftName = giftNameMatch ? giftNameMatch[1].trim() : '';

    // 提取 gift ID（从 gift-XXXXX-50 格式）
    const giftFrameMatch = itemHtml.match(/gift-(\d+)-\d+/);
    const giftId = giftFrameMatch ? giftFrameMatch[1] : '';

    const comboCount = parseComboCount(itemHtml);

    if (userName && giftName) {
      // 去重：相同用户+相同礼物+相同连击数视为同一条
      const key = JSON.stringify([userName, giftName, comboCount]);
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ userName, giftName, giftId, comboCount });
      }
    }
  }
  return results;
}

function parseComboCount(itemHtml) {
  let comboCount = 1;
  const numbersMatch = itemHtml.match(/<div[^>]*class="[^"]*numbers[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (numbersMatch) {
    const digits = [];
    const digitRegex = /number-(\d)/g;
    let digitMatch;
    while ((digitMatch = digitRegex.exec(numbersMatch[1])) !== null) {
      digits.push(digitMatch[1]);
    }
    if (digits.length > 0) comboCount = parseInt(digits.join(''), 10) || 1;
  }
  return comboCount;
}

export function crossReference(bubbles, servers, captureTimeMs) {
  const results = [];
  const matchedServerIndexes = new Set();
  const TIME_WINDOW_MS = 5 * 60 * 1000; // 5分钟时间窗口
  const serverInputs = servers.map((server) => {
    const userName = normalizeName(server.user_name || '');
    const giftName = normalizeName(server.gift_name || '');
    const timeDiff = server.created_at
      ? Math.abs(new Date(server.created_at).getTime() - captureTimeMs)
      : NaN;
    return {
      userName,
      giftName,
      userChars: new Set(userName.split('')),
      giftChars: new Set(giftName.split('')),
      giftId: String(server.gift_id || ''),
      count: Number(server.num || 1),
      timeScore: timeDiff < TIME_WINDOW_MS ? Math.round((1 - timeDiff / TIME_WINDOW_MS) * 10) : 0,
    };
  });

  for (const bubble of bubbles) {
    let bestMatch = null;
    let bestScore = 0;
    const bubbleUser = normalizeName(bubble.userName);
    const bubbleGift = normalizeName(bubble.giftName);
    const bubbleUserChars = new Set(bubbleUser.split(''));
    const bubbleGiftChars = new Set(bubbleGift.split(''));

    for (let i = 0; i < servers.length; i++) {
      if (matchedServerIndexes.has(i)) continue;
      const server = servers[i];
      const input = serverInputs[i];

      // 计算匹配分数
      let score = 0;

      // 用户名匹配（模糊）
      const serverUser = input.userName;
      if (bubbleUser === serverUser) {
        score += 40;
      } else if (bubbleUser.includes(serverUser) || serverUser.includes(bubbleUser)) {
        score += 25;
      } else {
        // 计算字符重叠度
        const overlap = charOverlap(bubbleUserChars, input.userChars);
        if (overlap > 0.7) score += 15;
        else if (overlap > 0.5) score += 8;
        else continue; // 用户名完全不匹配，跳过
      }

      // 礼物名匹配
      const serverGift = input.giftName;
      if (bubbleGift === serverGift) {
        score += 40;
      } else if (bubbleGift.includes(serverGift) || serverGift.includes(bubbleGift)) {
        score += 30;
      } else {
        const overlap = charOverlap(bubbleGiftChars, input.giftChars);
        if (overlap > 0.7) score += 20;
        else if (overlap > 0.5) score += 10;
        else continue; // 礼物名完全不匹配
      }

      // Gift ID 匹配（精确）
      if (bubble.giftId && input.giftId === bubble.giftId) {
        score += 15;
      }

      // 连击数匹配
      if (bubble.comboCount > 0 && input.count === bubble.comboCount) {
        score += 10;
      } else if (Math.abs(input.count - bubble.comboCount) <= 2) {
        score += 5;
      }

      // 时间接近度加分
      score += input.timeScore;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { serverIndex: i, server, score };
      }
    }

    if (bestMatch && bestScore >= 50) {
      matchedServerIndexes.add(bestMatch.serverIndex);
      results.push({
        source: 'bubble',
        userName: bubble.userName,
        giftName: bubble.giftName,
        giftId: bubble.giftId,
        count: bubble.comboCount,
        price: bestMatch.server.total_price || 0,
        matchInfo: `匹配: ${bestMatch.server.user_name || '?'} · ${bestMatch.server.gift_name || '?'} · 分数=${bestMatch.score}`,
        status: 'match',
        serverId: bestMatch.server.id,
      });
    } else {
      results.push({
        source: 'bubble',
        userName: bubble.userName,
        giftName: bubble.giftName,
        giftId: bubble.giftId,
        count: bubble.comboCount,
        price: 0,
        matchInfo: bestMatch
          ? `最佳候选: ${bestMatch.server.user_name || '?'} · 分数=${bestMatch.score} (不足50)`
          : '无匹配候选项',
        status: 'miss',
      });
    }
  }

  // 未匹配的服务器记录（气泡中没有的）
  for (let i = 0; i < servers.length; i++) {
    if (!matchedServerIndexes.has(i)) {
      const s = servers[i];
      results.push({
        source: 'server',
        userName: s.user_name || '观众',
        giftName: s.gift_name || '未知',
        giftId: String(s.gift_id || ''),
        count: s.num || 1,
        price: s.total_price || 0,
        matchInfo: `WebSocket 记录 · ${(s.created_at || '').slice(11, 19)}`,
        status: 'extra',
      });
    }
  }

  return results;
}

function normalizeName(name) {
  return (name || '').trim().replace(/\s+/g, '').toLowerCase();
}

function charOverlap(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let overlap = 0;
  for (const c of setA) {
    if (setB.has(c)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}
