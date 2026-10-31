import { validateTrendPlan } from './keyword-trends-domain.mjs';
import { enqueueTrendWork } from './keyword-trends-engine.mjs';

export function validateResearchTrends(value, markets) {
  if (value === undefined) return undefined;
  if (!value || value.budgetAcknowledged !== true)
    throw new Error('请确认社媒趋势的来源额度预算');
  if (
    !Array.isArray(value.sources) ||
    value.sources.some(
      (source) => !['facebook', 'instagram', 'tiktok'].includes(source),
    )
  )
    throw new Error('请选择有效的社媒趋势来源');
  const plan = validateTrendPlan({
    sources: value.sources,
    markets,
    maxPages: value.maxPages,
  });
  return {
    sources: plan.sources,
    maxPages: plan.maxPages,
    budgetAcknowledged: true,
  };
}

// The caller holds the short submission lock. Persist dispatch and inbox in one transaction
// so restarting a research job cannot create another day's paid collection.
export async function dispatchResearchTrends(io, job, words, now) {
  const name = `keyword-trends:research:${job.id}`;
  const previous = await io.db.read(name);
  if (previous) return previous;
  const options = validateResearchTrends(
    job.input.socialTrends,
    job.input.markets,
  );
  if (!options) return null;
  const plan = validateTrendPlan({ ...options, markets: job.input.markets });
  let result;
  await io.db.commitResult(async () => {
    result = await enqueueTrendWork(
      io.db,
      words,
      plan,
      now,
      'research',
      job.id,
    );
    await io.db.write(name, result);
  });
  return result;
}
