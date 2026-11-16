import { validDiscoveryDate } from './discovery-newness.mjs';
import { weekStart } from './weekly-summary-domain.mjs';

export const weeklyMemberKey = (market, week, kind) =>
  `read:weekly-members:${market}:${week}:${kind}`;

export function validateSummaryWeek(value) {
  if (typeof value !== 'string' || value.length !== 10 ||
    validDiscoveryDate(value) === undefined || weekStart(value) !== value)
    throw new Error('周统计日期必须为有效的周一日期');
  return value;
}

// The IDs are published in the same transaction as the displayed counts. This
// also preserves historical seven-day eligibility when today's newness changes.
export function weeklyMemberCondition(input, collection, bind, sql) {
  if (input.summaryWeek === undefined && input.summaryNew === undefined) return '';
  if (!['ads', 'products'].includes(collection)) throw new Error('周汇总列表类型无效');
  const week = validateSummaryWeek(input.summaryWeek);
  if (input.summaryNew !== undefined && !['0', '1'].includes(input.summaryNew))
    throw new Error('周汇总新品筛选无效');
  const market = ['MX', 'US', 'VN'].includes(input.market) ? input.market : 'ALL';
  const key = bind(weeklyMemberKey(market, week, collection));
  const field = input.summaryNew === '1' ? 'newIds' : 'ids';
  return sql(
    `r.id IN (SELECT jsonb_array_elements_text(d.value->'${field}') FROM workspace_documents d WHERE d.name=${key})`,
    `r.id IN (SELECT weekly_member.id COLLATE utf8mb4_bin FROM workspace_documents d JOIN JSON_TABLE(d.value,'$.${field}[*]' COLUMNS(id VARCHAR(160) PATH '$')) AS weekly_member ON TRUE WHERE d.name=${key})`,
  );
}
