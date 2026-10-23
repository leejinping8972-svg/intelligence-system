const cumulative = (node) => ['period', 'window', 'interval', 'salesPeriod', 'soldPeriod', 'sold_count_period', 'time_window'].every((key) => node?.[key] === undefined || /^(?:all[_ -]?time|total|cumulative|lifetime)$/i.test(String(node[key])));
const units = (value) => {
  let raw = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.unitCode && !/^(?:C62|H87|EA|PCS?|pieces?|items?|units?)$/i.test(value.unitCode)) return undefined;
    raw = value.value;
  }
  if (typeof raw === 'string') {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw.trim())) return undefined;
    raw = Number(raw.replaceAll(',', '').trim());
  }
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
};

// Creation, update, review, order and unscoped sales fields are intentionally absent.
export function publicProductFields(product, prefix = 'Product JSON-LD') {
  const fields = {};
  for (const key of ['published_at', 'datePublished', 'releaseDate']) {
    const raw = product[key];
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw) || !Number.isFinite(Date.parse(raw))) continue;
    const day = raw.slice(0, 10);
    if (new Date(Date.parse(day + 'T00:00:00Z')).toISOString().slice(0, 10) !== day) continue;
    fields.publishedAt = raw;
    fields.publishedSourceField = product.publishedSourceField || prefix + '.' + key;
    break;
  }
  if (cumulative(product))
    for (const key of ['numberOfItemsSold', 'soldCount', 'sold_count']) {
      if (!cumulative(product[key])) continue;
      const value = units(product[key]);
      if (value === undefined) continue;
      fields.soldCount = value;
      fields.soldRaw = typeof product.soldRaw === 'string' ? product.soldRaw : typeof product[key] === 'string' ? product[key].trim() : String(value);
      fields.soldPrecision = 'exact';
      fields.soldSourceField = product.soldSourceField || prefix + '.' + key;
      break;
    }
  return fields;
}
