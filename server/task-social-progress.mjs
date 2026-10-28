// Project independent social work into its parent without writing the parent's
// checkpoint (the keyword and social workers can finish at the same time).
export async function decorateSocialTasks(tasks, jobs, connection) {
  const selected = jobs.filter(
    (j) => j.input?.socialTrends && j.checkpoint?.socialTrendDispatch,
  );
  if (!selected.length) return tasks;
  const names = [
    ...new Set(
      selected.map(
        (j) => 'keyword-trends:run:' + j.checkpoint.socialTrendDispatch.day,
      ),
    ),
  ];
  const runs = (
    await connection.query(
      'SELECT name,value FROM workspace_documents WHERE name IN (' +
        names.map((_, i) => '$' + (i + 1)).join(',') +
        ')',
      names,
    )
  ).rows;
  const commands = (
    await connection.query(
      "SELECT name,value FROM workspace_documents WHERE name LIKE 'keyword-trends:inbox:%' OR name LIKE 'keyword-trends:submission:%'",
    )
  ).rows;
  const byJob = new Map();
  for (const job of selected) {
    const work =
      runs.find((r) => r.name.endsWith(job.checkpoint.socialTrendDispatch.day))
        ?.value.work || [];
    const groups = new Map();
    const words = job.checkpoint.keywords || job.input.existingRecords || [];
    for (const w of work.filter(
      (w) =>
        job.input.socialTrends.sources.includes(w.source) &&
        words.some(
          (k) =>
            k.id === w.keywordId && k.term === w.term && k.market === w.market,
        ),
    )) {
      const key = w.keywordId + ':' + w.source;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    const command = commands.find((r) => r.value.parentJobId === job.id);
    const rows = [];
    for (const entries of groups.values()) {
      entries.sort((a, b) => a.page - b.page);
      const last = entries.at(-1);
      rows.push({
        id: 'social:' + last.keywordId + ':' + last.source,
        title:
          last.term +
          ' · ' +
          ({ tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[
            last.source
          ] || last.source),
        market: last.market,
        status: last.status,
        done: last.status === 'pending' ? 0 : 1,
        total: 1,
        message: last.reason || '独立来源队列等待执行',
        executions: entries.map((w) => ({
          at: w.at,
          step: w.source + ' · 第' + w.page + '页',
          status: w.status,
          message: w.reason,
        })),
      });
    }
    if (command?.name.includes(':inbox:'))
      for (const word of command.value.words || [])
        for (const source of command.value.plan.sources)
          if (!groups.has(word.id + ':' + source))
            rows.push({
              id: 'social:' + word.id + ':' + source,
              title: word.term + ' · ' + source,
              status: 'pending',
              done: 0,
              total: 1,
              message: '已提交队列，等待后台处理',
              executions: [],
            });
    if (!rows.length && job.checkpoint.socialTrendDispatch.accepted)
      rows.push({
        id: 'social:dispatch',
        title: '社媒趋势采集',
        status: command?.value.status === 'expired' ? 'skipped' : 'pending',
        done: command?.value.status === 'expired' ? 1 : 0,
        total: 1,
        message: command?.value.reason || '等待独立队列处理',
        executions: [],
      });
    byJob.set(job.id, rows);
  }
  return tasks.map((task) => {
    const rows = byJob.get(task.cloudJobId);
    if (!rows?.length || !task.overview) return task;
    const o = { ...task.overview };
    const pending = rows.filter((r) => r.status === 'pending').length;
    const failed = rows.filter(
      (r) => !['completed', 'pending', 'submitted'].includes(r.status),
    ).length;
    o.total += rows.length;
    o.processed += rows.length - pending;
    o.failed += failed;
    if (o.succeeded !== null) o.succeeded += rows.length - pending - failed;
    o.remaining = Math.max(0, o.total - o.processed);
    o.percent = Math.round((o.processed / o.total) * 100);
    let status = task.status;
    if (status !== 'cancelled' && pending) status = 'running';
    else if (['awaiting_review', 'completed'].includes(status) && failed)
      status = 'partial';
    o.status = status;
    if (pending) o.outcome = '社媒采集仍在执行或排队';
    else if (failed) o.outcome = '已停止 · 部分社媒未采集完';
    const reason = rows
      .filter((r) => !['completed', 'pending', 'submitted'].includes(r.status))
      .map((r) => r.message)
      .filter(Boolean);
    o.reason = [o.reason, ...new Set(reason)].filter(Boolean).join('；');
    return {
      ...task,
      status,
      overview: o,
      ...(task.collections
        ? { collections: [...task.collections, ...rows] }
        : {}),
    };
  });
}
