// Only confirmed charges attributed to the current key can reduce its allowance.
// Missing saved usage must remain unknown rather than looking like zero spend.
export function calculatedSemrushQuota(manual, usage) {
  const total = typeof manual?.total === 'number' &&
    Number.isFinite(manual.total) && manual.total >= 0 ? manual.total : null;
  const spent = usage?.currentKey?.confirmedUnits;
  const available = usage?.currentKeyAvailable === true &&
    usage.keyConfigured === true && Number.isSafeInteger(spent) && spent >= 0;
  return {
    total,
    remaining: total !== null && available ? Math.max(0, total - spent) : null,
    expiresAt: manual?.expiresAt || null,
    updatedAt: usage?.checkedAt || manual?.updatedAt || null,
    origin: 'calculated',
  };
}
