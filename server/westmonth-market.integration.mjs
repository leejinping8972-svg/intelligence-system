import assert from 'node:assert/strict';
import {
  competitorAction,
  competitorTick,
  createMonitorStore,
} from './competitor-monitor-store.mjs';
import { digest } from './competitor-monitor-domain.mjs';
import { westmonthChannelKey } from './westmonth-market.mjs';
export async function verifyWestmonthMarket(c) {
  const db = createMonitorStore(c),
    admin = { role: 'admin' };
  const site = {
    id: 'VN-westmonth-qa',
    market: 'VN',
    domain: 'westmonth.com',
    brand: 'QA',
  };
  await db.write('business:sites:' + site.id, site);
  const { target } = await competitorAction(
    {
      action: 'server_competitor_save',
      kind: 'site',
      siteId: site.id,
      hour: 0,
      maxRequests: 2,
      enabled: true,
    },
    admin,
  );
  const prefix = 'competitor:',
    channel = westmonthChannelKey('products', site),
    runName = prefix + 'run:' + target.id;
  await db.write(prefix + 'baseline:' + target.id + ':products', { at: 'old' });
  await db.write(
    prefix + 'seen:' + target.id + ':products:' + digest('new-after-scope'),
    { at: 'old' },
  );
  let index = 0;
  const provider = {
    scanSite: async (_site, request) =>
      request('scoped-qa:' + index, async () => ({
        items: [
          {
            id: index ? 'new-after-scope' : 'first-in-scope',
            siteId: site.id,
            market: 'VN',
            title: 'QA collagen',
            evidenceUrl:
              'https://www.westmonth.com/products/' + (index ? 2 : 1),
          },
        ],
        complete: true,
        errors: [],
      })),
  };
  await competitorTick(c, provider, { name: prefix + 'target:' + target.id });
  assert.equal((await db.read(runName)).added, 0);
  assert.ok(await db.read(prefix + 'baseline:' + target.id + ':' + channel));
  assert.ok(
    await db.read(
      prefix +
        'seen:' +
        target.id +
        ':' +
        channel +
        ':' +
        digest('first-in-scope'),
    ),
  );
  assert.ok(
    await db.read(prefix + 'baseline:' + target.id + ':products'),
    'old evidence retained',
  );
  const first = await db.read(runName);
  await db.write(runName, { ...first, day: '2000-01-01' });
  index++;
  await competitorTick(c, provider, { name: prefix + 'target:' + target.id });
  assert.equal(
    (await db.read(runName)).added,
    1,
    'old unfiltered seen must not hide a new scoped observation',
  );
  await competitorAction(
    { action: 'server_competitor_remove', id: target.id },
    admin,
  );
  assert.equal(
    await db.read(prefix + 'baseline:' + target.id + ':' + channel),
    undefined,
    'removal must drop current scoped baseline',
  );
  console.log(
    'Westmonth region SQL passed: old baselines ignored, scoped seen persisted, first scan quiet, later launch detected; no external calls.',
  );
}
