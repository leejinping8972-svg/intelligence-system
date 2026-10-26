import { randomUUID } from 'node:crypto';
import { lock, unlock, sql, putDocument } from './database.mjs';
import { collect, pool, saveCheckpoint } from './store.mjs';
import { mergeKeywordMetrics } from './keyword-data.mjs';

const fieldFor = (kind) =>
  kind === 'sites' ? 'siteCollection' : 'semrushCollection';
export function validateEnrichment(input) {
  if (!Array.isArray(input.keywordIds)) throw new Error('请选择关键词列表');
  const ids = [...new Set(input.keywordIds)];
  if (
    !['sites', 'metrics'].includes(input.kind) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string' || id.length > 100)
  )
    throw new Error('请选择1～100个关键词');
  const maxSites = input.maxSites ?? 10;
  if (!Number.isInteger(maxSites) || maxSites < 1 || maxSites > 10)
    throw new Error('每词目标站点数为1～10');
  return { kind: input.kind, keywordIds: ids, maxSites };
}
export async function readKeyword(id, connection = pool, forUpdate = false) {
  const { rows } = await connection.query(
    sql(
      "SELECT data FROM research_keywords WHERE data->>'id'=$1",
      "SELECT data FROM research_keywords WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id'))=$1",
    ) + (forUpdate ? ' FOR UPDATE' : ''),
    [id],
  );
  return rows[0]?.data;
}
// Lock the latest row and change only collection fields. Concurrent review/metric edits survive.
export async function patchCollection(
  id,
  field,
  value,
  extra = {},
  connection,
) {
  const c = connection || (await pool.connect());
  try {
    if (!connection) await c.query('BEGIN');
    const current = await readKeyword(id, c, true);
    if (
      current &&
      (!value.jobId ||
        !current[field]?.jobId ||
        current[field].jobId === value.jobId ||
        value.status === 'queued')
    ) {
      const updated = { ...current, ...extra, [field]: value };
      if ('metrics' in extra)
        updated.metrics = mergeKeywordMetrics(current, extra.metrics);
      if (extra.siteIds)
        updated.siteIds = [
          ...new Set([...(current.siteIds || []), ...extra.siteIds]),
        ];
      await c.query(
        sql(
          "UPDATE research_keywords SET data=$2,updated_at=now() WHERE data->>'id'=$1",
          "UPDATE research_keywords SET data=$2,updated_at=now() WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id'))=$1",
        ),
        [id, updated],
      );
    }
    if (!connection) await c.query('COMMIT');
  } catch (e) {
    if (!connection) await c.query('ROLLBACK');
    throw e;
  } finally {
    if (!connection) c.release();
  }
}
export async function submitEnrichment(request) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(request.requestId))
    throw new Error('缺少任务提交编号');
  const value = validateEnrichment(request);
  const c = await pool.connect();
  let locked = false;
  try {
    locked = await lock(c, 'enrichment-submit');
    if (!locked) throw new Error('正在提交采集任务，请稍后重试');
    await c.query('BEGIN');
    const duplicate = await c.query(
      'SELECT * FROM research_jobs WHERE request_id=$1',
      [request.requestId],
    );
    if (duplicate.rows[0]) {
      await c.query('COMMIT');
      return duplicate.rows[0];
    }
    const active = await c.query(
      "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
    );
    if (active.rows.length >= 20)
      throw new Error('后台已有20个任务，请稍后提交');
    const busy = new Set(
      active.rows
        .filter(
          (j) =>
            j.input.kind === value.kind ||
            (value.kind === 'sites' &&
              j.input.kind === 'ads' &&
              j.input.includeSearchSites),
        )
        .flatMap((j) => j.input.keywordIds || j.input.ids || []),
    );
    const records = [];
    for (const id of value.keywordIds) {
      const record = await readKeyword(id, c, true);
      if (
        !record ||
        (value.kind === 'sites' && record.reviewStatus !== 'selected')
      )
        throw new Error('站点采集仅支持已入选且仍存在的关键词');
      if (
        value.kind === 'metrics' &&
        active.rows.some(
          (j) =>
            j.input.sources?.includes('semrush') &&
            j.checkpoint.keywords?.some((k) => k.id === id),
        )
      )
        throw new Error(`“${record.term}”仍在关键词研究任务中，请等待研究结束`);
      if (busy.has(id))
        throw new Error(`“${record.term}”已有采集任务，请勿重复提交`);
      records.push(record);
    }
    const id = randomUUID();
    const input = {
      ...value,
      records: records.map(({ id, term, market }) => ({ id, term, market })),
      markets: [...new Set(records.map((r) => r.market))],
    };
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, request.requestId, input, { submittedAt: new Date().toISOString() }],
    );
    for (const r of records)
      await patchCollection(
        r.id,
        fieldFor(value.kind),
        {
          jobId: id,
          status: 'queued',
          target: value.kind === 'sites' ? value.maxSites : 1,
          count: 0,
          submittedAt: new Date().toISOString(),
          message: '已提交后台，等待执行',
        },
        {},
        c,
      );
    await c.query('COMMIT');
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (locked) await unlock(c, 'enrichment-submit').catch(() => {});
    c.release();
  }
}
export async function cancelEnrichment(job) {
  if (!['sites', 'metrics', 'ads'].includes(job?.input?.kind)) return;
  const fields =
    job.input.kind === 'ads'
      ? job.input.includeSearchSites
        ? ['adCollection', 'siteCollection']
        : ['adCollection']
      : [fieldFor(job.input.kind)];
  for (const r of job.input.records)
    for (const field of fields) {
      const current = await readKeyword(r.id);
      if (
        current?.[field]?.jobId === job.id &&
        ['queued', 'running'].includes(current[field].status)
      )
        await patchCollection(r.id, field, {
          ...current[field],
          status: 'cancelled',
          finishedAt: new Date().toISOString(),
          message: '任务已取消，已获取的结果保留',
        });
    }
}
export async function runEnrichment(job, overrides = {}) {
  const io = {
    collect,
    readKeyword,
    patchCollection,
    saveCheckpoint,
    async isCancelled() {
      return Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      );
    },
    saveSite: async (site) => {
      const { mergeBusiness } = await import('./market-jobs.mjs');
      await mergeBusiness(`sites:${site.id}`, site);
      try {
        const result = await collect(job, `site-score:${site.id}`, {
          sources: ['site_metrics'],
          domain: site.domain,
          market: site.market,
        });
        await mergeBusiness(`sites:${site.id}`, {
          metrics: result.metrics || undefined,
          metricsStatus: result.metrics ? '已补齐' : '未收录',
          metricsMessage: result.message,
        });
      } catch (e) {
        await mergeBusiness(`sites:${site.id}`, {
          metricsStatus: '待补充',
          metricsMessage: e.message,
        });
      }
    },
    ...overrides,
  };
  const cp = {
    index: 0,
    failures: 0,
    shortfalls: 0,
    logs: [],
    ...job.checkpoint,
  };
  const { kind, records, maxSites } = job.input;
  const field = fieldFor(kind);
  cp.startedAt ||= new Date().toISOString();
  for (; cp.index < records.length; cp.index++) {
    if (await io.isCancelled()) {
      await io.saveCheckpoint(job, cp, 'cancelled');
      return;
    }
    const r = records[cp.index];
    const current = await io.readKeyword(r.id);
    if (!current || (kind === 'sites' && current.reviewStatus !== 'selected')) {
      await io.patchCollection(r.id, field, {
        jobId: job.id,
        status: 'cancelled',
        message: '关键词已移出入选列表，跳过采集',
      });
      cp.logs.push(`${r.term}：已移出入选列表，跳过`);
      cp.shortfalls++;
      continue;
    }
    const base = {
      jobId: job.id,
      target: kind === 'sites' ? maxSites : 1,
      count: 0,
      startedAt: new Date().toISOString(),
    };
    await io.patchCollection(r.id, field, {
      ...base,
      status: 'running',
      message: '后台采集中',
    });
    await io.saveCheckpoint(job, { ...cp, currentTerm: r.term });
    try {
      const result = await io.collect(job, `${kind}:${cp.index}`, {
        keywords: [r.term],
        markets: [r.market],
        sources: [kind === 'sites' ? 'site_discovery' : 'semrush'],
        maxSites,
        productsPerSite: 1,
        sorftimeRequestLimit: 0,
      });
      let extra, count, message;
      if (kind === 'sites') {
        const group = result.groups?.find(
          (g) => g.market === r.market && g.keyword === r.term,
        );
        if (!group || !Array.isArray(group.sites))
          throw new Error('采集服务未返回对应关键词的站点结果');
        const sites = group.sites.slice(0, maxSites);
        for (const site of sites) {
          const { products: _products, ...data } = site;
          await io.saveSite({
            ...data,
            sources: ['Brave Search'],
            sourceEvidence: [
              {
                source: 'Brave Search',
                keyword: r.term,
                url: site.evidenceUrl,
                collectedAt: site.lastCollectedAt,
              },
            ],
            dataNature: 'collected',
          });
        }
        count = sites.length;
        extra = { siteIds: sites.map((s) => s.id) };
        message = `本次验证 ${count}/${maxSites} 家站点；搜索返回 ${group.coverage?.searchResults ?? '未知'} 条，检查 ${group.coverage?.candidateDomains ?? '未知'} 个域名。${count < maxSites ? '未达目标：搜索候选不足、官网不可访问或未通过电商验证；可查看已采集结果或重新采集。' : '已完成目标数量采集。'}`;
      } else {
        count = result.metrics ? 1 : 0;
        extra = result.metrics ? { metrics: result.metrics } : {};
        message =
          result.message ||
          (count
            ? 'Semrush 指标已更新并重新评分'
            : 'Semrush 未收录该词，缺项保留未知');
      }
      const cancelled = await io.isCancelled();
      const status = cancelled
        ? 'cancelled'
        : kind === 'metrics' && result.metrics && result.complete === false
          ? 'partial'
          : count >= base.target
            ? 'completed'
            : count
              ? 'partial'
              : 'empty';
      if (status !== 'completed') cp.shortfalls++;
      await io.patchCollection(
        r.id,
        field,
        {
          ...base,
          status,
          count,
          message,
          finishedAt: new Date().toISOString(),
          apiUnits: result.apiUnits,
        },
        extra,
      );
      cp.logs.push(`${r.term}：${message}`);
      if (cancelled) {
        await io.saveCheckpoint(job, cp, 'cancelled');
        return;
      }
    } catch (e) {
      const cancelled = await io.isCancelled();
      cp.failures++;
      await io.patchCollection(r.id, field, {
        ...base,
        status: cancelled ? 'cancelled' : 'failed',
        message: String(e.message).slice(0, 600),
        finishedAt: new Date().toISOString(),
      });
      cp.logs.push(`${r.term}：${e.message}`);
      // An auth/quota problem will affect every remaining term; stop issuing paid calls.
      if (kind === 'metrics') {
        for (const remaining of records.slice(cp.index + 1))
          await io.patchCollection(remaining.id, field, {
            jobId: job.id,
            status: 'failed',
            count: 0,
            message:
              'Semrush 权限、额度或限流异常，已停止后续调用；请先核对配置',
            finishedAt: new Date().toISOString(),
          });
        cp.failures += records.length - cp.index - 1;
        cp.index = records.length;
        break;
      }
    }
    await io.saveCheckpoint(job, { ...cp, index: cp.index + 1 });
  }
  cp.finishedAt = new Date().toISOString();
  await io.saveCheckpoint(
    job,
    cp,
    cp.failures || cp.shortfalls ? 'partial' : 'completed',
  );
}
