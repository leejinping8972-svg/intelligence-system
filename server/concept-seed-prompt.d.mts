export const CONCEPT_SEED_OUTPUT_SPEC: string;

export function conceptSeedMessages(
  taskName: string,
  description?: string,
): Array<{ content: string; role: 'system' | 'user' }>;
