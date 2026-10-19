import { readFile } from 'node:fs/promises';
// Local UI verification only. Uses isolated in-memory PostgreSQL and synthetic
// provider responses. It cannot connect to any production database/provider.
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
if (!process.env.HCI_TEST_PGLITE_MODULE)
  throw new Error('Set HCI_TEST_PGLITE_MODULE to the test-only PGlite module');
const { PGlite } = await import(
  pathToFileURL(process.env.HCI_TEST_PGLITE_MODULE).href
);
const db = new PGlite();
await db.exec(
  'CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer NOT NULL DEFAULT 1);CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb NOT NULL);',
);
for (const name of ['youtube', 'scrapecreators', 'analysis'])
  await db.query('INSERT INTO provider_configs(name,value) VALUES($1,$2)', [
    `provider:${name}:v1`,
    { qa: true },
  ]);
globalThis.__publicContentUiDb = db;
const moduleUrl = (s) => `data:text/javascript,${encodeURIComponent(s)}`;
registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/public-article-http.mjs')) {
      return {
        ...result,
        source: `${String(result.source).replace(
          'export async function fetchPublicArticle(',
          'async function readRealPublicArticle(',
        )}\nexport const fetchPublicArticle = (url) => globalThis.__publicArticleUiRead(url);`,
      };
    }
    return result;
  },
  resolve(s, c, next) {
    if (c.parentURL?.endsWith('/public-content-store.mjs')) {
      if (s === './database.mjs')
        return {
          url: moduleUrl(
            `const db=globalThis.__publicContentUiDb;const c={query:(q,p)=>db.query(q,p),release(){}};export const pool={query:(q,p)=>db.query(q,p),connect:async()=>c};export const sql=p=>p;export const putDocument=async(t,n,v,_i=false,c=pool)=>c.query('INSERT INTO '+t+'(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,revision='+t+'.revision+1',[n,v]);`,
          ),
          shortCircuit: true,
        };
      if (s === './ads-provider.mjs')
        return {
          url: moduleUrl(
            'export const openAdsKey=()=>JSON.stringify({model:"QA-model",maxTokens:4000});',
          ),
          shortCircuit: true,
        };
      if (s === './youtube-config.mjs')
        return {
          url: moduleUrl('export const readYoutubeKey=async()=>"QA-only-key";'),
          shortCircuit: true,
        };
      if (s === './model-provider.mjs')
        return {
          url: moduleUrl(
            `export const postModel=async(_c,m)=>({choices:[{message:{content:JSON.stringify({items:JSON.parse(m[1].content).items.map(i=>({id:i.id,titleZh:'肌酸公共内容（隔离样本）',summaryZh:'来源介绍肌酸的使用场景与相关研究，保留原文供研究参考。',reason:'与肌酸相关',quote:i.title,duplicateOf:''}))})}}],usage:{total_tokens:100}});export const modelReportText=r=>r.choices[0].message.content;`,
          ),
          shortCircuit: true,
        };
    }
    return next(s, c);
  },
});
const json = (value) => Response.json(value);
let calls = 0;
let articleCalls = 0;
const articleFixture = process.env.HCI_TEST_ARTICLE_XML
  ? await readFile(process.env.HCI_TEST_ARTICLE_XML, 'utf8')
  : `<article><front><article-meta><article-id pub-id-type="pmc">13666917</article-id><article-title>Omega-3 public article fixture</article-title></article-meta></front><body><sec><title>Methods</title><p>${'Public article fixture describing observations, nutrition methods and limitations. '.repeat(10)}</p></sec></body></article>`;
