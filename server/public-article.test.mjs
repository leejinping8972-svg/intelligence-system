import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend uses node --test. */
import test from 'node:test';

import {
  articleAction,
  articlePmcId,
  collectArticleStep,
  fetchArticleDetails,
} from './public-article-details.mjs';
import {
  articleDns,
  ArticleError,
  articleHttpsUrl,
  fetchPublicArticle,
  publicArticleAddress,
} from './public-article-http.mjs';
import { parseArticleDocument } from './public-article-parser.mjs';
import { executeContentJob, newContentJob } from './public-content-engine.mjs';

const paragraph =
  'Public nutrition research describes methods, observations, study limitations and uncertainty. '.repeat(
    5,
  );
const xml = (extra = '') =>
  `<article><front><article-meta><article-id pub-id-type="pmc">123</article-id><title-group><article-title>Public nutrition study</article-title></title-group><permissions><license>CC BY 4.0 fixture</license></permissions></article-meta></front><body><sec id="intro"><label>1.</label><title>Introduction</title><p>${paragraph} A comparison: p &lt; 0.05 and x &gt; 0.01.</p><sec><title>Methods</title><p>${paragraph}</p></sec><table-wrap><label>Table 1</label><caption>Observed measurements</caption><table><thead><tr><th>Measure</th><th>Value</th></tr></thead><tbody><tr><td>Difference</td><td>−0.09 (−0.51, 0.37)</td></tr></tbody></table><table-wrap-foot>Observed values, not causal proof.</table-wrap-foot></table-wrap><fig id="f1"><label>Figure 1</label><caption><p>Public figure caption.</p></caption><alternatives><graphic content-type="image"><?cloudpmc-path blobs/abcd/123/abcdef/figure.webp?></graphic></alternatives></fig>${extra}</sec></body><back><ref-list><ref>Fixture reference.</ref></ref-list></back></article>`;
const item = {
  id: 'pc-111111111111111111111111',
  source: 'europepmc',
  sourceId: 'PMC:PMC123',
  type: 'paper',
  title: 'Public nutrition study',
  url: 'https://europepmc.org/article/PMC/PMC123',
  favorite: true,
  productIds: ['qa-product'],
  keywordIds: [],
  matchedQueries: ['nutrition'],
};
const document = () =>
  parseArticleDocument(xml(), { xml: true, pmcid: 'PMC123', url: item.url });
function memory(job) {
  let savedJob = structuredClone(job);
  let savedItem = structuredClone(item);
  let article;
  return {
    getJob: async () => savedJob,
    getItem: async () => savedItem,
    getArticle: async () => article,
    writeArticle: async (_id, value) => {
      article = value;
    },
    saveJob: async (value) => {
      savedJob = {
        ...value,
        ...(savedJob.status === 'cancelled' ? { status: 'cancelled' } : {}),
      };
    },
    updateItem: async (_id, change) => {
      savedItem = change(savedItem);
      return savedItem;
    },
    articleFetch: async () => ({ text: xml(), url: item.url, status: 200 }),
    listJobs: async () => [savedJob],
    submitLease: async (callback) => callback(),
    cancel() {
      savedJob.status = 'cancelled';
    },
  };
}
const search = () =>
  newContentJob(
    {
      query: 'nutrition',
      market: 'US',
      language: 'en',
      sources: ['europepmc'],
      includeRelated: false,
    },
    randomUUID(),
    'qa',
  );

