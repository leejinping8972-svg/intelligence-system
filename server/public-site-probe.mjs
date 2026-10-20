import {
  readFile,
  writeFile,
  rename,
  mkdir,
  open,
  unlink,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, dayKey } from './competitor-monitor-domain.mjs';
import { landingUrl } from './safe-web.mjs';

// Public GET-only diagnostic; deliberately does not use the business database or keys.
export async function probePublicSite(input, io) {
  const url = landingUrl(input.url);
  if (!url) throw new Error('请提供不含凭证的公开独立站URL');
  const maxRequests = Number(input.maxRequests ?? 3);
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10)
    throw new Error('单次网页请求上限1～10');
  const now = io.now || Date.now,
    day = dayKey(now());
  const state = (await io.read()) || {};
  const items = new Map(
    (state.items || state.result?.items || []).map((item) => [item.id, item]),
  );
  const host = new URL(url).hostname;
  if (state.host && state.host !== host)
    throw new Error('检查点属于其他站点，请使用独立文件');
  let used = state.day === day ? state.requests || 0 : 0;
  if (state.progress?.nextRunAt > now())
    return {
      status: 'cooldown',
      requestsToday: used,
      nextRunAt: state.progress.nextRunAt,
      message: '尚在站点要求的冷却期，未发送请求',
    };
  if (used >= 10)
    return {
      status: 'budget',
      requestsToday: used,
      message: '本诊断检查点今日10次请求已用完',
    };
  const save = (progress, result) =>
    io.save({
      host,
      day,
      requests: used,
      progress,
      items: [...items.values()],
      result: { ...result, items: undefined },
    });
  const request = async (_step, call) => {
    if (used >= 10) throw new Error('今日10次诊断请求上限已用完');
    used++;
    await save(state.progress, { status: 'requesting' });
    return call();
  };
  const site = {
    id: `probe-${digest(host)}`,
    domain: host,
    brand: host,
    market: input.market || 'US',
    platform: input.shopify ? 'Shopify' : '未知',
    evidenceUrl: url,
  };
  const result = await io.scan(
    site,
    request,
    Math.min(maxRequests, 10 - used),
    state.progress || null,
    input.browser === true,
  );
  for (const item of result.items) items.set(item.id, item);
  let status = result.complete ? 'completed' : 'partial';
  if (result.items.length === 0 && result.errors.length > 0) status = 'failed';
  if (result.retryAt > now()) status = 'cooldown';
  if (result.manualRequired) status = 'blocked';
  const summary = {
    status,
    target: host,
    requestsToday: used,
    products: items.size,
    newItems: result.items.length,
    nextRunAt: result.retryAt || 0,
    browserPages: result.browserPages || 0,
    errors: result.errors,
    items: [...items.values()],
  };
  await save(result.complete ? null : result.progress, summary);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--url'))
    throw new Error(
      '用法：node public-site-probe.mjs --url https://example.com --state /tmp/site-check.json [--max-requests 3] [--browser] [--shopify]',
    );
  const url = value('--url'),
    checked = landingUrl(url);
  if (!checked) throw new Error('URL无效');
  const stateFile = resolve(
    args.includes('--state')
      ? value('--state')
      : `${tmpdir()}/public-site-${digest(new URL(checked).hostname)}.json`,
  );
  await mkdir(dirname(stateFile), { recursive: true });
  const guard = await open(`${stateFile}.lock`, 'wx');
  try {
    await guard.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    // Imported provider dependencies may initialise a pool; point it at a nonexistent
    // local configuration and an unusable loopback endpoint before importing them.
    process.env.DATABASE_CONFIG_FILE = `${tmpdir()}/public-probe-unused-${randomUUID()}.json`;
    process.env.DATABASE_URL =
      'postgres://unused@127.0.0.1:1/no-business-database';
    if (args.includes('--browser-executable'))
      process.env.PRODUCT_BROWSER_EXECUTABLE = value('--browser-executable');
    const { scanSite } = await import('./competitor-monitor-providers.mjs');
    const { renderProductPage } = await import('./site-page-fallbacks.mjs');
    const result = await probePublicSite(
      {
        url: checked,
        maxRequests: args.includes('--max-requests')
          ? Number(value('--max-requests'))
          : 3,
        browser: args.includes('--browser'),
        shopify: args.includes('--shopify'),
      },
      {
        read: async () => {
          try {
            return JSON.parse(await readFile(stateFile, 'utf8'));
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        },
        save: async (state) => {
          const temporary = `${stateFile}.tmp-${randomUUID()}`;
          await writeFile(temporary, JSON.stringify(state), {
            mode: 0o600,
            flag: 'wx',
          });
          await rename(temporary, stateFile);
        },
        scan: (site, request, limit, progress, browserEnabled) =>
          scanSite(site, request, limit, undefined, progress, undefined, {
            browserEnabled,
            fetchBrowser: (target, source) => renderProductPage(target, source),
          }),
      },
    );
    process.stdout.write(
      `${JSON.stringify({ ...result, items: undefined, checkpoint: stateFile }, null, 2)}\n`,
    );
    const { pool } = await import('./database.mjs');
    await pool.end();
  } finally {
    await guard.close();
    await unlink(`${stateFile}.lock`);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      error.code === 'EEXIST'
        ? '检查点已被占用（含中断后的锁文件），请确认旧进程已结束；未发送新请求'
        : error.message,
    );
    process.exitCode = 1;
  });