globalThis.__publicArticleUiRead = async (value) => {
  const url = new URL(value);
  articleCalls++;
  if (
    url.href ===
    'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC13666917/fullTextXML'
  )
    return { text: articleFixture, url: url.href, status: 200 };
  if (url.hostname === 'medlineplus.gov')
    return {
      text: `<article><h1>Creatine public article fixture</h1><details><summary>Body</summary><p>${'Creatine public nutrition article, with methods and study limitations. '.repeat(8)}</p></details></article>`,
      url: url.href,
      status: 200,
    };
  throw new Error('External article network disabled in UI test');
};
globalThis.fetch = async (value) => {
  calls++;
  const u = new URL(value);
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname === '/v1/google/search'
  ) {
    const query = u.searchParams.get('query') || '';
    let host = 'www.vinmec.com';
    if (query.includes('site:facebook.com')) host = 'www.facebook.com';
    if (query.includes('site:ods.od.nih.gov')) host = 'ods.od.nih.gov';
    return json({
      credits_charged: 1,
      results: Array.from({ length: 6 }, (_, i) => ({
        title: `Creatine thông tin sức khỏe ${i} (local QA)`,
        description:
          'Creatine thông tin và trải nghiệm. Synthetic index snippet.',
        url: `https://${host}/${host.includes('facebook') ? 'sample/posts' : 'vie/creatine'}/${i}`,
      })),
    });
  }
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname === '/v1/facebook/search/videos'
  )
    return json({
      credits_charged: 1,
      videos: [
        {
          id: 'qa-fb',
          title: 'Creatine Facebook video (local QA)',
          description: 'creatine routine',
          url: 'https://www.facebook.com/reel/12345/',
        },
      ],
    });
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname === '/v2/instagram/reels/search'
  )
    return json({
      credits_charged: 1,
      reels: [
        {
          id: 'qa-ig',
          caption: 'Creatine Instagram video (local QA)',
          url: 'https://www.instagram.com/reel/qa-abc/',
        },
      ],
    });
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname === '/v1/reddit/post/comments'
  )
    return json({
      credits_charged: 1,
      comments: [
        {
          id: 'qa-comment',
          body: 'Creatine gummies taste and daily routine (local QA)',
          author: 'QA-user',
          url: 'https://www.reddit.com/r/Fitness/comments/qa0/creatine/comment/',
        },
      ],
    });
  if (u.hostname === 'www.googleapis.com')
    return json({
      items: Array.from({ length: 8 }, (_, i) => ({
        id: { videoId: `qaVideo${String(i).padStart(4, '0')}` },
        snippet: {
          title: `Creatine gummies video ${i} (local QA)`,
          description:
            'Creatine gummies: routine and consumer questions. Local synthetic fixture.',
          channelTitle: 'QA Channel',
          publishedAt: new Date().toISOString(),
        },
      })),
    });
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname.includes('transcript')
  )
    return json({
      success: true,
      credits_charged: 1,
      language: 'English',
      transcript: [
        { text: 'Creatine gummies daily routine (local QA).', startMs: '0' },
      ],
    });
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname.includes('/reddit/')
  )
    return json({
      success: true,
      credits_charged: 1,
      posts: Array.from({ length: 6 }, (_, i) => ({
        id: `qa${i}`,
        title: `Creatine gummies discussion ${i} (local QA)`,
        selftext:
          'Questions about creatine gummies taste and convenient routines. Local synthetic fixture.',
        permalink: `/r/Fitness/comments/qa${i}/creatine/`,
        author: 'QA-user',
        created_utc: Date.now() / 1000,
      })),
    });
  if (
    u.hostname === 'api.scrapecreators.com' &&
    u.pathname.includes('/tiktok/')
  )
    return new Response('{}', { status: 429 });
  if (u.hostname === 'wsearch.nlm.nih.gov')
    return new Response(
      `<nlmSearchResult><list>${Array.from(
        { length: 5 },
        (_, i) =>
          `<document url="https://medlineplus.gov/qa-creatine-${i}.html"><content name="title">Creatine health topic ${i} (local QA)</content><content name="FullSummary">Creatine public health information. Local synthetic fixture.</content><content name="organizationName">QA institution</content></document>`,
      ).join('')}</list></nlmSearchResult>`,
    );
  if (u.hostname === 'www.ebi.ac.uk')
    return json({
      resultList: {
        result: [
          {
            source: 'PMC',
            id: 'PMC13666917',
            pmcid: 'PMC13666917',
            title:
              'Dietary Omega-3 Intake, Supplement Use and Omega-3 Status in Elite (Tier 3) Male Gaelic Football Players: A Cross-Sectional Study',
            authorString: 'Flanagan M, Ryan L.',
            language: 'eng',
            firstPublicationDate: '2026-10-01',
          },
          ...Array.from({ length: 6 }, (_, i) => ({
            source: 'MED',
            id: `99000${i}`,
            pmid: `99000${i}`,
            title: `Creatine study ${i} (local QA)`,
            abstractText:
              'Creatine research abstract, limitations and outcomes. Local synthetic fixture.',
            authorString: 'QA researchers',
            language: 'eng',
            firstPublicationDate: '2026-10-01',
          })),
        ],
      },
    });
  throw new Error('External network disabled in UI test');
};
const { publicContentAction, runContentQueue } =
  await import('../server/public-content-store.mjs');
