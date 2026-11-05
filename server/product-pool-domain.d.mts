export const POOL_TYPES: string[];
export const NEW_PRODUCT_RULES: string;
export function inNewProductPool(
  product: { newProductClassifications?: { type: string }[] } | undefined,
): boolean;
export function poolType(product: {
  newProductClassifications?: { type: string; fulfillment?: string }[];
}): 'fbm_new' | 'regular_new';
export function dailyNewProductPlan<T>(plan: T): T;
export function previousListingWindow(
  days: number,
  now?: number,
): { start: string; end: string };
