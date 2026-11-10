export function sourceSellerName(row: unknown): string;
export interface AmazonSellerDetails {
  status: 'available' | 'unavailable';
  sellerName: string;
  sellerId?: string;
  market: string;
  businessName: string;
  businessAddress: string[];
  nationality?: string;
  collectedAt: string;
  provider: 'Sorftime';
  lookup: 'id' | 'exact_name';
}
export interface SellerProduct {
  sellerName?: string;
  sellerId?: string;
  sellerDetails?: AmazonSellerDetails;
  sourcePlatform?: string;
  sourceMarket?: string;
  sourceProductId?: string;
  market?: string;
  resourceRaw?: unknown;
}
export function sellerNameKey(value: unknown): string;
export function normalizeSellerId(value: unknown): string;
export function sourceSellerId(row: unknown): string;
export function productSellerId(product: SellerProduct): string;
export function productSellerDetails(
  product: SellerProduct,
): AmazonSellerDetails | undefined;
export function productSellerUrl(product: SellerProduct): string;
export function productSellerName(
  product:
    | null
    | undefined
    | {
        sellerName?: string;
        resourceRaw?: unknown;
        sourceMetrics?: { shopName?: string };
        resourceEvidence?: { identity?: { shopName?: string } };
      },
): string;
