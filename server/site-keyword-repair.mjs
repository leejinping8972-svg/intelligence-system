import { siteKeywordProvenance } from './site-keyword-provenance.mjs';

const normalized = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Remove only historical auto-created associations that saved provenance proves
// are source notes. Keep keyword records, manual/direct links and all evidence.
export async function repairSiteKeywordAssociations({
  connection,
  putDocument,
}) {
  const keywordResult = await connection.query(
    'SELECT natural_key,data FROM research_keywords',
  );
  const keywords = keywordResult.rows;
  const byId = new Map(keywords.map((row) => [row.data.id, row]));
  const siteResult = await connection.query(
    "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:sites:%'",
  );
  const sites = siteResult.rows;
  let removed = 0,
    updatedSites = 0,
    updatedKeywords = 0;
  const changed = new Map();
  for (const { name, value: site } of sites) {
    const bad = new Set(
      siteKeywordProvenance(site).nonSearchTerms.map(normalized),
    );
    const rejected = new Set(
      keywords
        .filter(
          ({ data }) =>
            data.market === site.market &&
            data.source === '历史业务关联补齐' &&
            bad.has(normalized(data.term)),
        )
        .map(({ data }) => data.id),
    );
    if (rejected.size === 0) continue;
    const ids = (site.keywordIds || []).filter((id) => !rejected.has(id));
    if (ids.length !== (site.keywordIds || []).length) {
      removed += site.keywordIds.length - ids.length;
      await putDocument(
        'workspace_documents',
        name,
        { ...site, keywordIds: ids },
        false,
        connection,
      );
      updatedSites++;
    }
    for (const id of rejected) {
      const row = byId.get(id);
      const data = changed.get(row.natural_key) || row.data;
      if (!(data.siteIds || []).includes(site.id)) continue;
      changed.set(row.natural_key, {
        ...data,
        siteIds: data.siteIds.filter((siteId) => siteId !== site.id),
      });
    }
  }
  for (const [naturalKey, data] of changed) {
    await connection.query(
      'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
      [naturalKey, data],
    );
    updatedKeywords++;
  }
  return { removed, updatedSites, updatedKeywords };
}
