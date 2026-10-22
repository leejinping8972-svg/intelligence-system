import { insightSummary } from './consumer-topics.mjs';

export function projectReportSummary(report) {
  return {
    ...insightSummary(report),
    listSummary: true,
    marketSnapshot: report.marketSnapshot ? { coverage: report.marketSnapshot.coverage } : undefined,
  };
}

export async function readReportSummaries(pool) {
  const ready = (await pool.query("SELECT value FROM workspace_documents WHERE name='read:reports-ready'")).rows.length;
  if (!ready) return (await pool.query("SELECT value,revision FROM workspace_documents WHERE name LIKE 'business:insightReports:%'")).rows.map(row => projectReportSummary({ ...row.value, revision: row.revision }));
  const rows = (await pool.query("SELECT source_key,payload FROM workspace_read_rows WHERE collection='insightReports'")).rows;
  // Overlay only unindexed changes so a just-submitted report is visible immediately.
  const changes = (await pool.query("SELECT q.source_key,d.value,d.revision FROM workspace_read_dirty q LEFT JOIN workspace_documents d ON d.name=q.source_key WHERE q.kind='business' AND q.source_key LIKE 'business:insightReports:%'")).rows;
  const dirty = new Set(changes.map(row => row.source_key));
  return [
    ...rows.filter(row => !dirty.has(row.source_key)).map(row => row.payload),
    ...changes.filter(row => row.value).map(row => projectReportSummary({ ...row.value, revision: row.revision })),
  ];
}
