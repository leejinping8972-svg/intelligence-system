export function productListingDate(product: unknown, now?: number): string;
export function validateListingRange(
  from?: string,
  to?: string,
): { from: string; to: string };
export function matchesListingRange(
  product: unknown,
  from?: string,
  to?: string,
  now?: number,
): boolean;
export function recentListingRange(
  days: number,
  now?: number,
): [string, string];
