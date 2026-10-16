import type { Keyword, Market, Task } from './data';
import type { KeywordResearchInput } from './keyword-research';

import { reactive } from 'vue';

import { audit, marketName, stamp, state } from './data';
import {
  runKeywordResearch,
  runKeywordTrendResearch,
} from './keyword-research';
import { assessKeyword } from './keyword-scoring';
import { trendRecordFields } from './site-discovery';

export const keywordJob = reactive({
  running: false,
  discovered: 0,
  trended: 0,
  message: '',
  phase: '',
});
let controller: AbortController | undefined;

function saveKeyword(record: Keyword) {
  const current = state.keywords.find(
    (item) =>
      item.market === record.market &&
      item.term.toLocaleLowerCase() === record.term.toLocaleLowerCase(),
  );
  if (current) {
    current.source = [
      ...new Set([
        ...current.source.split(' / '),
        ...record.source.split(' / '),
      ]),
    ].join(' / ');
    current.seedTerm = record.seedTerm;
    current.collectedAt = record.collectedAt;
    current.updatedAt = record.updatedAt;
    if (['待分类', '未分类'].includes(current.category))
      current.category = record.category;
    current.dataNature = 'collected';
    current.assessment = assessKeyword(current);
    return current;
  }
  record.assessment = assessKeyword(record);
  state.keywords.unshift(record);
  return record;
}
export async function startKeywordJob(
  input: Omit<KeywordResearchInput, 'signal'>,
  existingRecords?: Keyword[],
) {
  if (keywordJob.running) throw new Error('已有关键词任务正在运行，请等待完成');
  controller = new AbortController();
  Object.assign(keywordJob, {
    running: true,
    discovered: existingRecords?.length || 0,
    trended: 0,
    message: '',
    phase: existingRecords ? '补齐趋势与重评' : '发现关键词',
  });
  const discoveredKeys = new Set<string>();
  const tasks = new Map<Market, Task>();
  for (const market of input.markets) {
    const task: Task = {
      id: crypto.randomUUID(),
      title: `第一步 · 关键词与趋势研究 · ${marketName(market)}`,
      market,
      mode: 'live',
      stage: 'keywords',
      status: 'running',
      created: stamp(),
      steps: [
        '仅发现关键词、采集一年趋势、评分与打标',
        `结果数量上限：${input.limit}；评分后等待人工筛选`,
      ],
    };
    tasks.set(market, task);
    state.tasks.unshift(task);
  }
  try {
    const callbacks = {
      onKeyword: (record: Keyword) => {
        saveKeyword(record);
        discoveredKeys.add(
          `${record.market}|${record.term.toLocaleLowerCase()}`,
        );
        keywordJob.discovered = discoveredKeys.size;
        keywordJob.message = record.term;
      },
      onTrend: (
        trend: import('./site-discovery').TrendGroup,
        generatedAt: string,
      ) => {
        keywordJob.phase = '采集趋势并评分';
        keywordJob.trended += 1;
        keywordJob.message = trend.keyword;
        const record = state.keywords.find(
          (item) =>
            item.market === trend.market &&
            item.term.toLocaleLowerCase() === trend.keyword.toLocaleLowerCase(),
        );
        if (!record) return;
        if (trend.series.length > 0)
          Object.assign(record, trendRecordFields(trend));
        else {
          record.trendStatus = 'failed';
          record.trendMessage = trend.message;
        }
        record.updatedAt = generatedAt;
        record.assessment = assessKeyword(record);
      },
      onProgress: (market: Market, message: string) =>
        tasks.get(market)?.steps.push(message),
    };
    const config = { ...input, signal: controller.signal };
    const result = existingRecords
      ? await runKeywordTrendResearch(existingRecords, config, callbacks)
      : await runKeywordResearch(config, callbacks);
    keywordJob.discovered = result.keywords.length;
    for (const [market, task] of tasks) {
      const records = result.keywords
        .filter((item) => item.market === market)
        .map((item) =>
          state.keywords.find(
            (saved) =>
              saved.market === market &&
              saved.term.toLocaleLowerCase() === item.term.toLocaleLowerCase(),
          ),
        )
        .filter((item): item is Keyword => Boolean(item));
      const failed = records.filter(
        (record) => record.trendStatus === 'failed',
      ).length;
      const graded = records.filter(
        (record) => record.assessment?.grade,
      ).length;
      task.status =
        failed > 0 || result.discoveryFailures > 0
          ? 'partial'
          : 'awaiting_review';
      task.steps.push(
        `已输出${records.length}个关键词；可评级${graded}个；趋势请求失败${
          failed
        }个`,
        '关键词列表已更新，等待人工筛选；入选后再进入独立站研究',
        `本任务 Sorftime 已确认数据调用共${result.sorftimeCalls}次；另有${result.sorftimeUnconfirmedCalls}次结果未知并预留额度（所有市场合计），未调用产品工具`,
      );
    }
    keywordJob.phase = '待人工筛选';
    audit(
      '完成第一步关键词研究',
      `关键词${result.keywords.length}个，趋势查询${
        keywordJob.trended
      }个；等待人工筛选`,
    );
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '关键词研究失败';
    for (const task of tasks.values()) {
      task.status = controller.signal.aborted ? 'cancelled' : 'partial';
      task.steps.push(detail);
    }
    throw error;
  } finally {
    keywordJob.running = false;
    controller = undefined;
  }
}
export function stopKeywordJob() {
  controller?.abort(new Error('已停止关键词研究，已获得结果保留'));
}
