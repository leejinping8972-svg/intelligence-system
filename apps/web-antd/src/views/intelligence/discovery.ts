export { discoveryDecision } from '../../../../../server/discovery-newness.mjs';
export type { DiscoveryObservation } from '../../../../../server/discovery-newness.mjs';

export const discoveryFilters = [
  { value: 'ALL', label: '全部新旧标签' },
  { value: 'yes', label: '来源确认近期新增' },
  { value: 'no', label: '非近期新增' },
  { value: 'unknown', label: '新旧待核验' },
  { value: 'discovered', label: '7天内首次发现' },
];
