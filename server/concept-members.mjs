import { createHash } from 'node:crypto';

import { batchName } from './collection-batch-domain.mjs';

export const conceptMemberKey = (market, batch, kind) =>
  `read:concept-members:${market}:${createHash('sha256').update(batchName(batch)).digest('hex')}:${kind}`;

export function conceptMemberCondition(input, collection, bind, sql) {
  if (!input.conceptBatch) return '';
  if (
    !['ads', 'keywords', 'products', 'sites'].includes(collection) ||
    typeof input.conceptBatch !== 'string' ||
    !batchName(input.conceptBatch) ||
    batchName(input.conceptBatch).length > 100
  )
    throw new Error('采集批次筛选无效');
  if (input.conceptDay && !/^\d{4}-\d{2}-\d{2}$/.test(input.conceptDay))
    throw new Error('新增统计日期无效');
  const market = ['MX', 'US', 'VN'].includes(input.market)
    ? input.market
    : 'ALL';
  const key = bind(conceptMemberKey(market, input.conceptBatch, collection));
  const field = input.conceptDay ? 'todayIds' : 'ids';
  const day = input.conceptDay ? bind(input.conceptDay) : '';
  const dayCondition = day
    ? sql(
        ` AND d.value->>'day'=${day}`,
        ` AND JSON_UNQUOTE(JSON_EXTRACT(d.value,'$.day'))=${day}`,
      )
    : '';
  return sql(
    `r.id IN (SELECT jsonb_array_elements_text(d.value->'${field}') FROM workspace_documents d WHERE d.name=${key}${dayCondition})`,
    `r.id IN (SELECT batch_member.id FROM workspace_documents d JOIN JSON_TABLE(d.value,'$.${field}[*]' COLUMNS(id VARCHAR(160) PATH '$')) AS batch_member ON TRUE WHERE d.name=${key}${dayCondition})`,
  );
}
