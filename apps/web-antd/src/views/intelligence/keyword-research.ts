import type { Keyword, Market } from './data';
import type { TrendGroup } from './site-discovery';

import { classifyKeyword, discoverSites } from './site-discovery';

export interface KeywordResearchInput {
  accessKey: string;
  apiUrl: string;
  seeds: string[];
  markets: Market[];
  sources: Array<
    'amazon_autocomplete' | 'google_autocomplete' | 'sorftime' | 'semrush'
  >;
  depth: number;
  limit: number;
  expectedKeywordCount?: number;
  signal?: AbortSignal;
  sorftimeRequestLimit?: number;
  socialTrends?: ResearchSocialTrends;
}
export interface ResearchSocialTrends {
  sources: string[];
  maxRequests: number;
  maxPages: number;
  budgetAcknowledged: boolean;
}
export const defaultResearchTrends = (): ResearchSocialTrends => ({
  sources: ['tiktok', 'instagram', 'facebook'], maxRequests: 100, maxPages: 11, budgetAcknowledged: false,
});
export interface KeywordResearchCallbacks {
  onKeyword: (keyword: Keyword) => void;
  onTrend: (trend: TrendGroup, generatedAt: string) => void;
  onProgress: (market: Market, message: string) => void;
}
export async function runKeywordResearch(
  input: KeywordResearchInput,
  callbacks: KeywordResearchCallbacks,
  transport = discoverSites,
) {
  const seeds = [
    ...new Set(input.seeds.map((seed) => seed.trim()).filter(Boolean)),
  ];
  const markets = [...new Set(input.markets)];
  if (
    input.limit < 1 ||
    input.limit > 100 ||
    seeds.length * markets.length > input.limit
  )
    throw new Error('关键词总数为1～100，且不能少于种子词与市场的组合数');
  if (seeds.length === 0 || markets.length === 0)
    throw new Error('请填写种子词并选择市场');
  if (
    input.sources.length === 0 ||
    input.sources.some(
      (source) =>
        ![
          'amazon_autocomplete',
          'google_autocomplete',
          'sorftime',
          'semrush',
        ].includes(source),
    )
  )
    throw new Error('第一步仅接受关键词发现渠道');
  const supportedPairs =
    seeds.length *
    markets.filter((market) => market === 'US' || market === 'MX').length;
  const remainingSlots = input.limit - seeds.length * markets.length;
  const automaticLimit =
    supportedPairs > 0 && remainingSlots > 0
      ? input.depth === 2
        ? Math.min(input.limit, supportedPairs + remainingSlots)
        : supportedPairs
      : 0;
  const taskSorftimeLimit = input.sorftimeRequestLimit ?? automaticLimit;
  if (
    input.sources.includes('sorftime') &&
    (!Number.isInteger(taskSorftimeLimit) ||
      taskSorftimeLimit < 0 ||
      taskSorftimeLimit > 100)
  )
    throw new Error('Sorftime自动调用额度无效，请检查结果数量');
  const candidates = new Map<string, Keyword>();
  const add = (
    term: string,
    market: Market,
    seed: string,
    source: string,
    collectedAt: string,
  ) => {
    const key = `${market}|${term.trim().toLocaleLowerCase()}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.source = [
        ...new Set([...existing.source.split(' / '), ...source.split(' / ')]),
      ].join(' / ');
      callbacks.onKeyword(existing);
      return;
    }
    if (candidates.size >= input.limit) return;
    const keyword: Keyword = {
      id: crypto.randomUUID(),
      term: term.trim(),
      market,
      seedTerm: seed,
      collectedAt,
      updatedAt: collectedAt,
      category: classifyKeyword(term, seed),
      source,
      growth: null,
      series: [],
      trendStatus: 'pending',
      trendMessage: '等待采集一年趋势',
      favorite: false,
      reviewStatus: 'pending',
      productIds: [],
      siteIds: [],
      dataNature: 'collected',
    };
    candidates.set(key, keyword);
    callbacks.onKeyword(keyword);
  };
  const generatedAt = new Date().toISOString();
  // Reserve all seed-market pairs before using the remaining quota for expansion.
  for (const market of markets)
    for (const seed of seeds)
      add(seed, market, seed, '用户种子词', generatedAt);
  let discoveryFailures = 0;
  let sorftimeCalls = 0;
  let sorftimeUnconfirmedCalls = 0;
  let combinationsLeft = seeds.length * markets.length;
  for (const market of markets) {
    for (const seed of seeds) {
      input.signal?.throwIfAborted();
      const remaining = input.limit - candidates.size;
      if (remaining <= 0) break;
      const allowance = Math.ceil(remaining / Math.max(1, combinationsLeft));
      combinationsLeft -= 1;
      const sorftimeRequestLimit = Math.max(
        0,
        taskSorftimeLimit - sorftimeCalls - sorftimeUnconfirmedCalls,
      );
      try {
        const result = await transport({
          accessKey: input.accessKey,
          apiUrl: input.apiUrl,
          action: 'keyword_research',
          keywords: [seed],
          markets: [market],
          depth: input.depth,
          limit: allowance,
          maxSites: 1,
          productsPerSite: 1,
          sources: input.sources,
          signal: input.signal,
          sorftimeRequestLimit,
        });
        sorftimeCalls += result.usage?.sorftimeCalls || 0;
        const startSize = candidates.size;
        for (const group of result.suggestions || []) {
          if (group.market !== market) continue;
          for (const item of group.items) {
            if (candidates.size - startSize >= allowance) break;
            if (item.term.trim())
              add(item.term, market, seed, item.source, result.generatedAt);
          }
          for (const source of group.sources)
            callbacks.onProgress(
              market,
              `${source.source}：${source.count}个词；${
                source.message || source.status
              }`,
            );
          if (
            group.sources.some((source) =>
              ['error', 'partial'].includes(source.status),
            )
          )
            discoveryFailures += 1;
        }
      } catch (error) {
        input.signal?.throwIfAborted();
        if (input.sources.includes('sorftime') && sorftimeRequestLimit > 0) {
          sorftimeUnconfirmedCalls += sorftimeRequestLimit;
          callbacks.onProgress(
            market,
            `Sorftime 请求结果未确认，按${sorftimeRequestLimit}次预留额度，避免重复消耗`,
          );
        }
        discoveryFailures += 1;
        callbacks.onProgress(
          market,
          `关键词发现失败：${
            error instanceof Error ? error.message : '接口异常'
          }`,
        );
      }
    }
  }
  const trendResult = await runKeywordTrendResearch(
    [...candidates.values()],
    input,
    callbacks,
    transport,
  );
  return {
    ...trendResult,
    discoveryFailures,
    sorftimeCalls,
    sorftimeUnconfirmedCalls,
  };
}

export async function runKeywordTrendResearch(
  keywords: Keyword[],
  input: Pick<KeywordResearchInput, 'accessKey' | 'apiUrl' | 'signal'>,
  callbacks: KeywordResearchCallbacks,
  transport = discoverSites,
) {
  const markets = [...new Set(keywords.map((record) => record.market))];
  let trendFailures = 0;
  for (const market of markets) {
    const records = keywords.filter((record) => record.market === market);
    for (let index = 0; index < records.length; index += 3) {
      input.signal?.throwIfAborted();
      const batch = records.slice(index, index + 3);
      try {
        const result = await transport({
          accessKey: input.accessKey,
          apiUrl: input.apiUrl,
          action: 'keyword_research',
          keywords: batch.map((record) => record.term),
          markets: [market],
          maxSites: 1,
          productsPerSite: 1,
          sources: ['google_trends'],
          signal: input.signal,
        });
        for (const record of batch) {
          const trend = result.trends?.find(
            (item) =>
              item.market === market &&
              item.keyword.toLocaleLowerCase() ===
                record.term.toLocaleLowerCase(),
          ) || {
            keyword: record.term,
            market,
            growth: null,
            series: [],
            points: [],
            message: '趋势服务未返回该关键词结果',
            source: 'Google Trends',
            status: 'error' as const,
          };
          callbacks.onTrend(trend, result.generatedAt);
          if (!trend.series.some((value) => value > 0)) trendFailures += 1;
          callbacks.onProgress(
            market,
            `${record.term}：一年趋势${trend.series.length}个时点；${
              trend.message || trend.dailyMessage || trend.status
            }`,
          );
        }
      } catch (error) {
        input.signal?.throwIfAborted();
        for (const record of batch) {
          trendFailures += 1;
          callbacks.onTrend(
            {
              keyword: record.term,
              market,
              growth: null,
              series: [],
              points: [],
              message: error instanceof Error ? error.message : '趋势采集失败',
              source: 'Google Trends',
              status: 'error',
            },
            new Date().toISOString(),
          );
          callbacks.onProgress(market, `${record.term}：趋势采集失败`);
        }
      }
    }
  }
  return {
    keywords,
    discoveryFailures: 0,
    trendFailures,
    sorftimeCalls: 0,
    sorftimeUnconfirmedCalls: 0,
  };
}
