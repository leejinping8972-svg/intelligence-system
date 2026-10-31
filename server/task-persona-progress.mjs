const terminal = (s) => !['queued', 'running'].includes(s);
const sourceLabel = { products: '商品', content: '内容', comments: '评论' };
export function personaTaskProgress(study) {
  const journal = study.journal || [];
  const stopped = terminal(study.status);
  const unknown = journal.some(
    (j) => j.status === 'unknown' || (stopped && j.status === 'reserved'),
  );
  const rows = [
    {
      id: 'persona:reuse',
      title: '复用已有证据',
      status: study.reuseFrozen
        ? 'completed'
        : stopped
          ? 'not_started'
          : 'running',
      done: study.reuseFrozen ? 1 : 0,
      total: 1,
      message: study.reuseFrozen ? '已完成已有证据筛选，证据保留待审核' : '',
      executions: [],
    },
  ];
  const row = (id, title, entries) => {
    const last = entries.at(-1);
    const status = last
      ? last.status === 'reserved'
        ? stopped
          ? 'unknown'
          : 'running'
        : last.status === 'done'
          ? 'completed'
          : last.status
      : stopped
        ? 'not_started'
        : 'pending';
    const message =
      status === 'unknown'
        ? '请求结果或扣费未确认，已停止后续收费请求'
        : status === 'completed'
          ? '已返回 ' + (last.received ?? 0) + ' 条，证据仍需审核'
          : status === 'running'
            ? '正在等待来源响应'
            : status === 'not_started'
              ? study.status === 'cancelled'
                ? '用户取消，尚未执行'
                : unknown
                  ? '前序请求结果或扣费未确认，本项未执行'
                    : '本轮未执行；可能没有符合条件的视频或来源样本'
              : '等待来源队列';
    return {
      id,
      title,
      status,
      done: last && last.status !== 'reserved' ? 1 : 0,
      total: 1,
      message,
      executions: entries.map((j) => ({
        at: j.at,
        step: sourceLabel[j.source] || j.source,
        status:
          j.status === 'done'
            ? 'done'
            : j.status === 'reserved'
              ? stopped
                ? 'unknown'
                : 'started'
              : 'unknown',
        message:
          j.status === 'unknown' || (stopped && j.status === 'reserved')
            ? '结果或扣费未确认，未重放'
            : j.status === 'reserved'
              ? '请求已发出，等待来源响应'
              : '返回 ' + (j.received ?? 0) + ' 条',
      })),
    };
  };
  if (study.plan.acquire === true || (study.plan.acquire === undefined && study.plan.budget.requests > 0)) {
    for (const q of study.queries || [])
      for (const source of study.plan.sources.filter((s) => s !== 'comments'))
        rows.push(
          row(
            q.id + ':' + source,
            q.query + ' · ' + (sourceLabel[source] || source),
            journal.filter((j) => j.key === q.id + ':' + source),
          ),
        );
    if (study.plan.sources.includes('comments')) {
      const entries = journal.filter((j) => j.source === 'comments');
      rows.push(
        row(
          'persona:comments',
          '符合条件视频的评论（最多 ' +
            study.plan.budget.commentVideos +
            ' 条视频）',
          entries,
        ),
      );
      const r = rows.at(-1);
      if (!stopped && !unknown) {
        r.status = 'pending';
        r.done = 0;
        r.message =
          '已请求 ' + entries.length + ' 条视频，等待本轮评论采集结束';
      } else if (entries.length && !unknown) {
        r.status = 'completed';
        r.done = 1;
      }
    }
  }
  const failed = rows.filter((r) =>
    ['failed', 'not_started', 'unknown'].includes(r.status),
  ).length;
  return {
    rows,
    total: rows.length,
    processed: rows.filter(
      (r) => r.done || ['failed', 'not_started', 'unknown'].includes(r.status),
    ).length,
    succeeded: rows.filter((r) => r.status === 'completed').length,
    failed,
    unknownCharges: unknown ? 1 : 0,
    reason:
      study.status === 'cancelled'
        ? '用户取消，已有证据保留'
        : unknown
          ? '来源扣费或请求结果未确认，停止后续收费调用；已有证据保留'
          : stopped
            ? failed
              ? '本轮采集已停止，未执行项见详情；已有证据待审核'
              : '本轮采集结束，已有证据待人工审核与分析'
            : '',
  };
}
