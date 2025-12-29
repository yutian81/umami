// --- 常量定义 ---
const cacheKey = 'umami_cache';
const cacheTime = 600;
const getBaseUrl = (env) => (env.API_BASE_URL || 'https://umami.24811213.xyz').replace(/\/$/, '');

// 登录逻辑
async function loginAndGetToken(env) {
  const apiBaseUrl = getBaseUrl(env);
  const username = env.UMAMI_USERNAME || 'admin';
  const password = env.UMAMI_PASSWORD || 'admin123';
  const loginApiUrl = `${apiBaseUrl}/api/auth/login`;

  const response = await fetch(loginApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) throw new Error('Umami Login Failed');
  const data = await response.json();
  return data.token;
}

// 获取统计数据逻辑
async function fetchUmamiData(env, startAt, endAt) {
  const apiBaseUrl = getBaseUrl(env);
  const websiteId = env.WEBSITE_ID || '911b0428-5bdf-4647-b91b-9a07cefe6729';
  const statsApiUrl = `${apiBaseUrl}/api/websites/${websiteId}/stats`;

  // 初始 Token 尝试
  let currentToken =
    env.UMAMI_TOKEN ||
    'swWgHZkABEs5OMsbdoTremp4D9FW8vyCcW3JVBN6YEmvMj7txnHPGEl+JE75TudBZs7oh3Hy+/dT/Lf9mPyTUjwCcgp0QHnpdMvSxKeBN791pGrunk438lqOEm+yZOKzHDfVzQnyQ1VflyEqFfFgB7ABXdU8QKtbXINzrYFW6OFqyrMwU1CGU+5ktkzAPSSn+22TTYzXog9F5GqtOht9EzHKUBESfie3LUUSr92XasiMHCik92vXNTDPYlstFnUtSqM9M8f/mXAg8t79UA4cKIO3iDWaKWo/wxML/WO29uVtbaL0TXvw/esAih2rZ0349qxsP/ArSHzk++DDUBHXvo7awZLxcEO6LUUNBQMzY5dLpSvdrwFLajlWvSLh';

  const getStats = async (token) => {
    const url = `${statsApiUrl}?startAt=${startAt}&endAt=${endAt}`;
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  };

  let response = await getStats(currentToken);

  // 如果过期 (401)，动态登录并重试
  if (response.status === 401) {
    currentToken = await loginAndGetToken(env);
    response = await getStats(currentToken);
  }

  if (!response.ok) return null;
  return await response.json();
}

// --- 主导出函数 ---
export default {
  async fetch(request, env, ctx) {
    const cache = await caches.open(cacheKey);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    const now = Date.now();
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const yesterdayStart = todayStart - 86400000;
    const lastMonthStart = new Date(now).setMonth(new Date(now).getMonth() - 1);
    const lastYearStart = new Date(now).setFullYear(new Date(now).getFullYear() - 1);

    try {
      const [todayData, yesterdayData, lastMonthData, lastYearData] = await Promise.all([
        fetchUmamiData(env, todayStart, now),
        fetchUmamiData(env, yesterdayStart, todayStart),
        fetchUmamiData(env, lastMonthStart, now),
        fetchUmamiData(env, lastYearStart, now)
      ]);

      const responseData = {
        today_uv: todayData?.visitors ?? 0,
        today_pv: todayData?.pageviews ?? 0,
        yesterday_uv: yesterdayData?.visitors ?? 0,
        yesterday_pv: yesterdayData?.pageviews ?? 0,
        last_month_pv: lastMonthData?.pageviews ?? 0,
        last_year_pv: lastYearData?.pageviews ?? 0,
      };

      const response = new Response(JSON.stringify(responseData), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': `public, max-age=${cacheTime}`,
        },
      });

      ctx.waitUntil(cache.put(request, response.clone()));
      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
