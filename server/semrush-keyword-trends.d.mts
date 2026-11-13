export interface SemrushSearchTrend {
  version: 1;
  status: 'collected' | 'unavailable' | 'unsupported' | 'invalid';
  scale: 'relative_0_1';
  values?: number[];
  collectedAt: string;
  report: string;
  message: string;
}
export interface SemrushExtraMetrics {
  searchResultCount?: number;
  relatedRelevance?: number;
  relatedTo?: string;
  serpFeatures?: string[];
  semrushColumns?: string[];
  searchTrend?: SemrushSearchTrend;
}
export const SEMRUSH_KEYWORD_COLUMNS: string[];
export function semrushExportColumns(schema: unknown, includeTrend?: boolean): string[];
export function validSemrushTrend(value: unknown): boolean;
export function parseSemrushTrend(
  raw: unknown,
  collectedAt: string,
  report: string,
  supported?: boolean,
): SemrushSearchTrend;
export function semrushExtraMetrics(
  row: Record<string, unknown>,
  at: string,
  report: string,
  columns?: string[],
): SemrushExtraMetrics;
export function sanitizeSemrushExtras(
  metrics: SemrushExtraMetrics,
): SemrushExtraMetrics;
export function semrushTrendSummary(
  metrics:
    | (SemrushExtraMetrics & { market: string; source: string })
    | undefined,
  market: string,
): {
  available: boolean;
  values: number[];
  collectedAt: string;
  message: string;
  monthChange: number | null;
  quarterChange: number | null;
  halfChange: number | null;
  peakPositions: number[];
  latestHeat: number | null;
};
