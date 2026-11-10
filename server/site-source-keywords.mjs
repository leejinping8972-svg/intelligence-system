import {
  siteKeywordProvenance,
  sourceSiteDomain,
} from './site-keyword-provenance.mjs';
import { isDeepStrictEqual } from 'node:util';

// Resolve one hop from saved, same-market source records. Inherited links never
// become proof of a shared advertising query, and cannot propagate in a cycle.
export function sourceKeywordLinks(site, sites, keywords) {
  if (siteKeywordProvenance(site).queryTerms.length > 0) return [];
  const domains = [
    ...new Set(
      siteKeywordProvenance(site)
        .discoveries.map((item) => item.domain)
        .filter(Boolean),
    ),
  ];
  return domains.map((domain) => {
    const sources = sites.filter(
      (item) =>
        item.id !== site.id &&
        item.market === site.market &&
        sourceSiteDomain(item.domain) === domain,
    );
    const matches = new Map();
    for (const source of sources) {
      const inherited = new Set(
        (source.sourceKeywordLinks || []).flatMap(
          (item) => item.keywordIds || [],
        ),
      );
      const terms = new Set(
        siteKeywordProvenance(source).queryTerms.map((term) =>
          term.toLowerCase(),
        ),
      );
      for (const keyword of keywords) {
        if (keyword.market !== site.market || !keyword.id || !keyword.term)
          continue;
        if (
          terms.has(keyword.term.toLowerCase()) ||
          (!inherited.has(keyword.id) &&
            (source.keywordIds?.includes(keyword.id) ||
              keyword.siteIds?.includes(source.id)))
        )
          matches.set(keyword.id, keyword);
      }
    }
    return {
      domain,
      siteId: sources[0]?.id || '',
      keywordIds: [...matches.keys()],
      terms: [...matches.values()].map((item) => item.term),
    };
  });
}

export async function loadSourceKeywordContext(connection) {
  const siteResult = await connection.query(
    "SELECT value FROM workspace_documents WHERE name LIKE 'business:sites:%'",
  );
  const keywordResult = await connection.query(
    'SELECT natural_key,data FROM research_keywords',
  );
  return {
    sites: siteResult.rows.map((row) => row.value),
    keywords: keywordResult.rows,
  };
}

export async function attachSourceKeywords({ connection, site, context }) {
  if (
    !siteKeywordProvenance(site).discoveries.some((item) => item.domain) ||
    siteKeywordProvenance(site).queryTerms.length > 0
  )
    return site;
  context ||= await loadSourceKeywordContext(connection);
  const links = sourceKeywordLinks(
    site,
    context.sites,
    context.keywords.map((row) => row.data),
  );
  const ids = [...new Set(links.flatMap((item) => item.keywordIds))];
  // Lock/re-read before merging the reverse links, preserving concurrent edits.
  for (const id of ids.toSorted()) {
    const entry = context.keywords.find((row) => row.data.id === id);
    if (!entry) continue;
    const result = await connection.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
      [entry.natural_key],
    );
    const row = result.rows[0];
    if (
      !row ||
      row.data.market !== site.market ||
      row.data.siteIds?.includes(site.id)
    )
      continue;
    await connection.query(
      'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
      [
        entry.natural_key,
        {
          ...row.data,
          siteIds: [...new Set([...(row.data.siteIds || []), site.id])],
        },
      ],
    );
  }
  return {
    ...site,
    keywordIds: [...new Set([...(site.keywordIds || []), ...ids])],
    sourceKeywordLinks: links,
  };
}

export async function reconcileSourceKeywords({ connection, putDocument }) {
  const context = await loadSourceKeywordContext(connection);
  let updated = 0;
  for (const site of context.sites) {
    const next = await attachSourceKeywords({ connection, site, context });
    if (isDeepStrictEqual(next, site)) continue;
    await putDocument(
      'workspace_documents',
      `business:sites:${site.id}`,
      next,
      false,
      connection,
    );
    updated++;
  }
  return { updated };
}
