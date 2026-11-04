import { newProductEvidence, stableId } from './discovery-monitor-domain.mjs';
import {
  pendingSourceFields,
  sourceFieldSample,
} from './source-field-domain.mjs';

// One journaled request per runner turn. Frozen pre-migration jobs retain their old runner.
export async function runOfficialNewReleases(job, io) {
  const plan = job.input.plan;
  const cp = structuredClone(job.checkpoint);
  cp.asOf ||= io.now();
  cp.logs ||= [];
  cp.failures ||= [];
  cp.seen ||= [];
  cp.pending ||= [];
  cp.work ||= plan.officialBoardUrls.map((url) => ({ url, page: 1 }));
  cp.calls ||= 0;
  cp.products ||= 0;
  cp.skipped ||= {
    fulfillmentUnknown: 0,
    platformFulfilled: 0,
    notSupplement: 0,
  };
  const cancelled = async () =>
    (
      await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
        job.id,
      ])
    ).rows[0]?.cancelled;
  const finish = () =>
    io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date(io.now()).toISOString() },
      cp.failures.length ? 'partial' : 'completed',
    );
  try {
    if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
    const item = cp.pending.shift();
    if (item) {
      cp.calls++;
      if (item.op === 'detail') {
        const result = await io.collect(
          job,
          `official-detail:${stableId(JSON.stringify([plan.sourceMarkets.amazon, item.asin]))}`,
          {
            sources: ['official_new_releases'],
            op: 'detail',
            ...item,
            market: plan.market,
            sourceMarket: plan.sourceMarkets.amazon,
            now: cp.asOf,
          },
        );
        if (newProductEvidence(result.product, plan, cp.asOf))
          cp.pending.unshift({ op: 'classify', product: result.product });
        else if (result.product.resourceRaw.fulfillment === 'FBA')
          cp.skipped.platformFulfilled++;
        else cp.skipped.fulfillmentUnknown++;
      } else {
        const p = item.product;
        const sample = sourceFieldSample('products', p);
        const result = await io.collect(job, `classify:${stableId(p.id)}`, {
          sources: ['field_analysis'],
          sample,
        });
        if (result.analysis.supplement && !(await cancelled())) {
          const evidence = newProductEvidence(p, plan, cp.asOf);
          if (evidence) {
            await io.upsertProduct({
              ...pendingSourceFields('products', p),
              ...result.patch,
              fieldAnalysis: {
                ...result.analysis,
                model: result.model,
                sources: sample.sources,
              },
              newProductClassifications: [evidence],
            });
            cp.products++;
          }
        } else if (!result.analysis.supplement) cp.skipped.notSupplement++;
      }
    } else if (cp.work.length && cp.seen.length < plan.maxProducts) {
      const work = cp.work.shift();
      cp.calls++;
      const result = await io.collect(
        job,
        `official-board:${stableId(JSON.stringify([work.url, work.page]))}`,
        {
          sources: ['official_new_releases'],
          op: 'board',
          url: work.url,
          market: plan.market,
          sourceMarket: plan.sourceMarkets.amazon,
          now: cp.asOf,
        },
      );
      for (const member of result.items) {
        if (cp.seen.includes(member.asin) || cp.seen.length >= plan.maxProducts)
          continue;
        cp.seen.push(member.asin);
        cp.pending.push(
          member.product && plan.kind !== 'fbm_new'
            ? { op: 'classify', product: member.product }
            : { op: 'detail', asin: member.asin, ranking: member.ranking },
        );
      }
      if (result.nextUrl && work.page < plan.maxPages)
        cp.work.push({ url: result.nextUrl, page: work.page + 1 });
      cp.logs.push(
        `官方新品榜第${work.page}页：${result.sourceRows}条，累计去重${cp.seen.length}件`,
      );
    } else {
      cp.logs.push(
        `官方榜单去重${cp.seen.length}件，写入保健品${cp.products}件；非保健品${cp.skipped.notSupplement}件，平台发货${cp.skipped.platformFulfilled}件，发货方未核实${cp.skipped.fulfillmentUnknown}件`,
      );
      if (cp.work.length)
        cp.logs.push('达到本次商品抓取上限，未继续请求剩余榜单');
      if (cp.skipped.fulfillmentUnknown)
        cp.failures.push(
          `${cp.skipped.fulfillmentUnknown}件无法核实FBM发货方，未写入FBM新品`,
        );
      return finish();
    }
  } catch (error) {
    cp.failures.push(String(error.message).slice(0, 500));
  }
  cp.logs = cp.logs.slice(-200);
  cp.nextRunAt = io.now() + 1000;
  return io.saveCheckpoint(job, cp, 'running');
}
