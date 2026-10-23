export const publicEvidenceReasons: Record<string, string>;
export function publicEvidenceReason(reason?: string): string;
export function publicEvidenceStatus(reason?: string): 'not_disclosed' | 'budget_limited' | 'unsupported' | 'failed' | 'unverified';
