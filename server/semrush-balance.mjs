import { safeSemrushError, validateSemrushKey } from './semrush-mcp.mjs';

export const SEMRUSH_BALANCE_URL =
  'https://www.semrush.com/users/countapiunits.html';
export const SEMRUSH_BALANCE_DOC =
  'https://developer.semrush.com/api/v3/get-started/api-units-balance/';
// This official account request is free. Analytical reports continue to use MCP.
export async function semrushBalance(key, fetcher = fetch) {
  const checkedAt = new Date().toISOString();
  const basic = {
    units: null,
    checkedAt,
    source: 'Semrush Standard API units',
    documentation: SEMRUSH_BALANCE_DOC,
  };
  try {
    key = validateSemrushKey(key);
    const url = new URL(SEMRUSH_BALANCE_URL);
    url.searchParams.set('key', key);
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ...basic,
        status: 'unavailable',
        message: `余额接口 HTTP ${response.status}，请核对 Key 的账户权限；未知余额不按0处理`,
      };
    }
    const body = await response.text();
    const text = body.trim();
    if (/^ERROR\s+132\s*[:：]+\s*API UNITS BALANCE IS ZERO\s*$/i.test(text))
      return {
        ...basic,
        units: 0,
        status: 'available',
        message: '官方返回 API units 余额为0',
      };
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text))
      return {
        ...basic,
        status: 'unavailable',
        message:
          '官方未返回可识别的 API units 余额；当前 Key 可能没有标准余额接口权限，请到 Semrush 账户核对',
      };
    const units = Number(text.replaceAll(',', ''));
    if (!Number.isSafeInteger(units) || units < 0)
      throw new Error('余额数值无效');
    return {
      ...basic,
      units,
      status: 'available',
      message: '已读取官方标准 API units 余额；其他订阅配额以账户页面为准',
    };
  } catch (error) {
    return {
      ...basic,
      status: 'unavailable',
      message: safeSemrushError(error, key),
    };
  }
}
