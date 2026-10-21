import { createHash } from 'node:crypto';

import { sourceUrl } from './research-evidence.mjs';

export function consumerModelInput(records) {
  const groups = new Map();
  for (const record of [
    ...new Map(records.map((r) => [r.id, r])).values(),
  ].toSorted(
    (a, b) => Number(b.kind === 'comment') - Number(a.kind === 'comment'),
  )) {
    const key = `${record.platform}:${record.sourceUrl || record.url}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const sample = [];
  while (sample.length < 80 && [...groups.values()].some((g) => g.length))
    for (const group of groups.values())
      if (group.length > 0 && sample.length < 80) sample.push(group.shift());
  return sample;
}

// Counts are calculated from saved evidence, never accepted from model output.
export function consumerTopics(report, records) {
  const evidence = [...new Map((records || []).map((r) => [r.id, r])).values()];
  const model = Boolean(
    report.modelAnalysis?.findings && report.modelAnalysis.findings.length > 0,
  );
  const sampleSize = model
    ? report.modelAnalysis.inputEvidenceCount
    : report.statistics?.sampleSize;
  const groups = model
    ? report.modelAnalysis.findings
    : report.statistics?.themes || [];
  return groups
    .map((group) => {
      const ids = [...new Set(group.evidenceIds || [])];
      const matches = evidence.filter((r) => ids.includes(r.id));
      const savedCount = ids.length > 0 ? ids.length : group.count || 0;
      const count = records ? matches.length : savedCount;
      const sources = [
        ...new Set(
          matches.map((r) => sourceUrl(r.sourceUrl || r.url)).filter(Boolean),
        ),
      ];
      return {
        key:
          group.key ||
          createHash('sha256').update(group.label).digest('hex').slice(0, 12),
        label: group.label,
        direction: group.interpretation || '',
        suggestion: group.suggestion || '',
        evidenceIds: records ? matches.map((r) => r.id) : ids,
        count,
        sampleSize: sampleSize || 0,
        share: sampleSize ? Math.round((count / sampleSize) * 100) : null,
        sourceCount: records ? sources.length : (group.sourceCount ?? null),
        sources,
        platforms: [...new Set(matches.map((r) => r.platform).filter(Boolean))],
        engagement: records
          ? matches.reduce((n, r) => n + Math.max(0, Number(r.likes) || 0), 0)
          : null,
        method: model ? 'AI归纳 · 已分析样本' : '规则统计 · 全部已采样文本',
      };
    })
    .filter((t) => t.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 15);
}
export function insightSummary(r) {
  return {
    id: r.id,
    revision: r.revision,
    title: r.title,
    kind: r.kind,
    reportType: r.reportType,
    market: r.market,
    period: r.period,
    endDate: r.endDate,
    marketSnapshot: r.marketSnapshot,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    status: r.status,
    keywordIds: r.keywordIds || [],
    siteIds: r.siteIds || [],
    productIds: r.productIds || [],
    evidenceIds: r.evidenceIds || [],
    sourceCount: r.statistics?.sourceCount,
    confidence: r.statistics?.confidence,
    hasModelAnalysis: Boolean(r.modelAnalysis),
    modelName: r.modelAnalysis?.model,
    promptVersion: r.modelAnalysis?.prompt?.version || r.prompt?.version,
    reviewStatus: r.reviewStatus,
    parentReportId: r.parentReportId,
    message: r.message,
    topicSummary:
      r.reportType === 'ad' || r.kind === 'ad_analysis'
        ? undefined
        : r.topicSummary || consumerTopics(r),
  };
}
