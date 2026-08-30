// Gift audit parsing and matching. This module intentionally has no DOM dependencies.

export function parseBubbleHtml(html) {
  const results = [];
  // 匹配每个 super-gift-item
  const itemRegex =
    /<div[^>]*class="[^"]*super-gift-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*super-gift-item[^"]*"|$)/g;
  let match;

  // 也尝试匹配 gift-item（非 super 的普通气泡）
  const allItems = [];
  const giftItemRegex =
    /<div[^>]*class="[^"]*(?:super-)?gift-item[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:super-)?gift-item[^"]*"|<\/div>\s*<\/div>\s*$)/g;
  while ((match = giftItemRegex.exec(html)) !== null) {
    allItems.push(match[1] || match[0]);
  }

  // 如果上述正则没匹配到，尝试按 user-name 分段
  if (allItems.length === 0) {
    const segments = html.split(/<div[^>]*class="[^"]*user-name[^"]*"[^>]*>/);
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const userName = (seg.match(/^([^<]+)/) || ['', ''])[1].trim();
      const giftNameMatch = seg.match(
        /<span[^>]*class="[^"]*gift-name[^"]*"[^>]*>([^<]+)<\/span>/,
      );
      const giftName = giftNameMatch ? giftNameMatch[1].trim() : '';
      const giftFrameMatch = seg.match(/gift-(\d+)-\d+/);
      const giftId = giftFrameMatch ? giftFrameMatch[1] : '';

      // 解析连击数字
      let comboCount = 1;
      const numbersMatch = seg.match(
        /<div[^>]*class="[^"]*numbers[^"]*"[^>]*>([\s\S]*?)<\/div>/,
      );
      if (numbersMatch) {
        const digits = [];
        const digitRegex = /number-(\d)/g;
        let dMatch;
        while ((dMatch = digitRegex.exec(numbersMatch[1])) !== null) {
          digits.push(dMatch[1]);
        }
        if (digits.length > 0) comboCount = parseInt(digits.join(''), 10) || 1;
      }

      if (userName && giftName) {
        results.push({ userName, giftName, giftId, comboCount });
      }
    }
    return results;
  }

  for (const itemHtml of allItems) {
    // 提取用户名
    const userNameMatch = itemHtml.match(
      /<div[^>]*class="[^"]*user-name[^"]*"[^>]*>([^<]+)<\/div>/,
    );
    const userName = userNameMatch ? userNameMatch[1].trim() : '';

    // 提取礼物名
    const giftNameMatch = itemHtml.match(
      /<span[^>]*class="[^"]*gift-name[^"]*"[^>]*>([^<]+)<\/span>/,
    );
    const giftName = giftNameMatch ? giftNameMatch[1].trim() : '';

    // 提取 gift ID（从 gift-XXXXX-50 格式）
    const giftFrameMatch = itemHtml.match(/gift-(\d+)-\d+/);
    const giftId = giftFrameMatch ? giftFrameMatch[1] : '';

    // 提取连击数
    let comboCount = 1;
    const numbersMatch = itemHtml.match(
      /<div[^>]*class="[^"]*numbers[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    if (numbersMatch) {
      const digits = [];
      const digitRegex = /number-(\d)/g;
      let dMatch;
      while ((dMatch = digitRegex.exec(numbersMatch[1])) !== null) {
        digits.push(dMatch[1]);
      }
      if (digits.length > 0) comboCount = parseInt(digits.join(''), 10) || 1;
    }

    if (userName && giftName) {
      // 去重：相同用户+相同礼物+相同连击数视为同一条
      const dup = results.find(
        (r) =>
          r.userName === userName &&
          r.giftName === giftName &&
          r.comboCount === comboCount,
      );
      if (!dup) {
        results.push({ userName, giftName, giftId, comboCount });
      }
    }
  }
  return results;
}

export function crossReference(bubbles, servers, captureTimeMs) {
  const results = [];
  const serverMatched = new Set();
  const TIME_WINDOW_MS = 5 * 60 * 1000; // 5分钟时间窗口

  for (const bubble of bubbles) {
    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < servers.length; i++) {
      if (serverMatched.has(i)) continue;
      const server = servers[i];

      // 计算匹配分数
      let score = 0;

      // 用户名匹配（模糊）
      const bubbleUser = normalizeName(bubble.userName);
      const serverUser = normalizeName(server.user_name || '');
      if (bubbleUser === serverUser) {
        score += 40;
      } else if (
        bubbleUser.includes(serverUser) ||
        serverUser.includes(bubbleUser)
      ) {
        score += 25;
      } else {
        // 计算字符重叠度
        const overlap = charOverlap(bubbleUser, serverUser);
        if (overlap > 0.7) score += 15;
        else if (overlap > 0.5) score += 8;
        else continue; // 用户名完全不匹配，跳过
      }

      // 礼物名匹配
      const bubbleGift = normalizeName(bubble.giftName);
      const serverGift = normalizeName(server.gift_name || '');
      if (bubbleGift === serverGift) {
        score += 40;
      } else if (
        bubbleGift.includes(serverGift) ||
        serverGift.includes(bubbleGift)
      ) {
        score += 30;
      } else {
        const overlap = charOverlap(bubbleGift, serverGift);
        if (overlap > 0.7) score += 20;
        else if (overlap > 0.5) score += 10;
        else continue; // 礼物名完全不匹配
      }

      // Gift ID 匹配（精确）
      if (bubble.giftId && String(server.gift_id || '') === bubble.giftId) {
        score += 15;
      }

      // 连击数匹配
      if (
        bubble.comboCount > 0 &&
        Number(server.num || 1) === bubble.comboCount
      ) {
        score += 10;
      } else if (Math.abs(Number(server.num || 1) - bubble.comboCount) <= 2) {
        score += 5;
      }

      // 时间接近度加分
      if (server.created_at) {
        const serverTime = new Date(server.created_at).getTime();
        const timeDiff = Math.abs(serverTime - captureTimeMs);
        if (timeDiff < TIME_WINDOW_MS) {
          score += Math.round((1 - timeDiff / TIME_WINDOW_MS) * 10);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { serverIndex: i, server, score };
      }
    }

    if (bestMatch && bestScore >= 50) {
      serverMatched.add(bestMatch.serverIndex);
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
    if (!serverMatched.has(i)) {
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

function charOverlap(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(''));
  const setB = new Set(b.split(''));
  let overlap = 0;
  for (const c of setA) {
    if (setB.has(c)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}
