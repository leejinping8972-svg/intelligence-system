export type SiteSource = {
  source: string;
  keyword?: string;
  query?: string;
  url?: string;
  collectedAt?: string;
  domain?: string;
};
export type SiteProvenanceInput = {
  keyword?: string;
  query?: string;
  queryTerms?: string[];
  sourceEvidence?: SiteSource[];
  mainProducts?: string[];
  categoryEvidence?: string[];
};
export type ProvenanceRow = {
  domain?: string;
  source: string;
  text: string;
  url: string;
  collectedAt: string;
};
export function sourceSiteDomain(value: unknown): string;
export function siteKeywordProvenance(site: SiteProvenanceInput): {
  queryTerms: string[];
  nonSearchTerms: string[];
  discoveries: ProvenanceRow[];
  evidence: ProvenanceRow[];
};
