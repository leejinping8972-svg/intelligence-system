type ProductSortRecord = {
  lastCollectedAt?: string;
  sourceMetrics?: { collectedAt?: string; soldRaw?: string; soldCount?: number };
  sourceContent?: { collectedAt?: string };
};
export const productSortKeys: string[];
export function productCollectionTime(product: ProductSortRecord): string | undefined;
export function displayedSalesOrder(metrics?: ProductSortRecord['sourceMetrics']): number | null;
export function productSortValue(product: ProductSortRecord, key: string): number | string | null;
export function compareProductValues(a: number | string | null | undefined, b: number | string | null | undefined, order?: string): number;
