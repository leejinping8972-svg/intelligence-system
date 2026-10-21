/* oxlint-disable unicorn/no-await-expression-member, eslint/no-console -- Disposable integration assertions and runner output. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool, putDocument } from './database.mjs';
import { aiPromptAction, currentAiPrompt } from './ai-prompt-config.mjs';
import {
  submitInsight,
  insightSnapshot,
  insightDetails,
} from './insight-jobs.mjs';

// Called only from the existing guarded disposable PostgreSQL/MySQL fixture.
export async function consumerReportsIntegration() {
  const admin = { role: 'admin', username: 'synthetic-qa' };
  const original = await currentAiPrompt('consumer_report');
  const text =
    '消费者洞察隔离测试配置：关注保健品口感、剂量和购买问题。每项建议必须引用原始讨论文本。';
  await aiPromptAction(
    {
      action: 'server_ai_prompt_save',
      key: 'consumer_report',
      text,
      version: original.version,
    },
    admin,
  );
  assert.equal((await currentAiPrompt('consumer_report')).text, text);
  await assert.rejects(
    () =>
      aiPromptAction(
        {
          action: 'server_ai_prompt_save',
          key: 'consumer_report',
          text,
          version: original.version,
        },
        admin,
      ),
    /已更新/,
  );
  await putDocument('provider_configs', 'provider:analysis:v1', {
    synthetic: true,
  });
  await putDocument('provider_configs', 'provider:scrapecreators:v1', {
    synthetic: true,
  });
  const keyword = {
    id: 'consumer-qa-keyword',
    term: 'creatine gummies',
    market: 'US',
  };
  await pool.query(
    'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
    ['US|consumer-qa-keyword', keyword],
  );
  const input = {
    kind: 'consumer_research',
    market: 'US',
    sourceKind: 'reddit_search',
    query: keyword.term,
    keywordIds: [keyword.id],
    requestId: randomUUID(),
    analyze: true,
    autoComments: true,
  };
  const first = await submitInsight(input);
  assert.equal(first.input.prompt.text, text);
  assert.equal((await submitInsight(input)).id, first.id);
  const queued = await insightSnapshot({
    summary: true,
    kind: 'consumer',
    latestByKeyword: true,
    keywordIds: [keyword.id],
  });
  assert.deepEqual(queued.reports[0].keywordIds, [keyword.id]);
  await assert.rejects(
    () => submitInsight({ ...input, requestId: randomUUID(), market: 'VN' }),
    /关联对象/,
  );
  // Freeze a report's submitted prompt even after the global template changes.
  const current = await currentAiPrompt('consumer_report');
  await aiPromptAction(
    {
      action: 'server_ai_prompt_save',
      key: 'consumer_report',
      text: `${text} 更新版本。`,
      version: current.version,
    },
    admin,
  );
  const saved = (
    await pool.query('SELECT input FROM research_jobs WHERE id=$1', [first.id])
  ).rows[0].input;
  assert.equal(saved.prompt.text, text);
  const id = randomUUID();
  const r = {
    id,
    title: '口感研究',
    kind: 'consumer_research',
    market: 'US',
    createdAt: '2025-01-01T00:00:00Z',
    status: 'completed',
    keywordIds: [keyword.id],
    evidenceIds: [],
    statistics: {
      sampleSize: 5,
      themes: [
        {
          key: 'taste',
          label: '口感',
          count: 3,
          evidenceIds: ['e1', 'e2', 'e3'],
          sourceCount: 1,
          suggestion: '验证口感',
        },
      ],
    },
  };
  await putDocument('workspace_documents', `business:insightReports:${id}`, r);
  for (let i = 0; i < 205; i++)
    await putDocument(
      'workspace_documents',
      `business:insightReports:consumer-qa-${i}`,
      {
        ...r,
        id: `consumer-qa-${i}`,
        market: 'VN',
        title: '其他市场',
        createdAt: '2026-10-01T00:00:00Z',
        keywordIds: ['other-keyword'],
      },
    );
  const filtered = await insightSnapshot({
    kind: 'consumer',
    paginated: true,
    market: 'US',
    keywordId: keyword.id,
    topic: '口感',
    search: '口感',
    review: 'pending',
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.reports[0].id, id);
  assert.equal(filtered.reports[0].topicSummary[0].share, 60);
  assert.equal(
    (
      await insightSnapshot({
        kind: 'consumer',
        paginated: true,
        market: 'VN',
        keywordId: keyword.id,
      })
    ).total,
    0,
  );
  const latest = await insightSnapshot({
    kind: 'consumer',
    latestByKeyword: true,
    keywordIds: [keyword.id],
    summary: true,
  });
  assert.equal(
    latest.reports[0].id,
    first.id,
    'latest keyword report survives more than 200 newer unrelated reports',
  );
  assert.equal(
    (await insightDetails({ reportId: first.id })).report.prompt.text,
    text,
  );
  console.log(
    'Consumer reports integration passed: prompt persistence/CAS/snapshots, idempotent submission, market validation, keyword+topic filters and >200-report summaries; no model/provider calls.',
  );
}