const controller = new AbortController();
void runContentQueue(controller.signal);
const base = resolve('apps/web-antd/dist');
const keyword = {
  id: 'qa-word',
  term: 'creatine gummies',
  market: 'US',
  category: '运动营养',
  source: '本地隔离样本',
  favorite: false,
  series: [],
  growth: null,
  siteIds: [],
  productIds: [],
  dataNature: 'collected',
};
const product = {
  id: 'qa-product',
  title: 'Creatine Gummies',
  brand: 'QA Brand',
  market: 'US',
  category: '运动营养',
  form: '软糖',
  size: '60粒',
  price: 20,
  currency: 'USD',
  ingredient: 'creatine',
  dose: '3g',
  claim: 'QA only',
  benefits: [],
  benefitEvidence: '',
  ingredientInsights: [],
  siteId: 'qa-site',
  color: 'green',
  reviewed: false,
  favorite: false,
  dataNature: 'collected',
};
createServer(async (req, res) => {
  if (req.url === '/api') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const input = JSON.parse(body);
      let value = {};
      if (input.action.startsWith('server_content_'))
        value = await publicContentAction(input, { id: 'qa', role: 'admin' });
      if (input.action === 'public_branding')
        value = { appName: '公共内容 · 隔离验收', logo: '/admin/hci-logo.svg' };
      if (input.action === 'auth_status')
        value = {
          setupRequired: false,
          user: {
            id: 'qa',
            role: 'admin',
            username: 'qa',
            displayName: '本地验收',
          },
        };
      if (input.action === 'server_snapshot')
        value = {
          keywords: [keyword],
          tasks: [],
          generatedAt: new Date().toISOString(),
        };
      if (input.action === 'server_workspace_snapshot')
        value = {
          entries: [
            {
              key: 'branding:main',
              value: {
                appName: '公共内容 · 隔离验收',
                workspaceName: '本地验收',
                environmentLabel: '隔离测试',
                logo: '/admin/hci-logo.svg',
              },
            },
            { key: `products:${product.id}`, value: product },
          ],
        };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
    } catch (error) {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  if (req.url === '/qa/stats') {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        syntheticProviderCalls: calls,
        isolatedArticleReads: articleCalls,
      }),
    );
    return;
  }
  if (req.url?.startsWith('/admin/data/free-source-observations.json')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ signals: [], sourceRuns: [] }));
    return;
  }
  const file = resolve(
    base,
    decodeURIComponent(req.url.split('?')[0]).replace(/^\/admin\/?/, ''),
  );
  if (!file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      'content-type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.json': 'application/json',
      }[extname(file)] || 'application/octet-stream',
    );
    res.end(await readFile(file));
  } catch {
    res.setHeader('content-type', 'text/html');
    res.end(await readFile(resolve(base, 'index.html')));
  }
}).listen(5710, '127.0.0.1', () =>
  console.warn(
    'Public content isolated UI on http://127.0.0.1:5710/admin/signals',
  ),
);
