export interface DiscoveryDecision {
  version: string;
  isNew: boolean | null;
  label: string;
  reason: string;
  recentDiscovery: boolean;
  windowDays: number;
  source: string;
  evidenceDate: string;
  evidenceUrl: string;
  evaluatedAt: string;
}
export interface DiscoveryObservation {
  version: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observationDays: string[];
  decision: DiscoveryDecision;
}
export function discoveryDecision(
  item: object,
  kind: 'ad' | 'product',
  now?: number,
): DiscoveryDecision;
export function validDiscoveryDate(value: unknown): number | undefined;
export function observeDiscovery(
  old: object | undefined,
  patch: object,
  kind: 'ad' | 'product',
  now?: number,
): object;
export function protectDiscoveryEdit(
  old: object | undefined,
  incoming: object,
): object;
