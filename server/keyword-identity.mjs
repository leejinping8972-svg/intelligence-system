// Terms can be written with a space or a hyphen without changing the
// keyword a shopper is looking for. Keep the original spelling for display,
// but use this identity when comparing saved records.
const keywordDash = /[-‐‑‒–—−﹘﹣－]+/g;

// Storage keys stay stable: existing records, human choices and links are not
// rewritten when display equivalence becomes broader.
export function keywordStorageIdentity(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(keywordDash, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Only known count nouns: removing an arbitrary trailing s would corrupt
// ingredients/conditions such as citrus, diabetes, gas and stress.
const countNouns =
  'peptide tripeptide tetrapeptide oligopeptide polypeptide vitamin multivitamin supplement capsule tablet softgel powder probiotic prebiotic postbiotic synbiotic electrolyte protein fiber fibre ingredient acid oil extract mineral antioxidant aminoacid enzyme nutrient collagen serum cream lotion gel product formula dose benefit review result comparison gummy berry'.split(
    ' ',
  );
const plurals = new Map(
  countNouns.map((word) => [
    { gummy: 'gummies', berry: 'berries' }[word] || `${word}s`,
    word,
  ]),
);

export function keywordIdentity(value) {
  return keywordStorageIdentity(value)
    .split(' ')
    .map((word) => plurals.get(word) || word)
    .join(' ');
}

// The same dictionary powers SQL and JS. Cached projection identities avoid
// applying the legacy fallback to every historical row after refresh.
export function keywordIdentitySql(sql, alias, { cached = true } = {}) {
  const field = sql(
    `COALESCE(${alias}.payload->>'term','')`,
    `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.payload,'$.term')), '')`,
  );
  let expression = sql(
    `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(${field}, '[-‐‑‒–—−﹘﹣－]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')))`,
    `LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(${field}, '[-‐‑‒–—−﹘﹣－]+', ' '), '[[:space:]]+', ' ')))`,
  );
  const regular = countNouns
    .filter((word) => !['gummy', 'berry'].includes(word))
    .join('|');
  const pattern = `(^| )(${regular})s(?= |$)`;
  // CHAR(36) keeps ICU backreferences out of the database adapter's $n binds.
  expression = sql(
    `REGEXP_REPLACE(${expression},'${pattern}',E'\\\\1\\\\2','g')`,
    `REGEXP_REPLACE(${expression},'${pattern}',CONCAT(CHAR(36),'1',CHAR(36),'2'))`,
  );
  expression = `CONCAT(' ',${expression},' ')`;
  for (const [plural, singular] of [
    ['gummies', 'gummy'],
    ['berries', 'berry'],
  ]) {
    expression = `REPLACE(REPLACE(${expression},' ${plural} ',' ${singular} '),' ${plural} ',' ${singular} ')`;
  }
  expression = `TRIM(${expression})`;
  return cached
    ? sql(
        `COALESCE(${alias}.payload->>'keywordIdentity',${expression})`,
        `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.payload,'$.keywordIdentity')),${expression})`,
      )
    : expression;
}
