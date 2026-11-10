export function normalizeAsin(value: unknown): string;
export function productAsin(
  product:
    | null
    | undefined
    | {
        asin?: string;
        sourcePlatform?: string;
        sourceProductId?: string;
      },
): string;
export function productAmazonUrl(
  product: Parameters<typeof productAsin>[0] & {
    sourceMarket?: string;
    market?: string;
    sourceUrl?: string;
    evidenceUrl?: string;
  },
): string;
