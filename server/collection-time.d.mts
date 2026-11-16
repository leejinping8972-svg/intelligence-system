export function resourceCollectionTime(collection: string, value: any): string;
export function shanghaiDay(now?: number): string;
export function collectionRange(
  from?: string,
  to?: string,
): { from: string; to: string };
export function matchesCollectionRange(
  collection: string,
  value: any,
  from?: string,
  to?: string,
  basis?: 'first' | 'latest',
): boolean;
export function productFirstCollectionTime(value: any): string;
export function productDiscoveryDay(value: any): string;
