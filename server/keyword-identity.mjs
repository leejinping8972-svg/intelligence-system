// Terms can be written with a space or a hyphen without changing the
// keyword a shopper is looking for. Keep the original spelling for display,
// but use this identity when comparing saved records.
const keywordDash = /[-‐‑‒–—−﹘﹣－]+/g;

export function keywordIdentity(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(keywordDash, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
