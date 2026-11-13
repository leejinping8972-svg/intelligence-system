import { naturalKey } from './domain.mjs';
import { productKeywordSample } from './product-keywords-domain.mjs';

// One product per job; completed responses and unknown requests stay in the
// shared request journal. No keyword expansion, related-product loop or trends.
export async function runProductKeywordJob(job, io) {
  const cp = { index: 0, keywords: [], logs: [], failures: [], ...job.checkpoint };
  cp.logs = [...cp.logs];
  cp.failures = [...cp.failures];
  const finish = async (status, message) => {
    if (message) cp.logs.push(message);
    await io.updateProduct(job, { status, count: cp.keywords.length, message: message || cp.logs.at(-1), jobId: job.id });
    return io.saveCheckpoint(job, cp, status === 'empty' || status === 'stale' ? 'completed' : status);
  };
  if (await io.cancelled(job)) return finish('cancelled');
  try {
    const product = await io.readProduct(job.input.targetId);
    if (!product) return finish('stale', '商品已删除，未执行后续采集');
    if (productKeywordSample(product).fingerprint !== job.input.sample.fingerprint)
      return finish('stale', '商品原文已更新，请对最新资料补做关键词');
    if (!cp.linked) {
      if (!(await io.hasConfig('provider:analysis:v1')))
        return finish('failed', '请先配置AI分析模型，再对商品补做关键词');
      await io.updateProduct(job, { status: 'running', jobId: job.id });
      const result = await io.collect(job, 'product-keywords', {
        sources: ['product_keywords'], sample: job.input.sample,
      });
      // Link commits both directions, re-reading current rows under locks.
      cp.keywords = await io.linkKeywords(job, result.keywords, result.model);
      cp.linked = true;
      cp.logs.push(`已从商品原文提取并关联${cp.keywords.length}个候选词；候选词不代表真实平台流量词`);
      await io.saveCheckpoint(job, cp);
    }
    if (!cp.keywords.length) return finish('empty', '已分析商品原文，未提取到合适关键词');
    if (!(await io.hasConfig('provider:semrush:mcp:v1')))
      return finish('partial', '关键词已入库并关联商品；未配置Semrush，搜索指标待补齐');
    for (; cp.index < cp.keywords.length; cp.index++) {
      if (await io.cancelled(job)) return finish('cancelled');
      const record = cp.keywords[cp.index];
      let result;
      try {
        result = await io.collect(job, `keyword-metrics:${cp.index}`, {
          sources: ['semrush'], keywords: [record.term], markets: [record.market], nonTrendOnly: true,
        });
        if (result.metrics && result.metrics.market !== record.market)
          throw Error('关键词指标市场不匹配，未保存');
      } catch (error) {
        await io.saveMetrics(naturalKey(record), { jobId: job.id, status: 'failed', message: String(error.message).slice(0, 700), finishedAt: io.now() });
        throw error;
      }
      const collection = {
        jobId: job.id, status: result.metrics ? result.complete === false ? 'partial' : 'completed' : 'empty',
        count: result.metrics ? 1 : 0, apiUnits: result.apiUnits,
        message: result.message, finishedAt: io.now(),
      };
      await io.saveMetrics(naturalKey(record), collection, result.metrics);
      if (collection.status === 'partial') cp.failures.push(`${record.term}：来源只返回部分搜索指标`);
      cp.logs.push(`${record.term}：${result.message || '搜索指标查询完成'}；未采集趋势`);
      await io.saveCheckpoint(job, { ...cp, index: cp.index + 1 });
    }
    return finish(cp.failures.length ? 'partial' : 'completed',
      `已处理${cp.keywords.length}个候选词的搜索指标；来源未收录保留未知，未执行趋势采集`);
  } catch (error) {
    const message = String(error.message || '关键词处理失败').slice(0, 700);
    cp.failures.push(message);
    return finish(cp.linked ? 'partial' : 'failed', `${message}；已保存结果保留，未自动重放请求`);
  }
}
