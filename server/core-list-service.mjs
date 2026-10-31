import { pool, putDocument, lock, unlock } from './database.mjs';

const FX_NAME = 'core:usd-rates:v1';
export const FX_URL = 'https://open.er-api.com/v6/latest/USD';
export function normalizeUsdRates(value, at = new Date().toISOString()) {
  const timestamp = Number(value.time_last_update_unix) * 1000;
  if (
    value.result !== 'success' ||
    value.base_code !== 'USD' ||
    !Number.isFinite(timestamp) ||
    timestamp > Date.parse(at) + 86_400_000 ||
    Date.parse(at) - timestamp > 7 * 86_400_000
  )
    throw new Error('汇率来源格式或日期不可用，未覆盖已有汇率');
  const rates = { USD: 1 };
  for (const key of ['MXN', 'VND']) {
    const rate = value.rates?.[key];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`来源未提供有效${key}汇率`);
    rates[key] = rate;
  }
  return {
    source: 'ExchangeRate-API Open Access',
    date: new Date(timestamp).toISOString().slice(0, 10),
    collectedAt: at,
    rates,
    evidenceUrl: FX_URL,
  };
}
export async function coreListAction(input, overrides = {}) {
  const db = overrides.pool || pool;
  if (input.action === 'server_core_rates') {
    const result = await db.query(
      'SELECT value FROM provider_configs WHERE name=$1',
      [FX_NAME],
    );
    return result.rows[0]?.value?.fx || null;
  }
  if (input.action !== 'server_core_rates_refresh') return undefined;
  const c = await db.connect();
  let held = false;
  try {
    held = await (overrides.lock || lock)(c, 'core-fx');
    if (!held) throw new Error('汇率正在更新，请稍后读取');
    const result = await c.query(
      'SELECT value FROM provider_configs WHERE name=$1',
      [FX_NAME],
    );
    const stored = result.rows[0]?.value;
    if (
      stored?.attemptedAt &&
      Date.now() - Date.parse(stored.attemptedAt) < 86_400_000
    ) {
      if (stored.fx) return { ...stored.fx, cached: true };
      throw new Error('今日已尝试更新；请求结果未知或失败，未自动重试');
    }
    const attemptedAt = new Date().toISOString();
    const write =
      overrides.write ||
      ((value) => putDocument('provider_configs', FX_NAME, value, false, c));
    await write({ ...stored, attemptedAt });
    const response = await (overrides.fetcher || fetch)(FX_URL, {
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        `公开汇率请求失败 HTTP ${response.status}，本日不自动重放`,
      );
    const fx = normalizeUsdRates(await response.json(), attemptedAt);
    await write({ attemptedAt, fx });
    return fx;
  } finally {
    if (held) await (overrides.unlock || unlock)(c, 'core-fx');
    c.release();
  }
}
