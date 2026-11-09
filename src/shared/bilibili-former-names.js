'use strict';

async function fetchBilibiliFormerNames(uid, { signal, fetchImpl = fetch } = {}) {
  const url = new URL('https://api.aicu.cc/api/v4/user/getusermark');
  url.searchParams.set('uid', uid);
  try {
    const response = await fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      credentials: 'omit',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (result?.code !== 0 || !Array.isArray(result.data?.hname)) throw new Error();
    return [...new Set(result.data.hname.filter(name => typeof name === 'string' && name.length <= 200 &&
      !/[\x00-\x1f\x7f]/.test(name)).map(name => name.trim()).filter(Boolean))];
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('曾用名暂时无法获取，请稍后重试；已有记录已保留。');
  }
}

module.exports = { fetchBilibiliFormerNames };
