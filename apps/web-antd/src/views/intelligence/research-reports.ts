import type { ConsumerTopic } from './consumer-reports';
import type { Market } from './data';
export interface ResearchEvidence {
  id: string;
  text: string;
  url: string;
  platform: string;
  kind: string;
  market: Market;
  postedAt?: string;
  collectedAt?: string;
  likes?: number;
  sourceUrl?: string;
  query?: string;
  brand?: string;
  transcript?: string;
  landingUrl?: string;
  collectionSource?: string;
  headline?: string;
  startDate?: string;
  status?: string;
}
export interface ResearchReport {
  topicSummary?: ConsumerTopic[];
  sourceCount?: number;
  confidence?: string;
  revision?: number;
  id: string;
  kind: string;
  title: string;
  market: Market;
  createdAt: string;
  status: string;
  reportType?: 'ad' | 'consumer' | 'market' | 'persona';
  period?: 'month' | 'quarter' | 'week';
  endDate?: string;
  marketSnapshot?: {
    startAt: string;
    endAt: string;
    frozenAt: string;
    coverage: {
      products: number;
      tiktokShopProducts: number;
      independentSiteProducts: number;
      activeMetaAds: number;
      independentSites: number;
      tiktokContent: number;
      consumerComments: number;
    };
    topProducts: Array<{
      id: string;
      title: string;
      brand: string;
      source: string;
      reportedSales: number;
      reviewCount: number;
      rating: number;
    }>;
    topIngredients: Array<{ name: string; count: number }>;
    topAdvertisers: Array<{ name: string; ads: number; landingSites: number }>;
    topContent: Array<{
      id: string;
      title: string;
      source: string;
      likes: number;
      comments: number;
      url: string;
    }>;
    limitations: string[];
  };
  documentVersion?: number;
  finishedAt?: string;
  researchFocus?: string;
  parentReportId?: string;
  prompt?: ReportPrompt;
  hasModelAnalysis?: boolean;
  modelName?: string;
  promptVersion?: string;
  message?: string;
  evidenceIds: string[];
  keywordIds?: string[];
  siteIds?: string[];
  productIds?: string[];
  requests?: number;
  creditsCharged?: number;
  unknownCharges?: number;
  modelError?: string;
  reviewStatus?: string;
  reviewNote?: string;
  statistics?: {
    method: string;
    sampleSize: number;
    sourceCount: number;
    confidence: string;
    limitations: string[];
    themes: Array<{
      key: string;
      label: string;
      count: number;
      sourceCount: number;
      evidenceIds: string[];
      suggestion: string;
    }>;
  };
  modelAnalysis?: {
    schemaVersion?: number;
    systemPrompt?: string;
    prompt?: ReportPrompt;
    researchFocus?: string;
    coverage?: {
      sourceEvidenceCount: number;
      uniqueCreativeCount: number;
      analyzedEvidenceCount: number;
      brandCount: number;
      transcriptCount: number;
      truncatedCount: number;
      omittedCount: number;
      method: string;
    };
    summary: string;
    method: string;
    model: string;
    inputEvidenceCount: number;
    totalEvidenceCount: number;
    usage?: { total_tokens?: number };
    findings: Array<{
      label: string;
      interpretation: string;
      suggestion: string;
      evidenceIds: string[];
      section?: string;
      observation?: string;
      confidence?: string;
      quotes?: Array<{ evidenceId: string; text: string }>;
      test?: {
        hypothesis: string;
        control: string;
        variant: string;
        constant: string;
        metric: string;
        decisionRule: string;
        priority: string;
      };
    }>;
    limitations: string[];
  };
}
export interface ReportPrompt {
  text: string;
  version: string;
  schemaVersion: number;
  systemContract?: string;
  updatedAt?: null | string;
  updatedBy?: string;
}
