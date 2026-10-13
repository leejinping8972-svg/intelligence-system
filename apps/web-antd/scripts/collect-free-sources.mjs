import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(import.meta.dirname, '..');
const configPath = resolve(
  root,
  process.env.HCI_FREE_SOURCE_CONFIG || 'public/data/free-source-config.json',
);
const outputPath = resolve(
  root,
  process.env.HCI_FREE_SOURCE_OUTPUT ||
    'public/data/free-source-observations.json',
);
const previousUrl = process.env.HCI_FREE_SOURCES_PREVIOUS_URL || '';
const userAgent =
  'ZhihengPublicResearchBot/0.2 (+https://leejinping8972-svg.github.io/intelligence-system/)';
const now = new Date();
const collectedAt = now.toISOString();

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const hash = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);

function clean(value) {
  return String(value ?? '')
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return collectedAt.slice(0, 10);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const slash = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? collectedAt.slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

function makeSignal(input) {
  const stable = [input.source, input.sourceId, input.market, input.query].join(
    '|',
  );
  return {
    id: `${input.source.toLowerCase()}-${hash(stable)}`,
    collectedAt,
    ...input,
    observedAt: normalizeDate(input.observedAt),
    title: clean(input.title),
    summary: clean(input.summary),
  };
}

async function fetchJson(url, options = {}) {
  const retries = options.retries ?? 2;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeout || 20_000,
    );
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        signal: controller.signal,
      });
      if (response.status === 404 && options.emptyOn404) return null;
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(700 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function readPrevious() {
  if (!previousUrl) {
    try {
      return JSON.parse(await readFile(outputPath, 'utf8'));
    } catch {
      return null;
    }
  }
  try {
    return await fetchJson(previousUrl, { timeout: 12_000 });
  } catch {
    return null;
  }
}

function runResult(source, status, count, note, documentation) {
  return {
    source,
    status,
    count,
    note,
    documentation,
    finishedAt: new Date().toISOString(),
  };
}

function sourceFailure(source, error, documentation) {
  const status = error?.status === 429 ? 'rate_limited' : 'error';
  return runResult(
    source,
    status,
    0,
    clean(error?.message || error),
    documentation,
  );
}

async function collectDsld(config) {
  const source = 'NIH_DSLD';
  const documentation = 'https://dsld.od.nih.gov/api-guide';
  const signals = [];
  try {
    for (const term of config.terms) {
      const params = new URLSearchParams({
        q: term.scientific,
        sort_by: 'entryDate',
        sort_order: 'desc',
        status: '1',
        size: String(config.maxPerQuery),
        from: '0',
      });
      const data = await fetchJson(
        `https://api.ods.od.nih.gov/dsld/v9/search-filter?${params}`,
      );
      for (const hit of data?.hits || []) {
        const item = hit._source || {};
        const ingredients = (item.allIngredients || [])
          .slice(0, 16)
          .map((entry) => clean(entry.name || entry.ingredientGroup))
          .filter(Boolean);
        const claims = (item.claims || [])
          .map((entry) => clean(entry.langualCodeDescription))
          .filter(Boolean);
        signals.push(
          makeSignal({
            source,
            sourceId: String(hit._id),
            kind: 'product',
            market: 'US',
            query: term.label,
            category: term.category,
            title: item.fullName || `DSLD ${hit._id}`,
            summary: [
              item.brandName,
              item.productType?.langualCodeDescription,
              item.physicalState?.langualCodeDescription,
              claims.join(' / '),
            ]
              .filter(Boolean)
              .join(' · '),
            observedAt: item.entryDate,
            url: `https://dsld.od.nih.gov/label/${hit._id}`,
            brand: clean(item.brandName),
            ingredients,
            metrics: {
              ingredientCount: ingredients.length,
              onMarket: item.offMarket === 0,
            },
          }),
        );
      }
      await sleep(250);
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        '美国膳食补充剂标签公开数据；收录日期不等于首次上市日期',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectPubmed(config) {
  const source = 'PUBMED';
  const documentation = 'https://www.ncbi.nlm.nih.gov/home/develop/api/';
  const signals = [];
  const email = process.env.NCBI_EMAIL || 'research@example.com';
  const apiKey = process.env.NCBI_API_KEY || '';
  try {
    for (const term of config.terms) {
      const searchParams = new URLSearchParams({
        db: 'pubmed',
        term: `${term.scientific}[Title/Abstract]`,
        retmode: 'json',
        retmax: String(Math.min(3, config.maxPerQuery)),
        sort: 'date',
        datetype: 'pdat',
        reldate: '45',
        tool: 'zhiheng_intelligence',
        email,
      });
      if (apiKey) searchParams.set('api_key', apiKey);
      const search = await fetchJson(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`,
      );
      const ids = search?.esearchresult?.idlist || [];
      if (ids.length > 0) {
        const summaryParams = new URLSearchParams({
          db: 'pubmed',
          id: ids.join(','),
          retmode: 'json',
          tool: 'zhiheng_intelligence',
          email,
        });
        if (apiKey) summaryParams.set('api_key', apiKey);
        const summary = await fetchJson(
          `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`,
        );
        for (const id of ids) {
          const item = summary?.result?.[id];
          if (!item) continue;
          const doi = (item.articleids || []).find(
            (entry) => entry.idtype === 'doi',
          )?.value;
          signals.push(
            makeSignal({
              source,
              sourceId: id,
              kind: 'research',
              market: 'GLOBAL',
              query: term.label,
              category: term.category,
              title: item.title,
              summary: [
                item.fulljournalname,
                (item.authors || [])
                  .slice(0, 3)
                  .map((author) => author.name)
                  .join(', '),
                doi ? `DOI ${doi}` : '',
              ]
                .filter(Boolean)
                .join(' · '),
              observedAt: item.sortpubdate || item.pubdate,
              url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
              metrics: { publicationType: item.pubtype || [] },
            }),
          );
        }
      }
      await sleep(apiKey ? 120 : 420);
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        apiKey ? '已使用免费API Key加速' : '无Key低频模式（不超过3请求/秒）',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectClinicalTrials(config) {
  const source = 'CLINICAL_TRIALS';
  const documentation = 'https://clinicaltrials.gov/data-api/about-api';
  const signals = [];
  try {
    for (const term of config.terms) {
      const params = new URLSearchParams({
        'query.intr': term.scientific,
        pageSize: String(Math.min(12, config.maxPerQuery * 3)),
        format: 'json',
        sort: 'StudyFirstPostDate:desc',
      });
      const data = await fetchJson(
        `https://clinicaltrials.gov/api/v2/studies?${params}`,
      );
      const requiredTerms = (term.clinicalRequiredTerms || []).map((item) =>
        item.toLowerCase(),
      );
      const matchedStudies = (data?.studies || []).filter((study) => {
        const protocol = study.protocolSection || {};
        const interventions =
          protocol.armsInterventionsModule?.interventions || [];
        const searchable = [
          protocol.identificationModule?.briefTitle,
          ...interventions.flatMap((item) => [
            item.name,
            ...(item.otherNames || []),
          ]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return requiredTerms.every((item) => searchable.includes(item));
      });
      for (const study of matchedStudies.slice(0, config.maxPerQuery)) {
        const protocol = study.protocolSection || {};
        const identification = protocol.identificationModule || {};
        const status = protocol.statusModule || {};
        const conditions = protocol.conditionsModule?.conditions || [];
        const interventions =
          protocol.armsInterventionsModule?.interventions || [];
        const nctId = identification.nctId;
        if (!nctId) continue;
        signals.push(
          makeSignal({
            source,
            sourceId: nctId,
            kind: 'trial',
            market: 'GLOBAL',
            query: term.label,
            category: term.category,
            title: identification.briefTitle,
            summary: [
              status.overallStatus,
              conditions.slice(0, 3).join(' / '),
              interventions
                .slice(0, 2)
                .map((item) => item.name)
                .join(' / '),
            ]
              .filter(Boolean)
              .join(' · '),
            observedAt: status.studyFirstPostDateStruct?.date,
            url: `https://clinicaltrials.gov/study/${nctId}`,
            metrics: {
              enrollment: protocol.designModule?.enrollmentInfo?.count ?? null,
              phases: protocol.designModule?.phases || [],
              matchRule: 'title_or_intervention_names_v3',
            },
          }),
        );
      }
      await sleep(180);
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        '公开临床研究登记；登记不代表研究结论或功效确认',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectPubchem(config) {
  const source = 'PUBCHEM';
  const documentation = 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest';
  const signals = [];
  try {
    for (const term of config.terms) {
      if (!term.compound) continue;
      const encoded = encodeURIComponent(term.compound);
      const data = await fetchJson(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encoded}/property/Title,MolecularFormula,MolecularWeight,InChIKey/JSON`,
        { emptyOn404: true },
      );
      const property = data?.PropertyTable?.Properties?.[0];
      if (property) {
        signals.push(
          makeSignal({
            source,
            sourceId: String(property.CID),
            kind: 'ingredient_profile',
            market: 'GLOBAL',
            query: term.label,
            category: term.category,
            title: property.Title || term.label,
            summary: [
              property.MolecularFormula
                ? `分子式 ${property.MolecularFormula}`
                : '',
              property.MolecularWeight
                ? `分子量 ${property.MolecularWeight}`
                : '',
              property.InChIKey ? `InChIKey ${property.InChIKey}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            observedAt: collectedAt,
            url: `https://pubchem.ncbi.nlm.nih.gov/compound/${property.CID}`,
            metrics: { cid: property.CID },
          }),
        );
      }
      await sleep(220);
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        '成分标识与基础化学信息，不构成功效或安全结论',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectOpenFda(config) {
  const source = 'OPENFDA';
  const documentation = 'https://open.fda.gov/apis/food/';
  const signals = [];
  const apiKey = process.env.OPENFDA_API_KEY || '';
  try {
    for (const term of config.terms) {
      const keyword = term.scientific.replace(' supplement', '');
      const params = new URLSearchParams({
        search: `product_description:${keyword}`,
        sort: 'report_date:desc',
        limit: String(Math.min(2, config.maxPerQuery)),
      });
      if (apiKey) params.set('api_key', apiKey);
      const recalls = await fetchJson(
        `https://api.fda.gov/food/enforcement.json?${params}`,
        { emptyOn404: true },
      );
      for (const item of recalls?.results || []) {
        signals.push(
          makeSignal({
            source,
            sourceId: item.recall_number,
            kind: 'regulatory',
            market: 'US',
            query: term.label,
            category: term.category,
            title: `${item.recalling_firm || '企业'} · ${item.classification || '召回记录'}`,
            summary: [item.product_description, item.reason_for_recall]
              .filter(Boolean)
              .join('；'),
            observedAt: item.report_date || item.recall_initiation_date,
            url: `https://www.accessdata.fda.gov/scripts/ires/?Product=${encodeURIComponent(item.recall_number)}`,
            metrics: {
              recallNumber: item.recall_number,
              status: item.status,
              classification: item.classification,
            },
          }),
        );
      }

      const eventParams = new URLSearchParams({
        search: `products.name_brand:${keyword}`,
        limit: '1',
      });
      if (apiKey) eventParams.set('api_key', apiKey);
      const events = await fetchJson(
        `https://api.fda.gov/food/event.json?${eventParams}`,
        { emptyOn404: true },
      );
      const eventCount = events?.meta?.results?.total || 0;
      if (eventCount > 0) {
        signals.push(
          makeSignal({
            source,
            sourceId: `caers-${term.id}`,
            kind: 'safety_aggregate',
            market: 'US',
            query: term.label,
            category: term.category,
            title: `${term.label} · CAERS匹配记录`,
            summary:
              '仅表示公开报告中出现相关名称；报告未经因果验证，不能用于估计发生率或医疗决策。',
            observedAt: collectedAt,
            url: 'https://open.fda.gov/apis/food/event/',
            metrics: { matchedReports: eventCount },
          }),
        );
      }
      await sleep(270);
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        apiKey
          ? '已使用免费Key；召回与CAERS只作监管线索'
          : '无Key低配额模式；召回与CAERS只作监管线索',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectYoutube(config) {
  const source = 'YOUTUBE';
  const documentation = 'https://developers.google.com/youtube/v3';
  const apiKey = process.env.YOUTUBE_API_KEY || '';
  if (!apiKey) {
    return {
      signals: [],
      run: runResult(
        source,
        'needs_key',
        0,
        '等待Google Cloud免费API Key；密钥只放GitHub Secrets',
        documentation,
      ),
    };
  }
  const signals = [];
  const languages = { US: 'en', MX: 'es', VN: 'vi' };
  try {
    for (const term of config.terms.slice(0, 6)) {
      for (const market of ['US', 'MX', 'VN']) {
        const params = new URLSearchParams({
          key: apiKey,
          part: 'snippet',
          type: 'video',
          order: 'date',
          maxResults: String(Math.min(3, config.maxPerQuery)),
          q: term.queries[market],
          regionCode: market,
          relevanceLanguage: languages[market],
          publishedAfter: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        });
        const data = await fetchJson(
          `https://www.googleapis.com/youtube/v3/search?${params}`,
        );
        const items = data?.items || [];
        const ids = items.map((item) => item.id?.videoId).filter(Boolean);
        let statistics = {};
        if (ids.length > 0) {
          const detailParams = new URLSearchParams({
            key: apiKey,
            part: 'statistics',
            id: ids.join(','),
          });
          const detail = await fetchJson(
            `https://www.googleapis.com/youtube/v3/videos?${detailParams}`,
          );
          statistics = Object.fromEntries(
            (detail?.items || []).map((item) => [item.id, item.statistics]),
          );
        }
        for (const item of items) {
          const videoId = item.id?.videoId;
          if (!videoId) continue;
          signals.push(
            makeSignal({
              source,
              sourceId: videoId,
              kind: 'content',
              market,
              query: term.label,
              category: term.category,
              title: item.snippet?.title,
              summary: [item.snippet?.channelTitle, item.snippet?.description]
                .filter(Boolean)
                .join(' · '),
              observedAt: item.snippet?.publishedAt,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              metrics: statistics[videoId] || {},
            }),
          );
        }
        await sleep(160);
      }
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        '使用默认免费配额；视频热度只作内容传播信号',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

async function collectGdelt(config) {
  const source = 'GDELT';
  const documentation =
    'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/';
  const signals = [];
  try {
    const query = `(${config.terms
      .slice(0, 6)
      .map((term) => `\"${term.scientific.replace(' supplement', '')}\"`)
      .join(' OR ')})`;
    const params = new URLSearchParams({
      query,
      mode: 'artlist',
      maxrecords: '50',
      format: 'json',
      timespan: '1week',
      sort: 'datedesc',
    });
    const data = await fetchJson(
      `https://api.gdeltproject.org/api/v2/doc/doc?${params}`,
    );
    for (const article of data?.articles || []) {
      const matched = config.terms.find((term) =>
        clean(article.title)
          .toLowerCase()
          .includes(term.scientific.replace(' supplement', '').toLowerCase()),
      );
      signals.push(
        makeSignal({
          source,
          sourceId: article.url,
          kind: 'news',
          market: 'GLOBAL',
          query: matched?.label || '大健康新闻',
          category: matched?.category || '其他',
          title: article.title,
          summary: [article.domain, article.sourcecountry, article.language]
            .filter(Boolean)
            .join(' · '),
          observedAt: article.seendate,
          url: article.url,
          metrics: { tone: article.tone ?? null },
        }),
      );
    }
    return {
      signals,
      run: runResult(
        source,
        'success',
        signals.length,
        '全球新闻提及，仅作传播和议题信号',
        documentation,
      ),
    };
  } catch (error) {
    return { signals, run: sourceFailure(source, error, documentation) };
  }
}

function mergeSignals(current, previous, retentionDays, validCompoundQueries) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const map = new Map();
  for (const signal of [...(previous || []), ...current]) {
    if (signal.source === 'PUBCHEM' && !validCompoundQueries.has(signal.query))
      continue;
    if (
      signal.source === 'CLINICAL_TRIALS' &&
      signal.metrics?.matchRule !== 'title_or_intervention_names_v3'
    )
      continue;
    const date = new Date(`${normalizeDate(signal.observedAt)}T00:00:00Z`);
    if (
      date.getTime() >= cutoff ||
      signal.kind === 'ingredient_profile' ||
      signal.kind === 'product'
    ) {
      map.set(signal.id, signal);
    }
  }
  return [...map.values()].sort((a, b) =>
    String(b.observedAt).localeCompare(String(a.observedAt)),
  );
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const previous = await readPrevious();
const collectors = [
  collectDsld,
  collectPubmed,
  collectClinicalTrials,
  collectPubchem,
  collectOpenFda,
  collectYoutube,
  collectGdelt,
];
const results = [];
for (const collector of collectors) results.push(await collector(config));
const currentSignals = results.flatMap((result) => result.signals);
const signals = mergeSignals(
  currentSignals,
  previous?.signals,
  config.retentionDays || 365,
  new Set(
    config.terms.filter((term) => term.compound).map((term) => term.label),
  ),
);
const output = {
  version: 1,
  generatedAt: collectedAt,
  retentionDays: config.retentionDays || 365,
  sourceRuns: results.map((result) => result.run),
  signals,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.warn(
  `Free sources finished: ${results.filter((item) => item.run.status === 'success').length}/${results.length} sources, ${signals.length} retained signals.`,
);
