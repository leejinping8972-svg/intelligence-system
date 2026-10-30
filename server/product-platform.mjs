export function resolvedProductPlatform(product, site) {
  if (typeof product.sourcePlatform === 'string' && product.sourcePlatform.trim()) return product.sourcePlatform.trim();
  if (!product.siteId || !site?.domain) return '未记录';
  try {
    const url = new URL(product.sourceUrl || product.evidenceUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const domain = site.domain.toLowerCase().replace(/^www\./, '');
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      (host === domain || host.endsWith(`.${domain}`))) return '独立站';
  } catch {}
  return '未记录';
}

// Legacy records predate sourcePlatform; use the recorded source URL and site,
// so an unrelated brand-site association cannot relabel a marketplace product.
export function productPlatformSql(sql, alias = 'r') {
  const field = (payload, key) => `NULLIF(${sql(`${payload}->>'${key}'`, `JSON_UNQUOTE(JSON_EXTRACT(${payload},'$.${key}'))`)},'null')`;
  const platform = `NULLIF(TRIM(${field(`${alias}.payload`, 'sourcePlatform')}),'')`;
  const url = `COALESCE(NULLIF(${field(`${alias}.payload`, 'sourceUrl')},''),${field(`${alias}.payload`, 'evidenceUrl')})`;
  const authority = sql(`substring(${url} from '^https?://([^/?#]+)')`, `SUBSTRING_INDEX(REGEXP_SUBSTR(${url},'^https?://[^/?#]+'),'://',-1)`);
  const valid = sql(`${authority} ~ '^[A-Za-z0-9.-]+(:[0-9]+)?$'`, `REGEXP_LIKE(${authority},'^[A-Za-z0-9.-]+(:[0-9]+)?$')`);
  const host = `REGEXP_REPLACE(LOWER(${sql(`split_part(${authority},':',1)`, `SUBSTRING_INDEX(${authority},':',1)`)}),'^www[.]','')`;
  const domain = `REGEXP_REPLACE(LOWER(${field('source_site.value', 'domain')}),'^www[.]','')`;
  return `COALESCE(${platform},CASE WHEN EXISTS(SELECT 1 FROM workspace_documents source_site WHERE source_site.name=CONCAT('business:sites:',${alias}.site_id) AND ${domain}<>'' AND ${valid} AND (${host}=${domain} OR RIGHT(${host},LENGTH(${domain})+1)=CONCAT('.',${domain}))) THEN '独立站' ELSE '未记录' END)`;
}
