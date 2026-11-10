export function sourceSellerName(row: unknown): string;
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
