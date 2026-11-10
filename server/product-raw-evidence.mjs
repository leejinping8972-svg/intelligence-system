// Source observations are atomic: an omitted observation keeps the old proof,
// while a reported zero replaces it together with its provider and timestamp.
export function mergeProductRawEvidence(previous, incoming) {
  const merged = { ...previous, ...incoming };
  if (incoming?.salesEvidence == null && previous?.salesEvidence != null)
    merged.salesEvidence = previous.salesEvidence;
  return merged;
}
