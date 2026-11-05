import { createHash } from 'node:crypto';

import { projectJobTasks } from './task-projection.mjs';
import { decorateAnalysisTasks, visibleTaskSource } from './source-analysis-stage.mjs';
import { decorateKeywordTasks } from './task-keyword-executions.mjs';

const digest = (rows) =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

// Metadata reads avoid loading media, transcripts and trend arrays on idle polls.
// Include IDs in the revision so deletion/replacement is detected as well as updates.
export async function workspaceSnapshot(
  input,
  {
    pool,
    jobTasks,
    scoreSite,
    isWorkspaceSyncKey,
    readVersions,
    decorateTasks,
    sql = (postgres) => postgres,
  },
) {
  const [businessMeta, keywordMeta, taskMeta] = readVersions
    ? []
    : await Promise.all([
        pool.query(
          "SELECT name,revision FROM workspace_documents WHERE name LIKE 'business:%' ORDER BY name",
        ),
        pool.query(
          sql(
            'SELECT natural_key,updated_at,md5(data::text) AS content_hash FROM research_keywords ORDER BY natural_key',
            'SELECT natural_key,updated_at,MD5(CAST(data AS CHAR CHARACTER SET utf8mb4)) AS content_hash FROM research_keywords ORDER BY natural_key',
          ),
        ),
        pool.query(
          sql(
            `SELECT id,updated_at,status,cancelled,md5(checkpoint::text || input::text) AS content_hash FROM ${visibleTaskSource(sql)} ORDER BY created_at DESC,id DESC LIMIT 200`,
            `SELECT id,updated_at,status,cancelled,MD5(CONCAT(CAST(checkpoint AS CHAR CHARACTER SET utf8mb4),CAST(input AS CHAR CHARACTER SET utf8mb4))) AS content_hash FROM ${visibleTaskSource(sql)} ORDER BY created_at DESC,id DESC LIMIT 200`,
          ),
        ),
      ]);
  const revisions = readVersions
    ? await readVersions()
    : {
        business: digest(businessMeta.rows),
        keywords: digest(keywordMeta.rows),
        tasks: digest(taskMeta.rows),
      };
  const previous = input.revisions || {};
  const channels = new Set(input.channels || ['business', 'keywords', 'tasks']);
  const result = { revisions, generatedAt: new Date().toISOString() };
  await Promise.all([
    !channels.has('business') || previous.business === revisions.business
      ? null
      : (async () => {
          const { rows } = await pool.query(
            "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:%'",
          );
          result.business = {
            entries: rows
              .filter((r) => isWorkspaceSyncKey(r.name.slice(9)))
              .map((r) => ({
                key: r.name.slice(9),
                value: r.name.startsWith('business:sites:')
                  ? { ...r.value, assessment: scoreSite(r.value) }
                  : r.value,
              })),
          };
        })(),
    !channels.has('keywords') || previous.keywords === revisions.keywords
      ? null
      : (async () => {
          const { rows } = await pool.query(
            'SELECT data FROM research_keywords ORDER BY updated_at DESC LIMIT 10000',
          );
          result.keywords = rows.map((r) => r.data);
        })(),
    !channels.has('tasks') || previous.tasks === revisions.tasks
      ? null
      : (async () => {
          const { rows } = await pool.query(
            `SELECT * FROM ${visibleTaskSource(sql)} ORDER BY created_at DESC,id DESC LIMIT 200`,
          );
          const projected = rows.flatMap((job) =>
            projectJobTasks(job, jobTasks),
          );
          const keywordTasks = await decorateKeywordTasks(projected, rows, pool);
          const decorated = await decorateAnalysisTasks(keywordTasks, rows, pool, sql);
          result.tasks = (
            decorateTasks ? await decorateTasks(decorated, rows) : decorated
          ).map(compactTask);
        })(),
  ]);
  return result;
}

export function compactTask(task) {
  const { collections: _collections, ...summary } = task;
  const result = { ...summary, steps: task.steps.slice(-1) };
  if (task.progress) result.progress = { ...task.progress, rows: [] };
  if (task.researchProgress)
    result.researchProgress = {
      ...task.researchProgress,
      rows: [],
      requestLog: [],
    };
  return result;
}