test('official full text may exist without abstract; extracts nested sections, numeric tables and known CDN figures', () => {
  const value = document();
  assert.equal(value.abstract, '');
  assert.equal(value.coverage, 'fulltext');
  assert.equal(value.tables.length, 1);
  assert.equal(value.figures.length, 1);
  assert.ok(value.sections.some((section) => section.heading === 'Methods'));
  assert.ok(
    value.sections.some((section) =>
      section.blocks.some((block) =>
        block.text?.includes('p < 0.05 and x > 0.01'),
      ),
    ),
  );
  assert.equal(value.tables[0].rows[1][1].text, '−0.09 (−0.51, 0.37)');
  assert.equal(
    value.figures[0].imageUrl,
    'https://cdn.ncbi.nlm.nih.gov/pmc/blobs/abcd/123/abcdef/figure.webp',
  );
  assert.match(value.license, /CC BY/);
});
test('rejects XML entity declarations, identifier mismatches and fake article shells', () => {
  assert.throws(
    () =>
      parseArticleDocument(
        `<!ENTITY bad SYSTEM "file:///etc/passwd">${xml()}`,
        { xml: true },
      ),
    /声明/,
  );
  assert.throws(
    () => parseArticleDocument(xml(), { xml: true, pmcid: 'PMC124' }),
    /编号/,
  );
  assert.throws(
    () => parseArticleDocument('<html>blocked</html>', { xml: true }),
    /XML/,
  );
  assert.throws(() => parseArticleDocument('x'.repeat(5_000_001)), /大小/);
});
test('references in API body containers are captured once like traditional back matter', () => {
  const sample = xml()
    .replace(
      '</body><back><ref-list>',
      '<sec><title>References</title><ref-list>',
    )
    .replace('</ref-list></back>', '</ref-list></sec></body>');
  const parsed = parseArticleDocument(sample, {
    xml: true,
    pmcid: 'PMC123',
    url: item.url,
  });
  assert.equal(
    parsed.sections.filter((section) => section.heading === '参考文献').length,
    1,
  );
  assert.ok(
    parsed.sections.some((section) =>
      section.blocks.some((block) =>
        block.text?.includes('Fixture reference.'),
      ),
    ),
  );
});
test('nested paragraph table containers do not duplicate the same table', () => {
  const value = parseArticleDocument(
    xml(
      '<p>Measurements<table-wrap><table><tr><td>Measured data</td></tr></table></table-wrap></p>',
    ),
    { xml: true, pmcid: 'PMC123', url: item.url },
  );
  assert.equal(value.tables.length, 2);
  assert.equal(value.tables[1].rows[0][0].text, 'Measured data');
});
test('caps table dimensions and reports truncation rather than pretending the whole document was retained', () => {
  const extra = `<table-wrap><table>${'<tr><td colspan="100">data</td></tr>'.repeat(160)}</table></table-wrap>`;
  const value = parseArticleDocument(xml(extra), {
    xml: true,
    pmcid: 'PMC123',
    url: item.url,
  });
  assert.equal(value.tables[1].rows.length, 150);
  assert.equal(value.tables[1].rows[0][0].colspan, 20);
  assert.equal(value.coverage, 'partial');
  assert.equal(value.truncated, true);
});
test('HTML extracts already present folded content, avoids scripts and refuses declared paywalls or challenge pages', () => {
  const value = parseArticleDocument(
    `<html><title>Article</title><body><nav>navigation</nav><article><h1>Nutrition</h1><details><summary>Read more</summary><p>${paragraph}</p></details><script>INJECTED CODE</script></article></body></html>`,
    { url: 'https://www.nhs.uk/public-article' },
  );
  assert.equal(value.coverage, 'public_text');
  assert.match(JSON.stringify(value.sections), /observations/);
  assert.ok(!JSON.stringify(value).includes('INJECTED CODE'));
  assert.ok(!JSON.stringify(value.sections).includes('navigation'));
  assert.throws(
    () =>
      parseArticleDocument(
        `<script type="application/ld+json">[null,{"isAccessibleForFree":false}]</script><article><p>${paragraph}</p></article>`,
        { url: 'https://example.org/a' },
      ),
    /订阅/,
  );
  assert.throws(
    () =>
      parseArticleDocument(
        '<title>Just a moment</title><p>Verify you are human</p>',
      ),
    /验证/,
  );
  assert.throws(
    () =>
      parseArticleDocument('<html><div id="app"></div></html>', {
        url: 'https://example.org/a',
      }),
    /动态加载/,
  );
});
test('public HTTPS URL and DNS policy blocks private, reserved, mapped and rebinding addresses before connecting', async () => {
  for (const value of [
    'http://example.org/a',
    'https://user:pass@example.org/a',
    'https://localhost/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://example.local/a',
    'https://example.org:444/a',
  ])
    assert.throws(() => articleHttpsUrl(value));
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(publicArticleAddress(address), false, address);
  assert.equal(publicArticleAddress('8.8.8.8'), true);
  assert.equal(publicArticleAddress('2606:4700:4700::1111'), true);
  let reads = 0;
  await assert.rejects(
    fetchPublicArticle('https://example.org/a', {
      resolve: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      read: async () => {
        reads++;
      },
    }),
    /非公网/,
  );
  assert.equal(reads, 0);
  await assert.rejects(
    articleDns('example.org', async () => []),
    /非公网/,
  );
});
test('redirects are separately resolved and pinned; cannot redirect to private hosts or change HTTPS protection', async () => {
  const resolved = [];
  const read = [];
  const result = await fetchPublicArticle('https://example.org/a', {
    resolve: async (host) => {
      resolved.push(host);
      return [{ address: '8.8.8.8', family: 4 }];
    },
    read: async (url, addresses) => {
      read.push(addresses[0].address);
      return url.hostname === 'example.org'
        ? { status: 302, location: 'https://example.com/article' }
        : { status: 200, text: 'public', url: url.href };
    },
  });
  assert.equal(result.text, 'public');
  assert.deepEqual(resolved, ['example.org', 'example.com']);
  assert.deepEqual(read, ['8.8.8.8', '8.8.8.8']);
  await assert.rejects(
    fetchPublicArticle('https://example.org/a', {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      read: async () => ({ status: 302, location: 'http://127.0.0.1/a' }),
    }),
    /HTTPS/,
  );
  let count = 0;
  await assert.rejects(
    fetchPublicArticle('https://example.org/a', {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      read: async () => {
        count++;
        return { status: 302, location: '/again' };
      },
    }),
    /重定向/,
  );
  assert.equal(count, 3);
});
test('stored Europe PMC URL resolves to fixed official XML endpoint; never fetches a user supplied arbitrary URL', async () => {
  const urls = [];
  const result = await fetchArticleDetails(
    { ...item, sourceId: 'old-record' },
    {
      articleFetch: async (url) => {
        urls.push(url);
        return { text: xml(), url };
      },
    },
  );
  assert.deepEqual(urls, [
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC123/fullTextXML',
  ]);
  assert.equal(result.requests, 1);
  assert.equal(result.document.pmcid, 'PMC123');
  assert.equal(articlePmcId({ url: 'https://evil.example/PMC123' }), '');
  assert.equal(
    articlePmcId({ url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/' }),
    'PMC123',
  );
  await assert.rejects(
    fetchArticleDetails(
      { ...item, source: 'youtube', type: 'video' },
      { articleFetch: async () => assert.fail('must not fetch') },
    ),
    /不.*支持/,
  );
});
test('legacy PMID records resolve only an exact metadata match before following a PMC identifier', async () => {
  const urls = [];
  const result = await fetchArticleDetails(
    { ...item, url: 'https://pubmed.ncbi.nlm.nih.gov/42/', sourceId: 'MED:42' },
    {
      articleFetch: async (url) => {
        urls.push(url);
        return {
          text: url.includes('/search?')
            ? '<resultList><result><id>42</id><source>MED</source><pmcid>PMC123</pmcid></result></resultList>'
            : xml(),
        };
      },
    },
  );
  assert.equal(result.requests, 2);
  assert.equal(urls.length, 2);
  await assert.rejects(
    fetchArticleDetails(
      {
        ...item,
        url: 'https://pubmed.ncbi.nlm.nih.gov/42/',
        sourceId: 'MED:42',
      },
      {
        articleFetch: async () => ({
          text: '<result><id>99</id><source>MED</source><pmcid>PMC123</pmcid></result>',
        }),
      },
    ),
    /未提供/,
  );
});
test('new searches append free detail steps after discovery and preserve favorite/product associations', async () => {
  const job = search();
  const io = memory(job);
  const events = [];
  io.search = async () => {
    events.push('search');
    return { items: [item], rawCount: 1, creditsCharged: null };
  };
  io.articleFetch = async () => {
    events.push('article');
    return { text: xml() };
  };
  await executeContentJob(job, io);
  assert.deepEqual(events, ['search', 'article']);
  assert.equal(job.steps.length, 2);
  assert.equal(job.steps[1].kind, 'article_detail');
  const savedArticle = await io.getArticle();
  assert.equal(savedArticle.status, 'ready');
  const savedItem = await io.getItem();
  assert.equal(savedItem.favorite, true);
  assert.deepEqual(savedItem.productIds, ['qa-product']);
  assert.equal(job.status, 'completed');
  assert.equal(job.creditsCharged, 0);
});
test('old queued inputs do not gain unexpected detail requests; explicit opt-out is respected', async () => {
  for (const old of [true, false]) {
    const job = search();
    if (old) delete job.input.fetchDetails;
    else job.input.fetchDetails = false;
    const io = memory(job);
    io.search = async () => ({ items: [item], rawCount: 1 });
    io.articleFetch = async () => assert.fail('must not fetch');
    await executeContentJob(job, io);
    assert.equal(job.steps.length, 1);
  }
});
test('unavailable full text retains search results, caches the reason and does not invent a document', async () => {
  const job = search();
  const io = memory(job);
  const step = { kind: 'article_detail', itemId: item.id, status: 'running' };
  io.articleFetch = async () => {
    throw new ArticleError('No public full text', 'unavailable');
  };
  await collectArticleStep(job, step, io);
  assert.equal(step.status, 'skipped');
  const savedArticle = await io.getArticle();
  assert.equal(savedArticle.status, 'unavailable');
  assert.equal(savedArticle.document, undefined);
  io.articleFetch = async () =>
    assert.fail('cached unavailable must not repeat');
  await collectArticleStep(job, { ...step, status: 'running' }, io);
});
test('committed document survives metadata save failure and cannot double-count a confirmed response', async () => {
  const job = search();
  const io = memory(job);
  let updates = 0;
  const update = io.updateItem;
  io.updateItem = async (...args) => {
    updates++;
    if (updates === 2) throw new Error('metadata unavailable');
    return update(...args);
  };
  await collectArticleStep(
    job,
    { kind: 'article_detail', itemId: item.id },
    io,
  );
  const savedArticle = await io.getArticle();
  assert.equal(savedArticle.status, 'ready');
  assert.ok(savedArticle.document.sections.length);
  assert.equal(job.requests, 1);
});
test('cancel during detail request preserves the returned document and prevents further stages', async () => {
  const job = search();
  const io = memory(job);
  io.search = async () => ({ items: [item], rawCount: 1 });
  io.articleFetch = async () => {
    io.cancel();
    return { text: xml() };
  };
  await executeContentJob(job, io);
  const savedJob = await io.getJob();
  const savedArticle = await io.getArticle();
  assert.equal(savedJob.status, 'cancelled');
  assert.ok(savedArticle.document);
});
test('manual old-record body jobs are idempotent, reuse saved documents and never request unsupported source types', async () => {
  let jobs = [];
  const articles = new Map();
  const io = {
    getItem: async () => item,
    getJob: async (id) => jobs.find((job) => job.id === id),
    listJobs: async () => jobs,
    getArticle: async (id) => articles.get(id),
    saveJob: async (job) => {
      jobs = [job];
    },
    submitLease: async (fn) => fn(),
  };
  const id = randomUUID();
  const request = {
    action: 'server_content_article_submit',
    requestId: id,
    itemId: item.id,
  };
  const a = await articleAction(request, { id: 'qa' }, io);
  const b = await articleAction(request, { id: 'qa' }, io);
  assert.equal(a.job.id, b.job.id);
  const c = await articleAction(
    { ...request, requestId: randomUUID() },
    { id: 'qa' },
    io,
  );
  assert.equal(c.job.id, a.job.id);
  jobs = [];
  articles.set(item.id, { status: 'ready', document: document() });
  const saved = await articleAction(
    { ...request, requestId: randomUUID() },
    { id: 'qa' },
    io,
  );
  assert.ok(saved.article);
  const snapshot = await articleAction(
    { action: 'server_content_article_get', itemId: item.id },
    { id: 'qa' },
    io,
  );
  assert.equal(snapshot.state, 'ready');
});
